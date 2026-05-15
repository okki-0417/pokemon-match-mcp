import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { items } from '../db/schema/index.js';

const inputSchema = {
  champions_only: z
    .boolean()
    .optional()
    .describe('true ならポケモンチャンピオンズ内定の道具のみ。'),
  is_berry: z.boolean().optional().describe('きのみフラグで絞る (true=きのみのみ / false=非きのみのみ)。'),
  has_mega_stone: z
    .boolean()
    .optional()
    .describe('true ならメガストーンのみ、false なら非メガストーンのみ。'),
  for_holder: z
    .string()
    .optional()
    .describe(
      'ポケモンの EN 種族名 (例: "Garchomp")。指定するとそのポケが持てる道具に絞る: メガストーン (持ち主合致) または持ち主固定アイテム (Light Ball → Pikachu、Soul Dew → Latios/Latias 等)。',
    ),
  on_memory: z
    .string()
    .optional()
    .describe('シルヴァディメモリのタイプで絞る (例: "Bug", "Dragon")。'),
  limit: z.number().int().min(1).max(500).optional().describe('デフォルト 100。'),
};

export function registerFindItems(server: McpServer): void {
  server.registerTool(
    'find_items',
    {
      title: 'find_items',
      description:
        '持ち物を Champions 内定可否・きのみ・メガストーン有無・持ち主・シルヴァディメモリのタイプで絞り込み。結果は ID 順。',
      inputSchema,
    },
    async (args) => {
      const conditions = [];

      if (args.champions_only) conditions.push(eq(items.isChampions, true));
      if (args.is_berry !== undefined) conditions.push(eq(items.isBerry, args.is_berry));
      if (args.has_mega_stone === true) conditions.push(isNotNull(items.megaStone));
      if (args.has_mega_stone === false) conditions.push(isNull(items.megaStone));
      if (args.on_memory) conditions.push(eq(items.onMemory, args.on_memory));

      const where = conditions.length ? and(...conditions) : undefined;
      const limit = args.limit ?? 100;

      let rows = await db
        .select()
        .from(items)
        .where(where)
        .orderBy(asc(items.id))
        .limit(limit + 1);

      if (args.for_holder) {
        const holder = args.for_holder;
        rows = rows.filter((r) => {
          const isMegaForHolder = r.megaStone !== null && holder in r.megaStone;
          const isUserForHolder = r.itemUser !== null && r.itemUser.includes(holder);
          return isMegaForHolder || isUserForHolder;
        });
      }

      const truncated = rows.length > limit;
      const results = rows.slice(0, limit).map((r) => ({
        id: r.id,
        name: r.nameJa ?? r.nameEn,
        nameEn: r.nameEn,
        description: r.description,
        isChampions: r.isChampions,
        isBerry: r.isBerry,
        megaStone: r.megaStone,
        fling: r.fling,
        naturalGift: r.naturalGift,
        itemUser: r.itemUser,
        onMemory: r.onMemory,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ count: results.length, truncated, results }, null, 2),
          },
        ],
      };
    },
  );
}
