import { pgTable, text } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { pokemonAbilities } from './pokemon.js';

export const abilities = pgTable('abilities', {
  id: text('id').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameJa: text('name_ja'),
  description: text('description'),
});

export const abilitiesRelations = relations(abilities, ({ many }) => ({
  pokemon: many(pokemonAbilities),
}));
