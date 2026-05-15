import { sqliteTable, text, integer, real, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { pokemon } from './pokemon.js';

export type WeightedCounts = Record<string, number>;

export const usageStats = sqliteTable(
  'usage_stats',
  {
    format: text('format').notNull(),
    yearMonth: text('year_month').notNull(),
    eloCutoff: integer('elo_cutoff').notNull(),
    pokemonId: text('pokemon_id')
      .notNull()
      .references(() => pokemon.id, { onDelete: 'cascade' }),
    usagePct: real('usage_pct').notNull(),
    rawCount: integer('raw_count').notNull(),
    moves: text('moves', { mode: 'json' }).$type<WeightedCounts>().notNull(),
    items: text('items', { mode: 'json' }).$type<WeightedCounts>().notNull(),
    abilities: text('abilities', { mode: 'json' }).$type<WeightedCounts>().notNull(),
    teammates: text('teammates', { mode: 'json' }).$type<WeightedCounts>().notNull(),
    spreads: text('spreads', { mode: 'json' }).$type<WeightedCounts>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.format, t.yearMonth, t.eloCutoff, t.pokemonId] }),
    index('idx_usage_stats_format_ym_elo_usage')
      .on(t.format, t.yearMonth, t.eloCutoff, sql`${t.usagePct} DESC`),
  ],
);

export const usageStatsRelations = relations(usageStats, ({ one }) => ({
  pokemon: one(pokemon, {
    fields: [usageStats.pokemonId],
    references: [pokemon.id],
  }),
}));
