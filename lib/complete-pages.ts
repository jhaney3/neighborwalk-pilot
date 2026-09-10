export class IncompleteCollectionError extends Error {}

const limitMessage = "This collection exceeds the reviewed device-read limit. The saved copy was not replaced; ask the operator to review its size.";
/** One shared budget can bound several concurrent collections together. It is
 * deliberately not a capacity claim or permission to accept partial results. */
export class CollectionReadBudget {
  private records = 0;
  private bytes = 0;
  private failure: Error | null = null;
  constructor(private readonly limits: { records: number; bytes: number }) {}
  assertOpen() { if (this.failure) throw this.failure; }
  cancel(error: unknown) { this.failure ??= error instanceof Error ? error : new IncompleteCollectionError("The collection read was interrupted. No partial result was accepted."); }
  consume(bytes: number) {
    this.records++; this.bytes += bytes;
    if (this.records > this.limits.records || this.bytes > this.limits.bytes) this.failure ??= new IncompleteCollectionError(limitMessage);
    this.assertOpen();
  }
}

/** Read a keyset-paged collection through its empty terminal page. A short page
 * may be a server limit, not EOF. Never return an accepted partial collection. */
export async function readCompletePages<T>(
  fetchPage: (after?: string) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>,
  identify: (row: T) => string,
  limits = { records: 20_000, bytes: 16 * 1024 * 1024 },
  sharedBudget?: CollectionReadBudget,
): Promise<T[]> {
  const all: T[] = [];
  const seen = new Set<string>();
  const encoder = new TextEncoder();
  let cursor: string | undefined;
  let bytes = 0;
  for (;;) {
    sharedBudget?.assertOpen();
    const result = await fetchPage(cursor);
    if (result.error) throw new Error(result.error.message, { cause: result.error });
    if (!Array.isArray(result.data)) throw new IncompleteCollectionError("The collection could not be read completely. Refresh before continuing.");
    if (result.data.length === 0) return all;
    for (const row of result.data) {
      const id = identify(row);
      if (typeof id !== "string" || !id || seen.has(id)) throw new IncompleteCollectionError("The collection cursor did not advance safely. No partial result was accepted.");
      const rowBytes = encoder.encode(JSON.stringify(row)).byteLength;
      bytes += rowBytes;
      if (all.length >= limits.records || bytes > limits.bytes) throw new IncompleteCollectionError(limitMessage);
      sharedBudget?.consume(rowBytes);
      seen.add(id); all.push(row); cursor = id;
    }
  }
}
