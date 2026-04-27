import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { eq, inArray } from 'drizzle-orm';
import { db, sql } from '../db/client.js';
import { pokemon } from '../db/schema/index.js';

const FORMATS_DATA_PATH = 'data/showdown-champions/formats-data.ts';

type FormatsEntry = {
  isNonstandard?: 'Past' | 'Future' | 'CAP' | 'LGPE' | 'Unobtainable';
  tier?: string;
};
type FormatsData = Record<string, FormatsEntry>;

const text = await readFile(FORMATS_DATA_PATH, 'utf8');
const match = text.match(/^export const \w+ = ([\s\S]+?);\s*$/);
if (!match) throw new Error(`failed to parse ${FORMATS_DATA_PATH}`);
const formatsData = new Function(`return (${match[1]});`)() as FormatsData;

const rosterEntries: { id: string; tier: string | null }[] = [];
const skipped: { id: string; reason: string }[] = [];

for (const [id, entry] of Object.entries(formatsData)) {
  // "Past" → not in Champions. "Illegal" tier → also out.
  if (entry.isNonstandard === 'Past') {
    skipped.push({ id, reason: 'isNonstandard=Past' });
    continue;
  }
  if (entry.tier === 'Illegal') {
    skipped.push({ id, reason: 'tier=Illegal' });
    continue;
  }
  rosterEntries.push({ id, tier: entry.tier ?? null });
}

const rosterIds = rosterEntries.map((e) => e.id);
const dbRows = await db
  .select({ id: pokemon.id })
  .from(pokemon)
  .where(inArray(pokemon.id, rosterIds));
const haveInDb = new Set(dbRows.map((r) => r.id));
const missingFromDb = rosterIds.filter((id) => !haveInDb.has(id));

await db.transaction(async (tx) => {
  await tx.update(pokemon).set({ isChampions: false, championsTier: null });
  for (const { id, tier } of rosterEntries) {
    if (!haveInDb.has(id)) continue;
    await tx
      .update(pokemon)
      .set({ isChampions: true, championsTier: tier })
      .where(eq(pokemon.id, id));
  }
});

const tierCounts = new Map<string, number>();
for (const { tier } of rosterEntries) {
  if (!haveInDb.has(rosterEntries[0]!.id)) {} // no-op for type narrowing
  const key = tier ?? '(none)';
  tierCounts.set(key, (tierCounts.get(key) ?? 0) + 1);
}

console.log(`formats-data entries: ${Object.keys(formatsData).length}`);
console.log(`  in champions:       ${rosterEntries.length}`);
console.log(`  skipped (Past/Illegal): ${skipped.length}`);
console.log(`  applied to DB rows: ${rosterEntries.length - missingFromDb.length}`);

console.log(`\ntier breakdown:`);
const sortedTiers = [...tierCounts.entries()].sort((a, b) => b[1] - a[1]);
for (const [t, n] of sortedTiers) console.log(`  ${t}: ${n}`);

if (missingFromDb.length) {
  console.log(`\nin formats-data but missing from pokemon table (${missingFromDb.length}):`);
  for (const id of missingFromDb.slice(0, 20)) console.log(`  ${id}`);
  if (missingFromDb.length > 20) console.log(`  ... and ${missingFromDb.length - 20} more`);
}

await sql.end();

if (missingFromDb.length) {
  console.error('\nintegrity check failed: roster references unknown ids');
  process.exit(1);
}
