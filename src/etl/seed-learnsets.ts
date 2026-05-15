import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Dex, toID } from '@pkmn/dex';
import { eq } from 'drizzle-orm';
import { db, sqlite } from '../db/client.js';
import { learnsets, moves, pokemon } from '../db/schema/index.js';

type LearnsetEntry = { learnset?: Record<string, string[]> };
type LearnsetTable = Record<string, LearnsetEntry>;

// @pkmn/sim only exports its public sim API. Resolve the data file path through
// require.resolve on the entry point and reach the sibling data/ directory.
const require = createRequire(import.meta.url);
const simEntry = require.resolve('@pkmn/sim'); // .../build/cjs/sim/index.js
const baseLearnsetsPath = simEntry.replace(/sim[\\/]index\.js$/, 'data/learnsets.js');
const baseLearnsets = (require(baseLearnsetsPath) as { Learnsets: LearnsetTable }).Learnsets;

const championsModText = await readFile('data/showdown-champions/learnsets.ts', 'utf8');
const m = championsModText.match(/^export const \w+ = ([\s\S]+?);\s*$/);
if (!m) throw new Error('failed to parse champions learnsets');
const championsLearnsets = new Function(`return (${m[1]});`)() as LearnsetTable;

// Load valid pokemon ids (Champions roster) and move ids from DB.
const championsRows = await db
  .select({ id: pokemon.id })
  .from(pokemon)
  .where(eq(pokemon.isChampions, true));
const championsIds = championsRows.map((r) => r.id);
const moveRows = await db.select({ id: moves.id }).from(moves);
const validMoveIds = new Set(moveRows.map((r) => r.id));

type Row = { pokemonId: string; moveId: string; sources: string[] };
const insertRows: Row[] = [];
const noLearnsetIds: string[] = [];
const skippedMoveCounts = new Map<string, number>();

function hasGen9(learnset: Record<string, string[]>): boolean {
  for (const sources of Object.values(learnset)) {
    if (sources.some((s) => s.startsWith('9'))) return true;
  }
  return false;
}

function resolveLearnset(speciesId: string): Record<string, string[]> | undefined {
  // Champions mod for this id (full override) — assume authoritative even without Gen 9 sources.
  const champ = championsLearnsets[speciesId]?.learnset;
  if (champ) return champ;
  // Base @pkmn/sim Gen 9 for this id, but only if it actually has Gen 9 entries.
  // Some formes (e.g. gourgeistsuper) carry stale pre-Gen 9 learnsets that block the
  // baseSpecies fallback, leaving the forme with zero usable moves after filtering.
  const base = baseLearnsets[speciesId]?.learnset;
  if (base && hasGen9(base)) return base;
  // Forme inheritance. Try `changesFrom` first (the actual mega-evolves-from form,
  // e.g. Floette-Mega ← Floette-Eternal, Meowstic-F-Mega ← Meowstic-F) before
  // falling back to `baseSpecies` (the species root). For most megas these match,
  // but Floette-Mega / Meowstic-F-Mega / Magearna-Original-Mega differ — without
  // this preference they'd inherit from the wrong (and possibly more permissive)
  // movepool.
  const species = Dex.species.get(speciesId);
  const parentIds: string[] = [];
  if (species?.changesFrom) parentIds.push(toID(species.changesFrom));
  if (species?.baseSpecies) parentIds.push(toID(species.baseSpecies));
  for (const parentId of parentIds) {
    if (!parentId || parentId === speciesId) continue;
    const cm = championsLearnsets[parentId]?.learnset;
    if (cm) return cm;
    const bm = baseLearnsets[parentId]?.learnset;
    if (bm) return bm;
  }
  // Last resort: if the own entry exists but had no Gen 9 sources, return it
  // anyway so the integrity check surfaces the issue rather than silently dropping.
  return base;
}

for (const pokemonId of championsIds) {
  const learnset = resolveLearnset(pokemonId);
  if (!learnset) {
    noLearnsetIds.push(pokemonId);
    continue;
  }

  for (const [moveId, sources] of Object.entries(learnset)) {
    // Keep only Gen 9 sources (prefix '9'); drop '8M', '7L1', etc.
    const gen9Sources = sources.filter((s) => s.startsWith('9'));
    if (!gen9Sources.length) continue;
    if (!validMoveIds.has(moveId)) {
      skippedMoveCounts.set(moveId, (skippedMoveCounts.get(moveId) ?? 0) + 1);
      continue;
    }
    insertRows.push({ pokemonId, moveId, sources: gen9Sources });
  }
}

// better-sqlite3 doesn't support async transactions. Do delete+insert in
// sequence; WAL mode keeps the reseed fast.
await db.delete(learnsets);
const CHUNK = 250; // 250 * 3 cols = 750 params, under SQLite cap
for (let i = 0; i < insertRows.length; i += CHUNK) {
  await db.insert(learnsets).values(insertRows.slice(i, i + CHUNK));
}

console.log(`champions roster: ${championsIds.length} pokemon`);
console.log(`  with learnset: ${championsIds.length - noLearnsetIds.length}`);
console.log(`  no learnset:   ${noLearnsetIds.length}`);
console.log(`  rows inserted: ${insertRows.length}`);
console.log(`  unknown move-ids skipped: ${skippedMoveCounts.size} distinct`);

if (noLearnsetIds.length) {
  console.log('\npokemon without learnset:');
  for (const id of noLearnsetIds) console.log(`  ${id}`);
}

if (skippedMoveCounts.size) {
  console.log(`\nmove ids referenced by learnsets but missing from moves table:`);
  for (const [id, n] of skippedMoveCounts) console.log(`  ${id} (${n} learner${n > 1 ? 's' : ''})`);
}

sqlite.close();

if (noLearnsetIds.length || skippedMoveCounts.size) {
  console.error('\nintegrity check failed');
  process.exit(1);
}
