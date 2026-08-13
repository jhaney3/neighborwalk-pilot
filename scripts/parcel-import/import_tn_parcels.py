#!/usr/bin/env python3
"""Stream privacy-safe Tennessee parcel records to an authenticated import endpoint.

Only parcel geometry, the GIS link, situs address/city, property class, land use,
and source update date leave the source archives. Owner, mailing, sale, and value
columns are intentionally never added to the outbound records.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Iterable, Iterator, Sequence
from io import BytesIO
from pathlib import Path
from typing import Any
from zipfile import ZipFile

import shapefile
from pyproj import CRS, Transformer


COUNTY_FIPS = {
    "giles": "47055",
    "lawrence": "47099",
    "lewis": "47101",
    "wayne": "47181",
}

SAFE_ASSESSMENT_FIELDS = {"GISLINK", "ADDRESS", "CITY", "CLASS", "LANDUSE"}
SAFE_PARCEL_FIELDS = {"GISLINK", "LAST_UPDAT"}


def clean_text(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def source_date(value: Any) -> str | None:
    if isinstance(value, (dt.date, dt.datetime)):
        return value.date().isoformat() if isinstance(value, dt.datetime) else value.isoformat()
    text = clean_text(value)
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y%m%d", "%m/%d/%Y"):
        try:
            return dt.datetime.strptime(text[:10], fmt).date().isoformat()
        except ValueError:
            continue
    return None


def situs_address(row: dict[str, Any] | None) -> str | None:
    if not row:
        return None
    street = clean_text(row.get("ADDRESS"))
    city = re.sub(r"^\d{3}\s+", "", clean_text(row.get("CITY")))
    if not street:
        return None
    return ", ".join(part for part in (street, city, "TN") if part)


def residential(classification: str, land_use: str) -> bool:
    land_use_codes = land_use.partition(" - ")[0].split(":")
    return classification.startswith("00 ") or "11" in land_use_codes


def transform_coordinates(value: Any, transformer: Transformer) -> Any:
    if isinstance(value, (list, tuple)) and value and isinstance(value[0], (int, float)):
        longitude, latitude = transformer.transform(value[0], value[1])
        return [round(longitude, 7), round(latitude, 7)]
    if isinstance(value, (list, tuple)):
        return [transform_coordinates(item, transformer) for item in value]
    return value


def archive_member(archive: ZipFile, suffix: str) -> str:
    matches = [name for name in archive.namelist() if name.lower().endswith(suffix.lower())]
    if len(matches) != 1:
        raise ValueError(f"Expected one {suffix} in archive; found {len(matches)}")
    return matches[0]


def field_indexes(reader: shapefile.Reader, allowed: set[str]) -> dict[str, int]:
    fields = [field[0] for field in reader.fields[1:]]
    indexes = {name: fields.index(name) for name in allowed if name in fields}
    missing = allowed - indexes.keys()
    if missing:
        raise ValueError(f"Source DBF is missing required fields: {', '.join(sorted(missing))}")
    return indexes


def safe_assessment_rows(archive: ZipFile) -> dict[str, dict[str, Any]]:
    dbf_name = next(
        name for name in archive.namelist()
        if "assessment_data_" in name.lower() and name.lower().endswith(".dbf")
    )
    reader = shapefile.Reader(dbf=BytesIO(archive.read(dbf_name)), encoding="utf-8")
    indexes = field_indexes(reader, SAFE_ASSESSMENT_FIELDS)
    rows: dict[str, dict[str, Any]] = {}
    for record in reader.iterRecords():
        gislink = clean_text(record[indexes["GISLINK"]])
        if gislink:
            rows[gislink] = {name: record[index] for name, index in indexes.items()}
    return rows


def parcel_records(zip_path: Path) -> Iterator[dict[str, Any]]:
    county_name = zip_path.stem.lower()
    county_fips = COUNTY_FIPS.get(county_name)
    if not county_fips:
        raise ValueError(f"Unsupported county archive name: {zip_path.name}")

    with ZipFile(zip_path) as archive:
        shp_name = archive_member(archive, "parcels.shp")
        shx_name = archive_member(archive, "parcels.shx")
        dbf_name = archive_member(archive, "parcels.dbf")
        prj_name = archive_member(archive, "parcels.prj")
        reader = shapefile.Reader(
            shp=BytesIO(archive.read(shp_name)),
            shx=BytesIO(archive.read(shx_name)),
            dbf=BytesIO(archive.read(dbf_name)),
            encoding="utf-8",
        )
        indexes = field_indexes(reader, SAFE_PARCEL_FIELDS)
        assessments = safe_assessment_rows(archive)
        source_crs = CRS.from_wkt(archive.read(prj_name).decode("utf-8"))
        transformer = Transformer.from_crs(source_crs, CRS.from_epsg(4326), always_xy=True)

        parcel_parts: dict[str, dict[str, Any]] = {}
        for shape_record in reader.iterShapeRecords():
            gislink = clean_text(shape_record.record[indexes["GISLINK"]])
            if not gislink:
                continue
            geometry = shape_record.shape.__geo_interface__
            transformed = transform_coordinates(geometry["coordinates"], transformer)
            polygons = transformed if geometry["type"] == "MultiPolygon" else [transformed]
            current = parcel_parts.setdefault(gislink, {"polygons": [], "source_updated_on": None})
            current["polygons"].extend(polygons)
            current["source_updated_on"] = source_date(shape_record.record[indexes["LAST_UPDAT"]])

        for gislink, parcel in parcel_parts.items():
            assessment = assessments.get(gislink)
            classification = clean_text(assessment.get("CLASS")) if assessment else ""
            land_use = clean_text(assessment.get("LANDUSE")) if assessment else ""
            yield {
                "county_fips": county_fips,
                "gislink": gislink,
                "situs_address": situs_address(assessment),
                "property_class": classification or None,
                "land_use": land_use or None,
                "is_residential": residential(classification, land_use),
                "source_updated_on": parcel["source_updated_on"],
                "geometry": {
                    "type": "MultiPolygon",
                    "coordinates": parcel["polygons"],
                },
            }


def batches(records: Iterable[dict[str, Any]], size: int) -> Iterator[list[dict[str, Any]]]:
    batch: list[dict[str, Any]] = []
    for record in records:
        batch.append(record)
        if len(batch) == size:
            yield batch
            batch = []
    if batch:
        yield batch


def post_batch(endpoint: str, token: str, records: Sequence[dict[str, Any]]) -> int:
    payload = json.dumps({"records": records}, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                result = json.load(response)
                return int(result["processed"])
        except (urllib.error.URLError, TimeoutError, KeyError, ValueError) as error:
            if attempt == 4:
                raise RuntimeError("Parcel batch failed after five attempts") from error
            time.sleep(2 ** attempt)
    raise AssertionError("unreachable")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archives", nargs="+", type=Path, help="Official county ZIP archives")
    parser.add_argument("--batch-size", type=int, default=250)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    endpoint = os.environ.get("PARCEL_IMPORT_ENDPOINT", "").strip()
    token = os.environ.get("PARCEL_IMPORT_TOKEN", "").strip()
    if not endpoint or not token:
        print("PARCEL_IMPORT_ENDPOINT and PARCEL_IMPORT_TOKEN are required.", file=sys.stderr)
        return 2
    if not 1 <= args.batch_size <= 500:
        print("--batch-size must be between 1 and 500.", file=sys.stderr)
        return 2

    total = 0
    for archive in args.archives:
        if not archive.is_file():
            print(f"Archive not found: {archive}", file=sys.stderr)
            return 2
        county_total = 0
        for batch in batches(parcel_records(archive), args.batch_size):
            processed = post_batch(endpoint, token, batch)
            total += processed
            county_total += processed
            print(f"{archive.stem}: {county_total:,} parcels processed", flush=True)
    print(f"Import complete: {total:,} parcels processed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
