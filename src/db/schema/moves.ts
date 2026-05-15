import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { pokemon } from './pokemon.js';

export const MOVE_CATEGORIES = ['physical', 'special', 'status'] as const;
export type MoveCategory = (typeof MOVE_CATEGORIES)[number];

export const MOVE_TARGETS = [
  'normal','self','any','adjacentAlly','adjacentAllyOrSelf','adjacentFoe',
  'allAdjacent','allAdjacentFoes','allies','allySide','allyTeam','foeSide',
  'all','randomNormal','scripted',
] as const;
export type MoveTarget = (typeof MOVE_TARGETS)[number];

export type MoveSecondary = {
  chance: number;
  status?: string;
  volatileStatus?: string;
  boosts?: Record<string, number>;
  self?: { boosts?: Record<string, number>; volatileStatus?: string };
  dustproof?: boolean;
  kingsrock?: boolean;
};

export type Multihit = number | [number, number];
export type IgnoreImmunity = boolean | Record<string, boolean>;

export const moves = sqliteTable('moves', {
  id: text('id').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameJa: text('name_ja'),
  type: text('type').notNull(), // PokemonType
  category: text('category').$type<MoveCategory>().notNull(),
  basePower: integer('base_power').notNull(),
  accuracy: integer('accuracy'),
  pp: integer('pp').notNull(),
  priority: integer('priority').notNull().default(0),
  target: text('target').$type<MoveTarget>().notNull(),
  flags: text('flags', { mode: 'json' }).$type<string[]>().notNull(),
  secondaries: text('secondaries', { mode: 'json' }).$type<MoveSecondary[] | null>(),
  description: text('description'),
  critRatio: integer('crit_ratio').notNull().default(1),
  multihit: text('multihit', { mode: 'json' }).$type<Multihit | null>(),
  drain: text('drain', { mode: 'json' }).$type<number[] | null>(),
  recoil: text('recoil', { mode: 'json' }).$type<number[] | null>(),
  heal: text('heal', { mode: 'json' }).$type<number[] | null>(),
  selfSwitch: text('self_switch'),
  volatileStatus: text('volatile_status'),
  ignoreAbility: integer('ignore_ability', { mode: 'boolean' }).notNull().default(false),
  ignoreImmunity: text('ignore_immunity', { mode: 'json' }).$type<IgnoreImmunity>().notNull().default(false as never),
  nonGhostTarget: text('non_ghost_target'),
  descLong: text('desc_long'),
});

export const learnsets = sqliteTable(
  'learnsets',
  {
    pokemonId: text('pokemon_id')
      .notNull()
      .references(() => pokemon.id, { onDelete: 'cascade' }),
    moveId: text('move_id')
      .notNull()
      .references(() => moves.id, { onDelete: 'restrict' }),
    sources: text('sources', { mode: 'json' }).$type<string[]>().notNull(),
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
