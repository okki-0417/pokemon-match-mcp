import { pgEnum, pgTable, integer, text, primaryKey, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { abilities } from './abilities.js';

export const pokemonType = pgEnum('pokemon_type', [
  'normal',
  'fire',
  'water',
  'electric',
  'grass',
  'ice',
  'fighting',
  'poison',
  'ground',
  'flying',
  'psychic',
  'bug',
  'rock',
  'ghost',
  'dragon',
  'dark',
  'steel',
  'fairy',
]);

export const abilitySlot = pgEnum('ability_slot', ['primary', 'secondary', 'hidden']);

export const pokemon = pgTable('pokemon', {
  id: text('id').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameJa: text('name_ja'),
  type1: pokemonType('type1').notNull(),
  type2: pokemonType('type2'),
  hp: integer('hp').notNull(),
  atk: integer('atk').notNull(),
  def: integer('def').notNull(),
  spa: integer('spa').notNull(),
  spd: integer('spd').notNull(),
  spe: integer('spe').notNull(),
  isChampions: boolean('is_champions').notNull().default(false),
  championsTier: text('champions_tier'),
});

export const pokemonAbilities = pgTable(
  'pokemon_abilities',
  {
    pokemonId: text('pokemon_id')
      .notNull()
      .references(() => pokemon.id, { onDelete: 'cascade' }),
    abilityId: text('ability_id')
      .notNull()
      .references(() => abilities.id, { onDelete: 'restrict' }),
    slot: abilitySlot('slot').notNull(),
  },
  (t) => [primaryKey({ columns: [t.pokemonId, t.abilityId] })],
);

export const pokemonRelations = relations(pokemon, ({ many }) => ({
  abilities: many(pokemonAbilities),
}));

export const pokemonAbilitiesRelations = relations(pokemonAbilities, ({ one }) => ({
  pokemon: one(pokemon, {
    fields: [pokemonAbilities.pokemonId],
    references: [pokemon.id],
  }),
  ability: one(abilities, {
    fields: [pokemonAbilities.abilityId],
    references: [abilities.id],
  }),
}));
