import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { pokemonAbilities } from './pokemon.js';

export const abilities = sqliteTable('abilities', {
  id: text('id').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameJa: text('name_ja'),
  description: text('description'),
  flags: text('flags', { mode: 'json' }).$type<string[]>().notNull().default([]),
  descLong: text('desc_long'),
});

export const abilitiesRelations = relations(abilities, ({ many }) => ({
  pokemon: many(pokemonAbilities),
}));
