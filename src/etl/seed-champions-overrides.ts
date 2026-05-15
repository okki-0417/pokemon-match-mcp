import 'dotenv/config';
import { eq, sql as raw } from 'drizzle-orm';
import { db, sqlite } from '../db/client.js';
import { abilities, pokemon, pokemonAbilities, type PokemonType } from '../db/schema/index.js';
import { otterlycluelessSource } from './sources/otterlyclueless.js';
import { chunked, chunkSize } from './_chunk.js';

type SlotName = 'primary' | 'secondary' | 'hidden';
type TypeName = PokemonType;

const source = otterlycluelessSource;

console.log(`source: ${source.name}`);

// 1. Custom abilities → upsert into abilities table so FK works.
const customAbilities = await source.loadCustomAbilities();
if (customAbilities.length) {
  const abilityRows = customAbilities.map((a) => ({
    id: a.id,
    nameEn: a.nameEn,
    nameJa: a.nameJa ?? null,
    description: a.description ?? null,
    flags: [],
    descLong: a.description ?? null,
  }));
  for (const slice of chunked(abilityRows, chunkSize(6))) {
    await db
      .insert(abilities)
      .values(slice)
      .onConflictDoUpdate({
        target: abilities.id,
        set: {
          nameJa: raw`COALESCE(EXCLUDED.name_ja, ${abilities.nameJa})`,
          description: raw`COALESCE(EXCLUDED.description, ${abilities.description})`,
        },
      });
  }
  console.log(`upserted ${customAbilities.length} abilities (with custom Champions ones)`);
}

// 2. Per-pokemon overrides.
const overrides = await source.loadOverrides();
console.log(`overrides loaded: ${overrides.length}`);

const knownPokemonIds = new Set(
  (await db.select({ id: pokemon.id }).from(pokemon)).map((r) => r.id),
);
const knownAbilityIds = new Set(
  (await db.select({ id: abilities.id }).from(abilities)).map((r) => r.id),
);

let typesUpdated = 0;
let statsUpdated = 0;
let abilitiesReplaced = 0;
const skipped: string[] = [];
const unknownAbilities = new Set<string>();

// better-sqlite3 doesn't support async transactions; rely on per-row idempotency.
for (const o of overrides) {
    if (!knownPokemonIds.has(o.pokemonId)) {
      skipped.push(o.pokemonId);
      continue;
    }

    // Stats / types overwrite as a single UPDATE.
    if (o.types || o.baseStats) {
      const set: Record<string, unknown> = {};
      if (o.types) {
        const t1 = o.types[0] as TypeName | undefined;
        if (!t1) throw new Error(`empty types array for ${o.pokemonId}`);
        set.type1 = t1;
        set.type2 = (o.types[1] as TypeName | undefined) ?? null;
      }
      if (o.baseStats) {
        Object.assign(set, o.baseStats);
      }
      await db.update(pokemon).set(set).where(eq(pokemon.id, o.pokemonId));
      if (o.types) typesUpdated++;
      if (o.baseStats) statsUpdated++;
    }

    // Abilities: completely replace the per-slot mapping. otterlyclueless lists
    // the Champions ability set per pokemon, so any mainline-only ability is
    // implicitly removed (megas typically have just 1 ability in Champions).
    if (o.abilities && o.abilities.length > 0) {
      const slotKeys: SlotName[] = ['primary', 'secondary', 'hidden'];
      const links: { pokemonId: string; abilityId: string; slot: SlotName }[] = [];
      o.abilities.slice(0, 3).forEach((name, i) => {
        const id = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!knownAbilityIds.has(id)) {
          unknownAbilities.add(`${name} (id=${id}) for ${o.pokemonId}`);
          return;
        }
        links.push({ pokemonId: o.pokemonId, abilityId: id, slot: slotKeys[i]! });
      });
      if (links.length > 0) {
        await db.delete(pokemonAbilities).where(eq(pokemonAbilities.pokemonId, o.pokemonId));
        await db.insert(pokemonAbilities).values(links).onConflictDoNothing();
        abilitiesReplaced++;
      }
    }
  }

console.log(`applied: types ${typesUpdated}, baseStats ${statsUpdated}, abilities replaced ${abilitiesReplaced}`);
if (skipped.length) {
  console.log(`skipped (pokemon id not in DB): ${skipped.length}`);
  for (const id of skipped.slice(0, 10)) console.log(`  ${id}`);
}
if (unknownAbilities.size) {
  console.log(`unknown abilities (not in abilities table): ${unknownAbilities.size}`);
  for (const u of [...unknownAbilities].slice(0, 10)) console.log(`  ${u}`);
}

sqlite.close();
