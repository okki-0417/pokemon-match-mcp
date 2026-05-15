import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { learnsets, moves, pokemon, MOVE_TARGETS } from '../db/schema/index.js';
import { pokemonLookup } from '../db/lookup.js';
import { TYPE_NAMES, type TypeName } from '../domain/type-chart.js';

const typeEnum = z.enum(TYPE_NAMES as readonly [TypeName, ...TypeName[]]);
const categoryEnum = z.enum(['physical', 'special', 'status']);
const targetEnum = z.enum(MOVE_TARGETS);

const inputSchema = {
  types: z.array(typeEnum).optional().describe('技タイプ (複数指定で OR)。'),
  category: categoryEnum.optional().describe('物理/特殊/変化のいずれか。'),
  min_base_power: z.number().int().min(0).optional(),
  max_base_power: z.number().int().min(0).optional(),
  min_accuracy: z.number().int().min(0).max(100).optional().describe('指定すると命中 NULL (必中技) は除外される。'),
  min_priority: z.number().int().min(-7).max(5).optional(),
  max_priority: z.number().int().min(-7).max(5).optional(),
  targets: z
    .array(targetEnum)
    .optional()
    .describe('Showdown の target enum。例: ["allAdjacentFoes","allAdjacent"] でスプレッド技 (じしん・なみのり 等) を抽出。'),
  has_flags: z
    .array(z.string())
    .optional()
    .describe('指定フラグを **すべて** 持つ技に絞る。例: ["punch"]、["sound"]、["contact","slicing"]。'),
  lacks_flags: z
    .array(z.string())
    .optional()
    .describe('指定フラグを **いずれも** 持たない技に絞る。例: ["contact"] で非接触技のみ。'),
  learner: z
    .string()
    .optional()
    .describe('ポケモン名または ID。指定するとそのポケモンが Champions で覚える技のみ。'),
  champions_only: z
    .boolean()
    .optional()
    .describe(
      'true なら Champions ロスターのいずれかが覚える技に絞る。`learner` と併用すると特定ポケに絞れる。',
    ),
  limit: z.number().int().min(1).max(500).optional().describe('デフォルト 50。'),
};

export function registerFindMoves(server: McpServer): void {
  server.registerTool(
    'find_moves',
    {
      title: 'find_moves',
      description:
        '技をタイプ・分類・威力・命中・優先度・target・flags、(任意で) 覚えるポケモンや Champions ロスター内定で絞り込み。結果は ID 順。',
      inputSchema,
    },
    async (args) => {
      const conditions = [];

      if (args.types?.length) conditions.push(inArray(moves.type, args.types));
      if (args.category) conditions.push(eq(moves.category, args.category));
      if (args.min_base_power !== undefined) conditions.push(gte(moves.basePower, args.min_base_power));
      if (args.max_base_power !== undefined) conditions.push(lte(moves.basePower, args.max_base_power));
      if (args.min_accuracy !== undefined) conditions.push(gte(moves.accuracy, args.min_accuracy));
      if (args.min_priority !== undefined) conditions.push(gte(moves.priority, args.min_priority));
      if (args.max_priority !== undefined) conditions.push(lte(moves.priority, args.max_priority));

      if (args.targets?.length) conditions.push(inArray(moves.target, args.targets));
      if (args.has_flags?.length) {
        // SQLite JSON1: every required flag must appear as a value in the JSON array.
        for (const flag of args.has_flags) {
          conditions.push(
            sql`EXISTS (SELECT 1 FROM json_each(${moves.flags}) WHERE value = ${flag})`,
          );
        }
      }
      if (args.lacks_flags?.length) {
        for (const flag of args.lacks_flags) {
          conditions.push(
            sql`NOT EXISTS (SELECT 1 FROM json_each(${moves.flags}) WHERE value = ${flag})`,
          );
        }
      }

      if (args.learner) {
        const learnerRow = await db.query.pokemon.findFirst({ where: pokemonLookup(args.learner) });
        if (!learnerRow) throw new Error(`Pokemon not found: "${args.learner}"`);
        const subq = db
          .select({ id: learnsets.moveId })
          .from(learnsets)
          .where(eq(learnsets.pokemonId, learnerRow.id));
        conditions.push(inArray(moves.id, subq));
      } else if (args.champions_only) {
        const subq = db
          .select({ id: learnsets.moveId })
          .from(learnsets)
          .innerJoin(pokemon, eq(learnsets.pokemonId, pokemon.id))
          .where(eq(pokemon.isChampions, true));
        conditions.push(inArray(moves.id, subq));
      }

      const where = conditions.length ? and(...conditions) : undefined;
      const limit = args.limit ?? 50;

      const rows = await db
        .select()
        .from(moves)
        .where(where)
        .orderBy(asc(moves.id))
        .limit(limit + 1);

      const truncated = rows.length > limit;
      const results = rows.slice(0, limit).map((m) => ({
        id: m.id,
        name: m.nameJa ?? m.nameEn,
        nameEn: m.nameEn,
        type: m.type,
        category: m.category,
        basePower: m.basePower,
        accuracy: m.accuracy,
        pp: m.pp,
        priority: m.priority,
        target: m.target,
        flags: m.flags,
        secondaries: m.secondaries,
        critRatio: m.critRatio,
        multihit: m.multihit,
        drain: m.drain,
        recoil: m.recoil,
        heal: m.heal,
        selfSwitch: m.selfSwitch,
        description: m.description,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                count: results.length,
                truncated,
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
