export class IncompleteCollectionError extends Error {}

/** Read a keyset-paged collection through its empty terminal page. A short page
 * may be a server limit, not EOF. Never return an accepted partial collection. */
export async function readCompletePages<T>(
  fetchPage: (after?: string) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>,
  identify: (row: T) => string,
  limits = { records: 20_000, bytes: 16 * 1024 * 1024 },
): Promise<T[]> {
  const all: T[] = [];
  const seen = new Set<string>();
  const encoder = new TextEncoder();
  let cursor: string | undefined;
  let bytes = 0;
  for (;;) {
    const result = await fetchPage(cursor);
    if (result.error) throw new Error(result.error.message, { cause: result.error });
    if (!Array.isArray(result.data)) throw new IncompleteCollectionError("The collection could not be read completely. Refresh before continuing.");
    if (result.data.length === 0) return all;
    for (const row of result.data) {
      const id = identify(row);
      if (typeof id !== "string" || !id || seen.has(id)) throw new IncompleteCollectionError("The collection cursor did not advance safely. No partial result was accepted.");
      bytes += encoder.encode(JSON.stringify(row)).byteLength;
      if (all.length >= limits.records || bytes > limits.bytes) throw new IncompleteCollectionError("This library exceeds the reviewed device-read limit. The saved copy was not replaced; ask the operator to review its size.");
      seen.add(id); all.push(row); cursor = id;
    }
  }
}
