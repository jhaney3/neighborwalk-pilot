type LinkedRecord = { id: string; mergedIntoId?: string };

/** Historical rows stay intact. Resolve only to a record actually present in
 * this permission-filtered workspace; missing targets and cycles fail closed. */
export function indexCurrentRecords<T extends LinkedRecord>(records: readonly T[]): Map<string, T> {
  const originals = new Map(records.map((record) => [record.id, record]));
  const current = new Map<string, T>();
  for (const record of records) {
    let target: T | undefined = record;
    const seen = new Set<string>();
    while (target?.mergedIntoId && !seen.has(target.id)) {
      seen.add(target.id);
      target = originals.get(target.mergedIntoId);
    }
    if (target && !target.mergedIntoId) current.set(record.id, target);
  }
  return current;
}

export function recordFamilyIds<T extends LinkedRecord>(records: readonly T[], id: string): Set<string> {
  const index = indexCurrentRecords(records);
  const target = index.get(id);
  return new Set(target ? [...index].filter(([, record]) => record.id === target.id).map(([key]) => key) : []);
}
