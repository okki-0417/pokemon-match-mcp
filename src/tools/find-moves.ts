import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '../db/client.js';
import { learnsets, moves, pokemon } from '../db/schema/index.js';
import { pokemonLookup } from '../db/lookup.js';
import { TYPE_NAMES, type TypeName } from '../domain/type-chart.js';

const typeEnum = z.enum(TYPE_NAMES as readonly [TypeName, ...TypeName[]]);
const categoryEnum = z.enum(['physical', 'special', 'status']);

const inputSchema = {
  types: z.array(typeEnum).optional().describe('Move type(s). Match if any.'),
  category: categoryEnum.optional(),
  min_base_power: z.number().int().min(0).optional(),
  max_base_power: z.number().int().min(0).optional(),
  min_accuracy: z.number().int().min(0).max(100).optional().describe('Excludes moves with NULL accuracy (always-hits) when set.'),
  min_priority: z.number().int().min(-7).max(5).optional(),
  max_priority: z.number().int().min(-7).max(5).optional(),
  learner: z
    .string()
    .optional()
    .describe('Pokemon name or ID. If set, only returns moves this Pokemon can learn in Champions.'),
  champions_only: z
    .boolean()
    .optional()
    .describe(
      'If true, restrict results to moves any Champions roster Pokemon can learn. Combine with `learner` for a specific Pokemon.',
    ),
  limit: z.number().int().min(1).max(500).optional().describe('Default 50.'),
};

export function registerFindMoves(server: McpServer): void {
  server.registerTool(
    'find_moves',
    {
      title: 'find_moves',
      description:
        'Filter moves by type, category, base power, accuracy, priority, and (optionally) learner Pokemon or Champions roster membership. Returns matches sorted by id.',
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
      const results = rows.slice(0, limit);

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
