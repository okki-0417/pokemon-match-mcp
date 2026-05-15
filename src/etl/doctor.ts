import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { Dex, toID } from '@pkmn/dex';
import { and, eq, inArray, isNotNull, isNull, sql as raw } from 'drizzle-orm';
import { otterlycluelessSource } from './sources/otterlyclueless.js';
import { db, sqlite } from '../db/client.js';
import {
  pokemon,
  pokemonAbilities,
  abilities,
  moves,
  learnsets,
  items,
  usageStats,
} from '../db/schema/index.js';
import { normalizePokemonId } from '../db/lookup.js';

type CheckResult = {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  details?: string[];
};

const results: CheckResult[] = [];

function ok(name: string, message: string): void {
  results.push({ name, status: 'pass', message });
}
function warn(name: string, message: string, details?: string[]): void {
  results.push(details ? { name, status: 'warn', message, details } : { name, status: 'warn', message });
}
function fail(name: string, message: string, details?: string[]): void {
  results.push(details ? { name, status: 'fail', message, details } : { name, status: 'fail', message });
}

// --- Pre-compute commonly used sets ------------------------------------------

const pokeRows = await db
  .select({
    id: pokemon.id,
    nameEn: pokemon.nameEn,
    baseSpecies: pokemon.baseSpecies,
    prevo: pokemon.prevo,
    isChampions: pokemon.isChampions,
    isMega: pokemon.isMega,
  })
  .from(pokemon);
const pokeIds = new Set(pokeRows.map((r) => r.id));
const championsRows = pokeRows.filter((r) => r.isChampions);
const championsIds = new Set(championsRows.map((r) => r.id));
const nameEnToId = new Map(pokeRows.map((r) => [r.nameEn, r.id]));

// --- 1. Champions roster all have learnset -----------------------------------

{
  const r = await db
    .select({ id: pokemon.id, n: raw<number>`cast(count(${learnsets.moveId}) as integer)` })
    .from(pokemon)
    .leftJoin(learnsets, eq(learnsets.pokemonId, pokemon.id))
    .where(eq(pokemon.isChampions, true))
    .groupBy(pokemon.id);
  const missing = r.filter((x) => x.n === 0).map((x) => x.id);
  if (missing.length === 0) {
    ok('champions_have_learnset', `all ${r.length} Champions roster have ≥1 learnset entry`);
  } else {
    fail('champions_have_learnset', `${missing.length} Champions pokemon have 0 moves`, missing);
  }
}

// --- 2. Champions roster all have ≥1 ability ---------------------------------

{
  const r = await db
    .select({ id: pokemon.id, n: raw<number>`cast(count(${pokemonAbilities.abilityId}) as integer)` })
    .from(pokemon)
    .leftJoin(pokemonAbilities, eq(pokemonAbilities.pokemonId, pokemon.id))
    .where(eq(pokemon.isChampions, true))
    .groupBy(pokemon.id);
  const missing = r.filter((x) => x.n === 0).map((x) => x.id);
  if (missing.length === 0) {
    ok('champions_have_ability', `all ${r.length} Champions roster have ≥1 ability`);
  } else {
    fail('champions_have_ability', `${missing.length} Champions pokemon have 0 abilities`, missing);
  }
}

// --- 3. Mega Pokemon learnset comes from the correct parent ------------------
// For each Champions mega whose changesFrom != baseSpecies, the move count must
// equal the parent (changesFrom) species' move count. Catches the Floette-Mega
// / Meowstic-F-Mega class of bug.

{
  const moveCounts = await db
    .select({ id: learnsets.pokemonId, n: raw<number>`cast(count(*) as integer)` })
    .from(learnsets)
    .groupBy(learnsets.pokemonId);
  const countById = new Map(moveCounts.map((x) => [x.id, x.n]));

  const mismatches: string[] = [];
  for (const p of championsRows.filter((r) => r.isMega)) {
    const s = Dex.species.get(p.id);
    if (!s.exists || !s.changesFrom) continue;
    const cf = toID(s.changesFrom);
    const bs = toID(s.baseSpecies);
    if (cf === bs) continue; // ambiguity-free
    const megaCount = countById.get(p.id) ?? 0;
    const cfCount = countById.get(cf) ?? null;
    if (cfCount === null) continue; // parent not in roster, can't compare directly
    if (megaCount !== cfCount) {
      mismatches.push(
        `${p.id}: ${megaCount} moves but changesFrom=${cf} has ${cfCount} (likely inherited from baseSpecies=${bs})`,
      );
    }
  }
  if (mismatches.length === 0) {
    ok('mega_inherits_changesFrom', 'all megas with split changesFrom/baseSpecies inherit correctly');
  } else {
    fail('mega_inherits_changesFrom', `${mismatches.length} mega(s) inherit from wrong parent`, mismatches);
  }
}

// --- 3b. Champions megas have their changesFrom species also Champions ------
// You must bring the pre-mega form to mega-evolve, so its is_champions must hold.

{
  const broken: string[] = [];
  for (const p of championsRows.filter((r) => r.isMega)) {
    const s = Dex.species.get(p.id);
    if (!s.exists || !s.changesFrom) continue;
    const cf = toID(s.changesFrom);
    if (!cf || cf === p.id) continue;
    if (!championsIds.has(cf) && pokeIds.has(cf)) {
      broken.push(`${p.id} requires base ${cf}, but base is not is_champions`);
    }
  }
  if (broken.length === 0) {
    ok('mega_base_in_champions', 'all Champions megas have their pre-form in Champions roster');
  } else {
    fail('mega_base_in_champions', `${broken.length} mega(s) missing pre-form in Champions`, broken);
  }
}

// --- 4. Champions item mega_stone holders are in Champions roster -----------

{
  const itemRows = await db
    .select({ id: items.id, nameEn: items.nameEn, megaStone: items.megaStone })
    .from(items)
    .where(and(eq(items.isChampions, true), isNotNull(items.megaStone)));
  const missing: string[] = [];
  for (const it of itemRows) {
    if (!it.megaStone) continue;
    for (const holderEn of Object.keys(it.megaStone)) {
      const holderId = nameEnToId.get(holderEn);
      if (!holderId) {
        missing.push(`${it.id} (${it.nameEn}): holder "${holderEn}" not in pokemon table`);
      } else if (!championsIds.has(holderId)) {
        missing.push(`${it.id} (${it.nameEn}): holder ${holderEn} not in Champions roster`);
      }
    }
  }
  if (missing.length === 0) {
    ok('champions_mega_holders', `all ${itemRows.length} Champions mega stones map to Champions holders`);
  } else {
    warn('champions_mega_holders', `${missing.length} mega stone(s) reference non-Champions holders`, missing);
  }
}

// --- 5. Champions item itemUser entries exist in pokemon table --------------

{
  const itemRows = await db
    .select({ id: items.id, nameEn: items.nameEn, itemUser: items.itemUser })
    .from(items)
    .where(eq(items.isChampions, true));
  const missing: string[] = [];
  for (const it of itemRows) {
    if (!it.itemUser) continue;
    for (const userEn of it.itemUser) {
      if (!nameEnToId.has(userEn)) {
        missing.push(`${it.id} (${it.nameEn}): itemUser "${userEn}" not in pokemon table`);
      }
    }
  }
  if (missing.length === 0) {
    ok('champions_item_user_exists', 'all Champions item.itemUser entries resolve');
  } else {
    warn('champions_item_user_exists', `${missing.length} itemUser entries unresolved`, missing);
  }
}

// --- 6. pokemon.prevo references valid pokemon (by EN name) -----------------

{
  const broken: string[] = [];
  for (const p of pokeRows) {
    if (!p.prevo) continue;
    if (!nameEnToId.has(p.prevo)) {
      broken.push(`${p.id} (${p.nameEn}) → prevo="${p.prevo}" not found`);
    }
  }
  if (broken.length === 0) {
    ok('prevo_references_valid', 'all pokemon.prevo entries resolve');
  } else {
    fail('prevo_references_valid', `${broken.length} broken prevo references`, broken);
  }
}

// --- 7. usage_stats pokemon are in Champions roster --------------------------
// FK already guarantees pokemon_id is valid; verify they're also is_champions.

{
  const rows = await db
    .select({ id: usageStats.pokemonId, isC: pokemon.isChampions })
    .from(usageStats)
    .innerJoin(pokemon, eq(usageStats.pokemonId, pokemon.id));
  const nonChamp = rows.filter((r) => !r.isC).map((r) => r.id);
  if (nonChamp.length === 0) {
    ok('usage_stats_in_champions', `all ${rows.length} usage_stats rows reference Champions roster`);
  } else {
    warn('usage_stats_in_champions', `${nonChamp.length} usage_stats rows for non-Champions pokemon`, nonChamp);
  }
}

// --- 8. usage_stats moves/items/abilities/teammates resolve to DB ----------
// Aggregate unique keys across all usage_stats rows, then check DB membership.

{
  const allRows = await db
    .select({ moves: usageStats.moves, items: usageStats.items, abilities: usageStats.abilities, teammates: usageStats.teammates })
    .from(usageStats);
  const moveKeys = new Set<string>();
  const itemKeys = new Set<string>();
  const abilityKeys = new Set<string>();
  const teammateKeys = new Set<string>();
  for (const r of allRows) {
    for (const k of Object.keys(r.moves)) moveKeys.add(k);
    for (const k of Object.keys(r.items)) itemKeys.add(k);
    for (const k of Object.keys(r.abilities)) abilityKeys.add(k);
    for (const k of Object.keys(r.teammates)) teammateKeys.add(normalizePokemonId(k));
  }
  // Strip ladder noise: usage_stats sometimes records "nothing" for no-item slots.
  itemKeys.delete('nothing');

  const dbMoveIds = new Set((await db.select({ id: moves.id }).from(moves)).map((r) => r.id));
  const dbItemIds = new Set((await db.select({ id: items.id }).from(items)).map((r) => r.id));
  const dbAbilityIds = new Set((await db.select({ id: abilities.id }).from(abilities)).map((r) => r.id));

  const missingMoves = [...moveKeys].filter((k) => !dbMoveIds.has(k));
  const missingItems = [...itemKeys].filter((k) => !dbItemIds.has(k));
  const missingAbilities = [...abilityKeys].filter((k) => !dbAbilityIds.has(k));
  const missingTeammates = [...teammateKeys].filter((k) => !pokeIds.has(k));

  const unresolved: string[] = [];
  if (missingMoves.length) unresolved.push(`moves: ${missingMoves.slice(0, 10).join(', ')}${missingMoves.length > 10 ? '...' : ''} (${missingMoves.length})`);
  if (missingItems.length) unresolved.push(`items: ${missingItems.slice(0, 10).join(', ')}${missingItems.length > 10 ? '...' : ''} (${missingItems.length})`);
  if (missingAbilities.length) unresolved.push(`abilities: ${missingAbilities.slice(0, 10).join(', ')}${missingAbilities.length > 10 ? '...' : ''} (${missingAbilities.length})`);
  if (missingTeammates.length) unresolved.push(`teammates: ${missingTeammates.slice(0, 10).join(', ')}${missingTeammates.length > 10 ? '...' : ''} (${missingTeammates.length})`);

  if (unresolved.length === 0) {
    ok('usage_stats_keys_resolve', 'all usage_stats sub-keys resolve in DB');
  } else {
    warn('usage_stats_keys_resolve', 'some usage_stats keys are not in DB (often expected: new content / removed forms)', unresolved);
  }
}

// --- 9. learnset references real moves --------------------------------------
// FK ensures this; reaffirm.

{
  const r = await db
    .select({ n: raw<number>`cast(count(*) as integer)` })
    .from(learnsets)
    .leftJoin(moves, eq(learnsets.moveId, moves.id))
    .where(isNull(moves.id));
  const n = r[0]?.n ?? 0;
  if (n === 0) {
    ok('learnsets_reference_moves', 'all learnset rows reference existing moves (FK)');
  } else {
    fail('learnsets_reference_moves', `${n} learnset rows reference missing moves`);
  }
}

// --- 9b. Champions overrides applied (signal-based detection) ---------------
// If the otterlyclueless cache exists, verify that a sample of overridden
// pokemon have their Champions abilities (not mainline ones). Catches the
// "ran seed-pokemon standalone after seed-champions-overrides" scenario.

{
  let overrides: Awaited<ReturnType<typeof otterlycluelessSource.loadOverrides>> = [];
  try {
    await readFile('data/champions-overrides/raw/roster.json', 'utf8');
    overrides = await otterlycluelessSource.loadOverrides();
  } catch {
    warn('champions_overrides_applied', 'override cache not found (run pnpm data:fetch-champions-overrides first)');
    overrides = [];
  }

  if (overrides.length > 0) {
    const overrideMap = new Map<string, string[]>(
      overrides.filter((o) => o.abilities && o.abilities.length).map((o) => [o.pokemonId, o.abilities!]),
    );
    const overrideIds = [...overrideMap.keys()];
    const dbAbilities = await db
      .select({ pokemonId: pokemonAbilities.pokemonId, name: abilities.nameEn })
      .from(pokemonAbilities)
      .innerJoin(abilities, eq(pokemonAbilities.abilityId, abilities.id))
      .where(inArray(pokemonAbilities.pokemonId, overrideIds));
    const dbByPokemon = new Map<string, Set<string>>();
    for (const r of dbAbilities) {
      if (!dbByPokemon.has(r.pokemonId)) dbByPokemon.set(r.pokemonId, new Set());
      dbByPokemon.get(r.pokemonId)!.add(r.name);
    }
    const mismatched: string[] = [];
    for (const [pokemonId, expected] of overrideMap) {
      const actual = dbByPokemon.get(pokemonId);
      if (!actual) continue; // FK error caught elsewhere
      const missing = expected.filter((e) => !actual.has(e));
      if (missing.length > 0) {
        mismatched.push(`${pokemonId}: expected [${expected.join(', ')}], got [${[...actual].join(', ')}]`);
      }
    }
    if (mismatched.length === 0) {
      ok('champions_overrides_applied', `all ${overrideMap.size} override entries match DB state`);
    } else {
      fail(
        'champions_overrides_applied',
        `${mismatched.length} pokemon are missing Champions overrides — run \`pnpm db:seed-champions-overrides\``,
        mismatched,
      );
    }
  }
}

// --- 10. Champions abilities are seeded (no orphan refs) --------------------

{
  const r = await db
    .select({ id: pokemonAbilities.abilityId })
    .from(pokemonAbilities)
    .innerJoin(pokemon, eq(pokemonAbilities.pokemonId, pokemon.id))
    .where(eq(pokemon.isChampions, true));
  const championsAbilityIds = new Set(r.map((x) => x.id));
  const seededAbilities = new Set(
    (await db.select({ id: abilities.id }).from(abilities).where(inArray(abilities.id, [...championsAbilityIds]))).map((x) => x.id),
  );
  const missing = [...championsAbilityIds].filter((id) => !seededAbilities.has(id));
  if (missing.length === 0) {
    ok('champions_ability_seeded', `all ${championsAbilityIds.size} ability ids used by Champions roster are seeded`);
  } else {
    fail('champions_ability_seeded', `${missing.length} ability ids missing`, missing);
  }
}

// --- Report ------------------------------------------------------------------

const passCount = results.filter((r) => r.status === 'pass').length;
const warnCount = results.filter((r) => r.status === 'warn').length;
const failCount = results.filter((r) => r.status === 'fail').length;

console.log(`\ndb:doctor — ${results.length} checks (${passCount} pass / ${warnCount} warn / ${failCount} fail)\n`);
for (const r of results) {
  const icon = r.status === 'pass' ? '✓' : r.status === 'warn' ? '⚠' : '✗';
  console.log(`${icon} ${r.name}: ${r.message}`);
  if (r.details && r.details.length) {
    const shown = r.details.slice(0, 15);
    for (const d of shown) console.log(`    - ${d}`);
    if (r.details.length > shown.length) {
      console.log(`    ... and ${r.details.length - shown.length} more`);
    }
  }
}
console.log();

sqlite.close();

if (failCount > 0) process.exit(1);
