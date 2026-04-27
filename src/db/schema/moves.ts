import { pgEnum, pgTable, integer, text, primaryKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { pokemon, pokemonType } from './pokemon.js';

export const moveCategory = pgEnum('move_category', ['physical', 'special', 'status']);

export const moves = pgTable('moves', {
  id: text('id').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameJa: text('name_ja'),
  type: pokemonType('type').notNull(),
  category: moveCategory('category').notNull(),
  basePower: integer('base_power').notNull(),
  accuracy: integer('accuracy'),
  pp: integer('pp').notNull(),
  priority: integer('priority').notNull().default(0),
  description: text('description'),
});

export const learnsets = pgTable(
  'learnsets',
  {
    pokemonId: text('pokemon_id')
      .notNull()
      .references(() => pokemon.id, { onDelete: 'cascade' }),
    moveId: text('move_id')
      .notNull()
      .references(() => moves.id, { onDelete: 'restrict' }),
    sources: text('sources').array().notNull(),
  },
  (t) => [primaryKey({ columns: [t.pokemonId, t.moveId] })],
);

export const movesRelations = relations(moves, ({ many }) => ({
  learnsets: many(learnsets),
}));

export const learnsetsRelations = relations(learnsets, ({ one }) => ({
  pokemon: one(pokemon, {
    fields: [learnsets.pokemonId],
    references: [pokemon.id],
  }),
  move: one(moves, {
    fields: [learnsets.moveId],
    references: [moves.id],
  }),
}));
