import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const NATURE_STATS = ['atk', 'def', 'spa', 'spd', 'spe'] as const;
export type NatureStat = (typeof NATURE_STATS)[number];

export const natures = sqliteTable('natures', {
  id: text('id').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameJa: text('name_ja'),
  plus: text('plus').$type<NatureStat>(),
  minus: text('minus').$type<NatureStat>(),
});
