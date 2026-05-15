import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { Dex } from '@pkmn/dex';
import { sql as raw } from 'drizzle-orm';
import { db, sqlite } from '../db/client.js';
import {
  moves,
  POKEMON_TYPES,
  MOVE_CATEGORIES,
  MOVE_TARGETS,
  type PokemonType,
  type MoveCategory,
  type MoveTarget,
} from '../db/schema/index.js';
import type { IgnoreImmunity, MoveSecondary, Multihit } from '../db/schema/moves.js';
import { chunked, chunkSize } from './_chunk.js';

type MoveInsert = typeof moves.$inferInsert;
type TypeName = PokemonType;
type CategoryName = MoveCategory;
type TargetName = MoveTarget;

const TYPE_NAMES = new Set<TypeName>(POKEMON_TYPES);
const CATEGORY_NAMES = new Set<CategoryName>(MOVE_CATEGORIES);
const TARGET_NAMES = new Set<TargetName>(MOVE_TARGETS);
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

function toTargetName(rawTarget: string): TargetName {
  if (!TARGET_NAMES.has(rawTarget as TargetName)) {
    throw new Error(`Unknown move target "${rawTarget}"`);
  }
  return rawTarget as TargetName;
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

  // flags is a record where keys are flag names (only set keys are present).
  const flagNames = move.flags ? Object.keys(move.flags) : [];

  // Prefer `secondaries` (canonical array form). Fall back to single `secondary`.
  let secondaries: MoveSecondary[] | null = null;
  if (move.secondaries && move.secondaries.length > 0) {
    secondaries = move.secondaries as MoveSecondary[];
  } else if (move.secondary) {
    secondaries = [move.secondary as MoveSecondary];
  }

  // selfSwitch in dex: true | 'copyvolatile' | 'shedtail'. Normalize to text.
  let selfSwitch: string | null = null;
  if (move.selfSwitch === true) selfSwitch = 'normal';
  else if (typeof move.selfSwitch === 'string') selfSwitch = move.selfSwitch;

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
    target: toTargetName(move.target),
    flags: flagNames,
    secondaries,
    description: move.shortDesc ?? move.desc ?? null,
    critRatio: move.critRatio ?? 1,
    multihit: (move.multihit ?? null) as Multihit | null,
    drain: move.drain ? Array.from(move.drain) : null,
    recoil: move.recoil ? Array.from(move.recoil) : null,
    heal: move.heal ? Array.from(move.heal) : null,
    selfSwitch,
    volatileStatus: move.volatileStatus ?? null,
    ignoreAbility: move.ignoreAbility === true,
    ignoreImmunity: (move.ignoreImmunity ?? false) as IgnoreImmunity,
    nonGhostTarget: move.nonGhostTarget ?? null,
    descLong: move.desc ?? null,
  });
}

for (const slice of chunked(rows, chunkSize(24)))
await db
  .insert(moves)
  .values(slice)
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
      target: raw`excluded.target`,
      flags: raw`excluded.flags`,
      secondaries: raw`excluded.secondaries`,
      description: raw`excluded.description`,
      critRatio: raw`excluded.crit_ratio`,
      multihit: raw`excluded.multihit`,
      drain: raw`excluded.drain`,
      recoil: raw`excluded.recoil`,
      heal: raw`excluded.heal`,
      selfSwitch: raw`excluded.self_switch`,
      volatileStatus: raw`excluded.volatile_status`,
      ignoreAbility: raw`excluded.ignore_ability`,
      ignoreImmunity: raw`excluded.ignore_immunity`,
      nonGhostTarget: raw`excluded.non_ghost_target`,
      descLong: raw`excluded.desc_long`,
    },
  });

console.log(`seeded ${rows.length} moves`);

sqlite.close();
