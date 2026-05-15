import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { Dex, toID } from '@pkmn/dex';
import { eq, inArray } from 'drizzle-orm';
import { db, sqlite } from '../db/client.js';
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

// Auto-promote mega base forms: if a mega is in Champions, the species you must
// bring to mega-evolve (its `changesFrom`) should also be marked Champions even
// if formats-data doesn't list it explicitly. Catches Meowstic-F (whose mega
// Meowstic-F-Mega is listed but the base isn't) and Magearna (similar).
const autoAdded: string[] = [];
for (const e of [...rosterEntries]) {
  const s = Dex.species.get(e.id);
  if (!s.exists) continue;
  if (!s.changesFrom) continue;
  const cfId = toID(s.changesFrom);
  if (!cfId || cfId === e.id) continue;
  if (rosterEntries.some((x) => x.id === cfId)) continue;
  // Inherit tier from the mega's parent species in formats-data if recorded;
  // otherwise null and let downstream classify.
  rosterEntries.push({ id: cfId, tier: formatsData[cfId]?.tier ?? null });
  autoAdded.push(`${e.id} → ${cfId}`);
}

const rosterIds = rosterEntries.map((e) => e.id);
const dbRows = await db
  .select({ id: pokemon.id })
  .from(pokemon)
  .where(inArray(pokemon.id, rosterIds));
const haveInDb = new Set(dbRows.map((r) => r.id));
const missingFromDb = rosterIds.filter((id) => !haveInDb.has(id));

// Reset all flags, then mark roster entries. better-sqlite3 doesn't support
// async transactions; the WAL pragma keeps this fast enough without one.
await db.update(pokemon).set({ isChampions: false, championsTier: null });
for (const { id, tier } of rosterEntries) {
  if (!haveInDb.has(id)) continue;
  await db
    .update(pokemon)
    .set({ isChampions: true, championsTier: tier })
    .where(eq(pokemon.id, id));
}

const tierCounts = new Map<string, number>();
for (const { tier } of rosterEntries) {
  if (!haveInDb.has(rosterEntries[0]!.id)) {} // no-op for type narrowing
  const key = tier ?? '(none)';
  tierCounts.set(key, (tierCounts.get(key) ?? 0) + 1);
}

console.log(`formats-data entries: ${Object.keys(formatsData).length}`);
console.log(`  in champions:       ${rosterEntries.length} (auto-added mega bases: ${autoAdded.length})`);
console.log(`  skipped (Past/Illegal): ${skipped.length}`);
console.log(`  applied to DB rows: ${rosterEntries.length - missingFromDb.length}`);
if (autoAdded.length) console.log(`  auto-added: ${autoAdded.join(', ')}`);

console.log(`\ntier breakdown:`);
const sortedTiers = [...tierCounts.entries()].sort((a, b) => b[1] - a[1]);
for (const [t, n] of sortedTiers) console.log(`  ${t}: ${n}`);

if (missingFromDb.length) {
  console.log(`\nin formats-data but missing from pokemon table (${missingFromDb.length}):`);
  for (const id of missingFromDb.slice(0, 20)) console.log(`  ${id}`);
  if (missingFromDb.length > 20) console.log(`  ... and ${missingFromDb.length - 20} more`);
}

sqlite.close();

if (missingFromDb.length) {
  console.error('\nintegrity check failed: roster references unknown ids');
  process.exit(1);
}
