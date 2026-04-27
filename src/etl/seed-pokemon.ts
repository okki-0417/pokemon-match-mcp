import 'dotenv/config';
import { Generations, type Dex as DataDex } from '@pkmn/data';
import { Dex } from '@pkmn/dex';
import { db, sql } from '../db/client.js';
import {
  pokemon,
  abilities,
  pokemonAbilities,
  pokemonType,
  abilitySlot,
} from '../db/schema/index.js';

type PokemonInsert = typeof pokemon.$inferInsert;
type AbilityInsert = typeof abilities.$inferInsert;
type PokemonAbilityInsert = typeof pokemonAbilities.$inferInsert;
type TypeName = (typeof pokemonType.enumValues)[number];
type SlotName = (typeof abilitySlot.enumValues)[number];

const TYPE_NAMES = new Set<TypeName>(pokemonType.enumValues);

function toTypeName(raw: string): TypeName {
  const lower = raw.toLowerCase();
  if (!TYPE_NAMES.has(lower as TypeName)) {
    throw new Error(`Unknown type "${raw}"`);
  }
  return lower as TypeName;
}

const SLOT_MAP: Record<string, SlotName> = {
  '0': 'primary',
  '1': 'secondary',
  H: 'hidden',
};

// @pkmn/dex's Dex and @pkmn/data's Dex types diverge slightly; runtime is compatible.
const gens = new Generations(Dex as unknown as DataDex);
const gen = gens.get(9);

const abilityRows = new Map<string, AbilityInsert>();
const pokemonRows: PokemonInsert[] = [];
const pokemonAbilityRows: PokemonAbilityInsert[] = [];

for (const species of gen.species) {
  if (species.isNonstandard) continue;
  if (species.num <= 0) continue;

  const types = species.types.map(toTypeName);
  const type1 = types[0];
  if (!type1) {
    throw new Error(`Species ${species.name} has no types`);
  }

  pokemonRows.push({
    id: species.id,
    nameEn: species.name,
    nameJa: null,
    type1,
    type2: types[1] ?? null,
    hp: species.baseStats.hp,
    atk: species.baseStats.atk,
    def: species.baseStats.def,
    spa: species.baseStats.spa,
    spd: species.baseStats.spd,
    spe: species.baseStats.spe,
  });

  for (const [slotKey, abilityName] of Object.entries(species.abilities)) {
    if (!abilityName) continue;
    const slot = SLOT_MAP[slotKey];
    if (!slot) continue;

    const ability = gen.abilities.get(abilityName);
    if (!ability) continue;

    if (!abilityRows.has(ability.id)) {
      abilityRows.set(ability.id, {
        id: ability.id,
        nameEn: ability.name,
        nameJa: null,
        description: ability.shortDesc ?? ability.desc ?? null,
      });
    }

    pokemonAbilityRows.push({
      pokemonId: species.id,
      abilityId: ability.id,
      slot,
    });
  }
}

await db.insert(abilities).values(Array.from(abilityRows.values())).onConflictDoNothing();
await db.insert(pokemon).values(pokemonRows).onConflictDoNothing();
await db.insert(pokemonAbilities).values(pokemonAbilityRows).onConflictDoNothing();

console.log(
  `seeded: ${abilityRows.size} abilities, ${pokemonRows.length} pokemon, ${pokemonAbilityRows.length} pokemon_abilities`,
);

await sql.end();
