import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { db } from '../db/client.js';
import { itemLookup } from '../db/lookup.js';

const inputSchema = {
  name: z
    .string()
    .min(1)
    .describe(
      '道具名または ID (EN/JP/正規化、例: "こだわりスカーフ" / "Choice Scarf" / "choicescarf")。',
    ),
};

export function registerGetItem(server: McpServer): void {
  server.registerTool(
    'get_item',
    {
      title: 'get_item',
      description:
        '持ち物を名前または ID で参照。説明・Champions 内定可否・メガストーン情報 (該当時) ・きのみフラグ・フリング BP・しぜんのめぐみ・持ち主固定 (Light Ball→ピカチュウ等) ・シルヴァディメモリのタイプを返す。',
      inputSchema,
    },
    async ({ name }) => {
      const row = await db.query.items.findFirst({ where: itemLookup(name) });
      if (!row) throw new Error(`Item not found: "${name}"`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                id: row.id,
                name: row.nameJa ?? row.nameEn,
                nameEn: row.nameEn,
                description: row.description,
                descLong: row.descLong,
                isChampions: row.isChampions,
                isBerry: row.isBerry,
                megaStone: row.megaStone,
                fling: row.fling,
                naturalGift: row.naturalGift,
                itemUser: row.itemUser,
                onMemory: row.onMemory,
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
