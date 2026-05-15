import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, asc, eq, isNull, or, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { natures, NATURE_STATS } from '../db/schema/index.js';
import { natureLookup } from '../db/lookup.js';

const statEnum = z.enum(NATURE_STATS);

const inputSchema = {
  name: z
    .string()
    .optional()
    .describe(
      '名前で 1 件引きたい時 (EN/JP/ID、例: "いじっぱり" / "Adamant" / "adamant")。指定時は最大 1 件返却。',
    ),
  plus: statEnum.optional().describe('+10% 補正がつく能力で絞る。'),
  minus: statEnum.optional().describe('-10% 補正がつく能力で絞る。'),
  neutral: z
    .boolean()
    .optional()
    .describe('true なら無補正性格 (がんばりや/てれや/すなお/きまぐれ/まじめ) のみ。'),
};

export function registerFindNatures(server: McpServer): void {
  server.registerTool(
    'find_natures',
    {
      title: 'find_natures',
      description:
        '性格 25 種を一覧。EN/JP 名と +/- 補正能力を返す。plus/minus/neutral/name で絞り込み。引数なしで全 25 件。',
      inputSchema,
    },
    async (args) => {
      const conditions: SQL[] = [];
      if (args.name) conditions.push(natureLookup(args.name));
      if (args.plus) conditions.push(eq(natures.plus, args.plus));
      if (args.minus) conditions.push(eq(natures.minus, args.minus));
      if (args.neutral === true) {
        conditions.push(isNull(natures.plus));
      } else if (args.neutral === false) {
        conditions.push(or(eq(natures.plus, 'atk'), eq(natures.plus, 'def'), eq(natures.plus, 'spa'), eq(natures.plus, 'spd'), eq(natures.plus, 'spe'))!);
      }

      const where = conditions.length ? and(...conditions) : undefined;
      const rows = await db.select().from(natures).where(where).orderBy(asc(natures.id));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                count: rows.length,
                results: rows.map((r) => ({
                  id: r.id,
                  name: r.nameJa ?? r.nameEn,
                  nameEn: r.nameEn,
                  plus: r.plus,
                  minus: r.minus,
                })),
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
