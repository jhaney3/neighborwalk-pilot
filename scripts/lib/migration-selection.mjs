export const REWORK_MIGRATION_FLOOR = "20260910000000";

export function selectAdditiveMigrations(files, floor = REWORK_MIGRATION_FLOOR) {
  return files.filter((name) => {
    const match = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(name);
    return Boolean(match && match[1] >= floor);
  }).sort();
}
