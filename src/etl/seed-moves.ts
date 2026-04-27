import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { Dex } from '@pkmn/dex';
import { sql as raw } from 'drizzle-orm';
import { db, sql } from '../db/client.js';
import { moves, pokemonType, moveCategory } from '../db/schema/index.js';

type MoveInsert = typeof moves.$inferInsert;
type TypeName = (typeof pokemonType.enumValues)[number];
type CategoryName = (typeof moveCategory.enumValues)[number];

const TYPE_NAMES = new Set<TypeName>(pokemonType.enumValues);
const CATEGORY_NAMES = new Set<CategoryName>(moveCategory.enumValues);
const ALLOWED_NONSTANDARD = new Set<string | null>([null, 'Past', 'Future']);

function toTypeName(rawType: string): TypeName {
  const lower = rawType.toLowerCase();
  if (!TYPE_NAMES.has(lower as TypeName)) throw new Error(`Unknown type "${rawType}"`);
  return lower as TypeName;
}

function toCategoryName(rawCat: string): CategoryName {
  const lower = rawCat.toLowerCase();
  if (!CATEGORY_NAMES.has(lower as CategoryName)) throw new Error(`Unknown category "${rawCat}"`);
  return lower as CategoryName;
}

const jpNames = JSON.parse(await readFile('data/jp-names.json', 'utf8')) as {
  moves?: Record<string, string>;
};
const movesJa = jpNames.moves ?? {};

// Champions mod move overrides — re-enable some moves marked Unobtainable in base
// (e.g. burnup, corrosivegas) and re-classify others to Past. The mod file embeds
// TypeScript function bodies that won't eval as JS, so extract only the structural
// fields we need (isNonstandard) via regex over each top-level move block.
const championsMovesText = await readFile('data/showdown-champions/moves.ts', 'utf8');
const championsNonstandardOverrides = new Map<string, string | null>();
const moveBlockRegex = /^\t(\w+):\s*\{([\s\S]*?)^\t\},$/gm;
for (const match of championsMovesText.matchAll(moveBlockRegex)) {
  const moveId = match[1]!;
  const body = match[2]!;
  const nsMatch = body.match(/\bisNonstandard:\s*(null|"[^"]+")/);
  if (!nsMatch) continue;
  const v = nsMatch[1]!;
  championsNonstandardOverrides.set(moveId, v === 'null' ? null : v.slice(1, -1));
}

// @pkmn/dex returns Hidden Power once per type variant (17 entries, all id='hiddenpower'). Dedupe by id.
const seenIds = new Set<string>();
const rows: MoveInsert[] = [];
for (const move of Dex.moves.all()) {
  if (move.id === '') continue;
  if (seenIds.has(move.id)) continue;

  const baseNs = move.isNonstandard ?? null;
  const effectiveNonstandard = championsNonstandardOverrides.has(move.id)
    ? championsNonstandardOverrides.get(move.id) ?? null
    : baseNs;
  if (!ALLOWED_NONSTANDARD.has(effectiveNonstandard)) continue;
  seenIds.add(move.id);

  // accuracy: number | true (true = always hits). Store true as null.
  const accuracy = typeof move.accuracy === 'number' ? move.accuracy : null;

  rows.push({
    id: move.id,
    nameEn: move.name,
    nameJa: movesJa[move.id] ?? null,
    type: toTypeName(move.type),
    category: toCategoryName(move.category),
    basePower: move.basePower ?? 0,
    accuracy,
    pp: move.pp ?? 0,
    priority: move.priority ?? 0,
    description: move.shortDesc ?? move.desc ?? null,
  });
}

await db
  .insert(moves)
  .values(rows)
  .onConflictDoUpdate({
    target: moves.id,
    set: {
      nameEn: raw`excluded.name_en`,
      nameJa: raw`excluded.name_ja`,
      type: raw`excluded.type`,
      category: raw`excluded.category`,
      basePower: raw`excluded.base_power`,
      accuracy: raw`excluded.accuracy`,
      pp: raw`excluded.pp`,
      priority: raw`excluded.priority`,
      description: raw`excluded.description`,
    },
  });

console.log(`seeded ${rows.length} moves`);

await sql.end();
