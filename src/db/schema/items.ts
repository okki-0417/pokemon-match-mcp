import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export type MegaStoneMap = Record<string, string>;
export type Fling = {
  basePower: number;
  status?: string;
  volatileStatus?: string;
  boosts?: Record<string, number>;
};
export type NaturalGift = { basePower: number; type: string };

export const items = sqliteTable('items', {
  id: text('id').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameJa: text('name_ja'),
  description: text('description'),
  isChampions: integer('is_champions', { mode: 'boolean' }).notNull().default(false),
  isBerry: integer('is_berry', { mode: 'boolean' }).notNull().default(false),
  megaStone: text('mega_stone', { mode: 'json' }).$type<MegaStoneMap | null>(),
  fling: text('fling', { mode: 'json' }).$type<Fling | null>(),
  naturalGift: text('natural_gift', { mode: 'json' }).$type<NaturalGift | null>(),
  itemUser: text('item_user', { mode: 'json' }).$type<string[] | null>(),
  onMemory: text('on_memory'),
  descLong: text('desc_long'),
});
