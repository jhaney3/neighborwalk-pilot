export type Crews = Record<string, string[]>;

/** Splits the people who are here across routes: saved teams stay together
 * first, then everyone else fills the route with the fewest people, so crews
 * come out even. Deterministic for the same input. */
export function autoPair(targetIds: readonly string[], attendingIds: readonly string[], savedTeams: readonly { memberIds: readonly string[] }[] = []): Crews {
  const crews: Crews = Object.fromEntries(targetIds.map((id) => [id, []]));
  if (!targetIds.length) return crews;
  const pool = new Set(attendingIds);
  const smallest = () => [...targetIds].sort((a, b) => crews[a].length - crews[b].length || targetIds.indexOf(a) - targetIds.indexOf(b))[0];
  for (const team of savedTeams) {
    const here = team.memberIds.filter((id) => pool.has(id));
    if (here.length < 2) continue;
    crews[smallest()].push(...here);
    for (const id of here) pool.delete(id);
  }
  for (const id of attendingIds) {
    if (!pool.has(id)) continue;
    crews[smallest()].push(id);
    pool.delete(id);
  }
  return crews;
}
