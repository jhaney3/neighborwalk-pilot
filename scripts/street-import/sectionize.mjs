import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

export const STREET_RELEASE_SOURCE = "Overture transportation";
export const REQUIRED_COUNTIES = ["47055", "47099", "47101", "47181"];

function jsonValue(value, label) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { throw new Error(`${label} is not valid JSON.`); }
}

function coordinate(value) {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])
    && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
}

// Vincenty's inverse formula matches Overture's WGS84 geodetic linear-reference contract.
function geodeticMeters(left, right) {
  const semiMajor = 6_378_137;
  const flattening = 1 / 298.257_223_563;
  const semiMinor = (1 - flattening) * semiMajor;
  const radians = Math.PI / 180;
  const reducedLeft = Math.atan((1 - flattening) * Math.tan(left[1] * radians));
  const reducedRight = Math.atan((1 - flattening) * Math.tan(right[1] * radians));
  const longitude = (right[0] - left[0]) * radians;
  let lambda = longitude;
  let sigma = 0; let sinSigma = 0; let cosSigma = 0; let cosSquaredAlpha = 0; let cosDoubleSigmaMidpoint = 0;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const sinLambda = Math.sin(lambda); const cosLambda = Math.cos(lambda);
    sinSigma = Math.hypot(Math.cos(reducedRight) * sinLambda,
      Math.cos(reducedLeft) * Math.sin(reducedRight) - Math.sin(reducedLeft) * Math.cos(reducedRight) * cosLambda);
    if (sinSigma === 0) return 0;
    cosSigma = Math.sin(reducedLeft) * Math.sin(reducedRight) + Math.cos(reducedLeft) * Math.cos(reducedRight) * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = Math.cos(reducedLeft) * Math.cos(reducedRight) * sinLambda / sinSigma;
    cosSquaredAlpha = 1 - sinAlpha * sinAlpha;
    cosDoubleSigmaMidpoint = cosSquaredAlpha === 0 ? 0 : cosSigma - 2 * Math.sin(reducedLeft) * Math.sin(reducedRight) / cosSquaredAlpha;
    const coefficient = flattening / 16 * cosSquaredAlpha * (4 + flattening * (4 - 3 * cosSquaredAlpha));
    const next = longitude + (1 - coefficient) * flattening * sinAlpha * (sigma + coefficient * sinSigma
      * (cosDoubleSigmaMidpoint + coefficient * cosSigma * (-1 + 2 * cosDoubleSigmaMidpoint ** 2)));
    if (Math.abs(next - lambda) < 1e-12) { lambda = next; break; }
    lambda = next;
  }
  const uSquared = cosSquaredAlpha * (semiMajor ** 2 - semiMinor ** 2) / semiMinor ** 2;
  const a = 1 + uSquared / 16_384 * (4_096 + uSquared * (-768 + uSquared * (320 - 175 * uSquared)));
  const b = uSquared / 1_024 * (256 + uSquared * (-128 + uSquared * (74 - 47 * uSquared)));
  const deltaSigma = b * sinSigma * (cosDoubleSigmaMidpoint + b / 4 * (cosSigma * (-1 + 2 * cosDoubleSigmaMidpoint ** 2)
    - b / 6 * cosDoubleSigmaMidpoint * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cosDoubleSigmaMidpoint ** 2)));
  return semiMinor * a * (sigma - deltaSigma);
}

function sectionPoint(coordinates, lengths, distance) {
  let traveled = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const next = traveled + lengths[index];
    if (Math.abs(distance - traveled) < .02) return { point: coordinates[index], segment: index, atVertex: true };
    if (distance <= next || index === lengths.length - 1) {
      if (Math.abs(distance - next) < .02) return { point: coordinates[index + 1], segment: index + 1, atVertex: true };
      const fraction = lengths[index] ? (distance - traveled) / lengths[index] : 0;
      return { point: [coordinates[index][0] + (coordinates[index + 1][0] - coordinates[index][0]) * fraction,
        coordinates[index][1] + (coordinates[index + 1][1] - coordinates[index][1]) * fraction], segment: index, atVertex: false };
    }
    traveled = next;
  }
  return { point: coordinates.at(-1), segment: coordinates.length - 1, atVertex: true };
}

export function splitLineAtFractions(coordinates, fractions) {
  if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.every(coordinate)) throw new Error("A source segment needs a valid WGS84 LineString.");
  const cuts = [...new Set([0, 1, ...fractions].map((value) => Number(value)).filter((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    .map((value) => Math.round(value * 1e12) / 1e12))].sort((a, b) => a - b);
  const lengths = coordinates.slice(0, -1).map((point, index) => geodeticMeters(point, coordinates[index + 1]));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (!(total > 0)) throw new Error("A source segment cannot have zero length.");
  return cuts.slice(0, -1).map((start, index) => {
    const end = cuts[index + 1];
    const from = sectionPoint(coordinates, lengths, start * total);
    const to = sectionPoint(coordinates, lengths, end * total);
    const middleStart = from.atVertex ? from.segment + 1 : from.segment + 1;
    const middleEnd = to.atVertex ? to.segment : to.segment + 1;
    const middle = coordinates.slice(middleStart, middleEnd);
    const section = [from.point, ...middle, to.point].filter((point, at, values) => at === 0 || point[0] !== values[at - 1][0] || point[1] !== values[at - 1][1]);
    if (section.length < 2) throw new Error("An interior connector produced an empty section.");
    return { start, end, coordinates: section };
  });
}

export function canonicalSectionId(sourceSegmentId, start, end) {
  if (typeof sourceSegmentId !== "string" || !sourceSegmentId.trim() || /[\r\n\t]/.test(sourceSegmentId)) throw new Error("A source segment ID is required.");
  return `${sourceSegmentId}@${start.toFixed(9)}-${end.toFixed(9)}`;
}

export function sectionizeSegment(raw, release) {
  if (!raw || typeof raw !== "object") throw new Error("A source segment row must be an object.");
  const geometry = jsonValue(raw.geometry, "geometry");
  const connectors = jsonValue(raw.connectors, "connectors");
  const counties = jsonValue(raw.county_fips, "county_fips");
  if (geometry?.type !== "LineString") throw new Error("A source segment must retain canonical LineString geometry.");
  if (!Array.isArray(connectors)) throw new Error("A source segment must include its connector list.");
  if (!Array.isArray(counties) || !counties.length || counties.some((county) => !REQUIRED_COUNTIES.includes(String(county)))) throw new Error("A source segment has invalid county membership.");
  const fractions = connectors.map((connector) => Number(connector?.at));
  if (fractions.some((at) => !Number.isFinite(at) || at < 0 || at > 1)) throw new Error("A connector has an invalid linear reference.");
  return splitLineAtFractions(geometry.coordinates, fractions).map((section) => ({
    release,
    id: canonicalSectionId(String(raw.source_segment_id ?? ""), section.start, section.end),
    name: typeof raw.name === "string" ? raw.name : null,
    road_class: typeof raw.road_class === "string" ? raw.road_class : "unknown",
    subclass: typeof raw.subclass === "string" ? raw.subclass : null,
    geometry: { type: "LineString", coordinates: section.coordinates },
    county_fips: [...new Set(counties.map(String))].sort(),
  }));
}

export function validatePreparedRelease(sections, release) {
  if (!release?.trim()) throw new Error("A release is required.");
  if (!sections.length) throw new Error("The prepared release has no street sections.");
  const ids = new Set(); const counties = new Set();
  for (const section of sections) {
    if (section.release !== release) throw new Error("Prepared rows contain another release.");
    if (ids.has(section.id)) throw new Error(`Duplicate canonical section ID: ${section.id}`);
    ids.add(section.id);
    section.county_fips.forEach((county) => counties.add(county));
  }
  if (REQUIRED_COUNTIES.some((county) => !counties.has(county)) || counties.size !== REQUIRED_COUNTIES.length) throw new Error("Prepared rows do not cover exactly the four approved counties.");
  return { release, source: STREET_RELEASE_SOURCE, county_fips: REQUIRED_COUNTIES, expected_rows: sections.length };
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function sectionCsvRow(section) {
  return [section.release, section.id, section.name, section.road_class, section.subclass, JSON.stringify(section.geometry), JSON.stringify(section.county_fips)].map(csvCell).join(",");
}

export async function prepareRelease(inputPath, outputPath, manifestPath, release) {
  const temporaryOutput = `${outputPath}.partial`; const temporaryManifest = `${manifestPath}.partial`;
  const output = createWriteStream(temporaryOutput, { encoding: "utf8", flags: "wx" });
  output.write("release,id,name,road_class,subclass,geometry_json,county_fips\n");
  const sections = [];
  const lines = createInterface({ input: createReadStream(inputPath, "utf8"), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    for (const section of sectionizeSegment(JSON.parse(line), release)) { sections.push(section); if (!output.write(`${sectionCsvRow(section)}\n`)) await once(output, "drain"); }
  }
  const manifest = validatePreparedRelease(sections, release);
  output.end(); await once(output, "finish");
  await fs.writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  await fs.rename(temporaryOutput, outputPath); await fs.rename(temporaryManifest, manifestPath);
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [inputPath, outputPath, manifestPath, release] = process.argv.slice(2);
  if (!inputPath || !outputPath || !manifestPath || !release) throw new Error("Usage: node sectionize.mjs INPUT.ndjson OUTPUT.csv MANIFEST.json RELEASE");
  const manifest = await prepareRelease(inputPath, outputPath, manifestPath, release);
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
}
