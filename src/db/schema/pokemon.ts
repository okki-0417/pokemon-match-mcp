import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { abilities } from './abilities.js';

// Mirrors pgEnum 'pokemon_type' — kept as text in SQLite (no enum support).
// Validation lives in TypeScript via TYPE_NAMES in domain/type-chart.
export const POKEMON_TYPES = [
  'normal','fire','water','electric','grass','ice','fighting','poison',
  'ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy',
] as const;
export type PokemonType = (typeof POKEMON_TYPES)[number];

export const ABILITY_SLOTS = ['primary', 'secondary', 'hidden'] as const;
export type AbilitySlot = (typeof ABILITY_SLOTS)[number];

export type GenderRatio = { M: number; F: number };

export const pokemon = sqliteTable('pokemon', {
  id: text('id').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameJa: text('name_ja'),
  type1: text('type1').$type<PokemonType>().notNull(),
  type2: text('type2').$type<PokemonType>(),
  hp: integer('hp').notNull(),
  atk: integer('atk').notNull(),
  def: integer('def').notNull(),
  spa: integer('spa').notNull(),
  spd: integer('spd').notNull(),
  spe: integer('spe').notNull(),
  isChampions: integer('is_champions', { mode: 'boolean' }).notNull().default(false),
  championsTier: text('champions_tier'),
  weightkg: real('weightkg').notNull(),
  gen: integer('gen').notNull(),
  dexNum: integer('dex_num').notNull(),
  baseSpecies: text('base_species').notNull(),
  forme: text('forme'),
  prevo: text('prevo'),
  evos: text('evos', { mode: 'json' }).$type<string[]>().notNull().default([]),
  otherFormes: text('other_formes', { mode: 'json' }).$type<string[]>().notNull().default([]),
  isMega: integer('is_mega', { mode: 'boolean' }).notNull().default(false),
  isPrimal: integer('is_primal', { mode: 'boolean' }).notNull().default(false),
  eggGroups: text('egg_groups', { mode: 'json' }).$type<string[]>().notNull().default([]),
  genderRatio: text('gender_ratio', { mode: 'json' }).$type<GenderRatio>(),
  tier: text('tier'),
  doublesTier: text('doubles_tier'),
  natDexTier: text('nat_dex_tier'),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
});

export const pokemonAbilities = sqliteTable(
  'pokemon_abilities',
  {
    pokemonId: text('pokemon_id')
      .notNull()
      .references(() => pokemon.id, { onDelete: 'cascade' }),
    abilityId: text('ability_id')
      .notNull()
      .references(() => abilities.id, { onDelete: 'restrict' }),
    slot: text('slot').$type<AbilitySlot>().notNull(),
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
