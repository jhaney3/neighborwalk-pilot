INSTALL spatial;
LOAD spatial;
INSTALL httpfs;
LOAD httpfs;
SET s3_region = 'us-west-2';

CREATE OR REPLACE TEMP TABLE approved_counties AS
SELECT geoid AS county_fips,
  ST_Transform(geom, 'EPSG:4269', 'EPSG:4326', always_xy := true) AS geometry
FROM ST_Read('{{COUNTY_FILE}}')
WHERE statefp = '47' AND countyfp IN ('055', '099', '101', '181');

CREATE OR REPLACE TEMP TABLE bounded_source_segments AS
SELECT id AS source_segment_id,
  names.primary AS name,
  "class" AS road_class,
  CASE WHEN subclass IS NULL THEN NULL ELSE CAST(subclass AS VARCHAR) END AS subclass,
  geometry,
  connectors
FROM read_parquet(
  's3://overturemaps-us-west-2/release/{{RELEASE}}/theme=transportation/type=segment/*',
  filename = true,
  hive_partitioning = true
)
WHERE subtype = 'road'
  AND bbox.xmin < -86.57 AND bbox.xmax > -88.06
  AND bbox.ymin < 35.73 AND bbox.ymax > 34.98
  AND names.primary IS NOT NULL
  AND "class" IN ('living_street', 'primary', 'residential', 'secondary', 'service', 'tertiary', 'unclassified', 'unknown')
  AND coalesce(CAST(subclass AS VARCHAR), '') NOT LIKE '%driveway%'
  AND coalesce(CAST(subclass AS VARCHAR), '') NOT LIKE '%parking_aisle%'
  AND coalesce(CAST(subclass AS VARCHAR), '') NOT LIKE '%sidewalk%'
  AND coalesce(CAST(subclass AS VARCHAR), '') NOT LIKE '%crosswalk%';

COPY (
  SELECT segment.source_segment_id,
    segment.name,
    segment.road_class,
    segment.subclass,
    ST_AsGeoJSON(segment.geometry) AS geometry,
    to_json(segment.connectors) AS connectors,
    to_json(list_sort(list_distinct(list(county.county_fips)))) AS county_fips
  FROM bounded_source_segments segment
  JOIN approved_counties county
    ON ST_Intersects(segment.geometry, county.geometry)
  GROUP BY ALL
  ORDER BY segment.source_segment_id
) TO '{{OUTPUT_FILE}}' (FORMAT JSON, ARRAY false);
