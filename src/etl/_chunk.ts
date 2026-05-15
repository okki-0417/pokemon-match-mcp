// SQLite caps prepared-statement parameters (default 999, sometimes 32766).
// Drizzle's bulk `.values(rows)` flattens to one prepared statement, so wide
// tables hit the limit fast. Use this to feed inserts in safe slices.
export const SQLITE_PARAM_CAP = 900; // conservative
export function chunkSize(columns: number): number {
  return Math.max(1, Math.floor(SQLITE_PARAM_CAP / columns));
}
export function chunked<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
