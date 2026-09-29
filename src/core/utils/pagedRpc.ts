/**
 * Reading a paged read that comes back over typed RPC.
 *
 * The paged channels answer with count LEFT JOIN LATERAL page ON true, so a
 * request for a page past the end still returns exactly one row carrying the
 * true count, flagged has_row false. That row is all-NULL otherwise.
 *
 * Two things depend on knowing that, and getting either wrong is silent:
 *   - the total must be read from the FIRST row, not from items.length, or an
 *     empty page reports zero while the PGlite path reports the real count;
 *   - the all-NULL row must be dropped before mapping, or an empty page
 *     fabricates one item.
 *
 * The old shape - COUNT(*) OVER() as total_count - cannot express this: an empty
 * page returns no rows at all, taking the total with it. src/test/pagedTotalGate
 * keeps a pinned list of the channels still written that way, and
 * src/test/pagedTotal.live.test.ts runs both shapes against a real database.
 *
 * The mapper stays with the caller: crm maps rows with its own mapLeadRow and
 * friends, accounting with mapRows, so this returns the filtered rows and the
 * total and leaves the shaping where the types are.
 */
export function splitPagedRpcRows(rows: Record<string, unknown>[] | undefined): {
  rows: Record<string, unknown>[];
  total: number;
} {
  const list = rows || [];
  return {
    rows: list.filter((r) => r.has_row === true),
    total: list.length > 0 ? Number(list[0].total_count || 0) : 0,
  };
}
