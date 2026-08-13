# Tennessee parcel import

This admin-only utility streams official Tennessee county parcel archives to a
short-lived authenticated import endpoint. The input ZIP files remain unchanged.

Privacy boundary: the script transmits only `GISLINK`, the situs street/city,
property class, land use, source update date, county FIPS, and polygon geometry.
It never transmits owner names, mailing addresses, sale data, or valuations.

Install the pinned dependencies in an isolated environment, set
`PARCEL_IMPORT_ENDPOINT` and `PARCEL_IMPORT_TOKEN` supplied by the secured import
worker, then pass one or more official county ZIP archives:

```powershell
python -m pip install -r scripts/parcel-import/requirements.txt
python scripts/parcel-import/import_tn_parcels.py C:\path\Lawrence.zip
```

The current county filename-to-FIPS mapping covers Giles, Lawrence, Lewis, and
Wayne counties. Re-running an archive is safe because rows are upserted by county
FIPS and GIS link.
