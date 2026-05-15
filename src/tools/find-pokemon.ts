import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, asc, eq, gte, inArray, isNull, lte, not, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { pokemon, pokemonAbilities } from '../db/schema/index.js';
import {
  TYPE_NAMES,
  type TypeName,
  computeDefensiveMatchup,
} from '../domain/type-chart.js';

const typeEnum = z.enum(TYPE_NAMES as readonly [TypeName, ...TypeName[]]);

const inputSchema = {
  types_any: z
    .array(typeEnum)
    .optional()
    .describe('指定タイプのいずれかを持つポケモンに絞る。'),
  types_none: z
    .array(typeEnum)
    .optional()
    .describe('指定タイプを持たないポケモンに絞る。'),
  resists: z
    .array(typeEnum)
    .optional()
    .describe(
      '指定攻撃タイプすべてを半減以下 (×0.5/×0.25/×0) で受けるポケモンに絞る。タイプベースのみ、特性無効化は考慮しない。',
    ),
  min_hp: z.number().int().optional(),
  max_hp: z.number().int().optional(),
  min_atk: z.number().int().optional(),
  max_atk: z.number().int().optional(),
  min_def: z.number().int().optional(),
  max_def: z.number().int().optional(),
  min_spa: z.number().int().optional(),
  max_spa: z.number().int().optional(),
  min_spd: z.number().int().optional(),
  max_spd: z.number().int().optional(),
  min_spe: z.number().int().optional(),
  max_spe: z.number().int().optional(),
  min_total: z.number().int().optional(),
  max_total: z.number().int().optional(),
  has_ability: z
    .string()
    .optional()
    .describe('特性 ID (例: "roughskin")。この特性を持つポケモンに絞る。'),
  champions_only: z
    .boolean()
    .optional()
    .describe('true ならポケモンチャンピオンズ内定ロスターのみ。'),
  tiers: z
    .array(z.string())
    .optional()
    .describe(
      'Champions tier で絞る (例: ["OU"], ["Uber"], ["OU","Uber"])。指定すると champions_only も自動 true。',
    ),
  limit: z.number().int().min(1).max(500).optional().describe('デフォルト 50。'),
};

export function registerFindPokemon(server: McpServer): void {
  server.registerTool(
    'find_pokemon',
    {
      title: 'find_pokemon',
      description:
        'タイプ・防御耐性・種族値範囲・合計種族値・特性・Champions ロスター内定で絞り込み。結果は ID 順。compute_type_matchup と組み合わせて補完候補を探索する用途。',
      inputSchema,
    },
    async (args) => {
      const conditions = [];

      if (args.types_any?.length) {
        const ts = args.types_any;
        conditions.push(or(inArray(pokemon.type1, ts), inArray(pokemon.type2, ts))!);
      }
      if (args.types_none?.length) {
        const ts = args.types_none;
        conditions.push(not(inArray(pokemon.type1, ts)));
        conditions.push(or(isNull(pokemon.type2), not(inArray(pokemon.type2, ts)))!);
      }

      if (args.min_hp !== undefined) conditions.push(gte(pokemon.hp, args.min_hp));
      if (args.max_hp !== undefined) conditions.push(lte(pokemon.hp, args.max_hp));
      if (args.min_atk !== undefined) conditions.push(gte(pokemon.atk, args.min_atk));
      if (args.max_atk !== undefined) conditions.push(lte(pokemon.atk, args.max_atk));
      if (args.min_def !== undefined) conditions.push(gte(pokemon.def, args.min_def));
      if (args.max_def !== undefined) conditions.push(lte(pokemon.def, args.max_def));
      if (args.min_spa !== undefined) conditions.push(gte(pokemon.spa, args.min_spa));
      if (args.max_spa !== undefined) conditions.push(lte(pokemon.spa, args.max_spa));
      if (args.min_spd !== undefined) conditions.push(gte(pokemon.spd, args.min_spd));
      if (args.max_spd !== undefined) conditions.push(lte(pokemon.spd, args.max_spd));
      if (args.min_spe !== undefined) conditions.push(gte(pokemon.spe, args.min_spe));
      if (args.max_spe !== undefined) conditions.push(lte(pokemon.spe, args.max_spe));

      const totalExpr = sql<number>`(${pokemon.hp} + ${pokemon.atk} + ${pokemon.def} + ${pokemon.spa} + ${pokemon.spd} + ${pokemon.spe})`;
      if (args.min_total !== undefined) conditions.push(gte(totalExpr, args.min_total));
      if (args.max_total !== undefined) conditions.push(lte(totalExpr, args.max_total));

      if (args.champions_only || args.tiers?.length) {
        conditions.push(eq(pokemon.isChampions, true));
      }
      if (args.tiers?.length) {
        conditions.push(inArray(pokemon.championsTier, args.tiers));
      }

      if (args.has_ability) {
        const abilityId = args.has_ability;
        const subq = db
          .select({ id: pokemonAbilities.pokemonId })
          .from(pokemonAbilities)
          .where(eq(pokemonAbilities.abilityId, abilityId));
        conditions.push(inArray(pokemon.id, subq));
      }

      const where = conditions.length ? and(...conditions) : undefined;
      const limit = args.limit ?? 50;

      // Pull more than `limit` if `resists` will further filter post-query.
      const queryLimit = args.resists?.length ? Math.max(limit * 4, 200) : limit;

      const rows = await db.query.pokemon.findMany({
        where,
        orderBy: asc(pokemon.id),
        limit: queryLimit,
      });

      const filtered = args.resists?.length
        ? rows.filter((p) => {
            const matchup = computeDefensiveMatchup(p.type1, p.type2);
            return args.resists!.every((t) => (matchup[t] ?? 1) < 1);
          })
        : rows;

      const results = filtered.slice(0, limit).map((p) => ({
        id: p.id,
        name: p.nameJa ?? p.nameEn,
        nameEn: p.nameEn,
        types: p.type2 ? [p.type1, p.type2] : [p.type1],
        baseStats: {
          hp: p.hp, atk: p.atk, def: p.def, spa: p.spa, spd: p.spd, spe: p.spe,
          total: p.hp + p.atk + p.def + p.spa + p.spd + p.spe,
        },
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                count: results.length,
                truncated: filtered.length > results.length,
                results,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
