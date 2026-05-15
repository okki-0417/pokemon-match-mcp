import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, desc, eq, max } from 'drizzle-orm';
import { db } from '../db/client.js';
import { usageStats, pokemon } from '../db/schema/index.js';

const inputSchema = {
  format: z
    .string()
    .optional()
    .describe('Smogon フォーマット ID。デフォルト "gen9championsvgc2026regma" (Champions VGC Reg M-A)。'),
  elo_cutoff: z
    .number()
    .int()
    .optional()
    .describe('ラダー Elo カット (0/1500/1630/1760)。デフォルト 1500 (中堅以上)。'),
  year_month: z
    .string()
    .optional()
    .describe('YYYY-MM 形式。指定なしならフォーマットの最新月を自動選択。'),
  limit: z.number().int().min(1).max(200).optional().describe('デフォルト 20。'),
};

export function registerFindMetaThreats(server: McpServer): void {
  server.registerTool(
    'find_meta_threats',
    {
      title: 'find_meta_threats',
      description:
        'Smogon usage stats のスナップショットから採用率上位ポケを返す (Champions VGC Reg M-A 既定)。デフォルト: gen9championsvgc2026regma / elo 1500 / 最新月。',
      inputSchema,
    },
    async (args) => {
      const format = args.format ?? 'gen9championsvgc2026regma';
      const elo = args.elo_cutoff ?? 1500;
      const limit = args.limit ?? 20;

      let yearMonth = args.year_month;
      if (!yearMonth) {
        const latest = await db
          .select({ ym: max(usageStats.yearMonth) })
          .from(usageStats)
          .where(and(eq(usageStats.format, format), eq(usageStats.eloCutoff, elo)));
        yearMonth = latest[0]?.ym ?? undefined;
      }
      if (!yearMonth) {
        throw new Error(
          `No usage_stats data for format="${format}" elo=${elo}. Run \`pnpm data:fetch-smogon-stats && pnpm db:seed-usage-stats\` first.`,
        );
      }

      const rows = await db
        .select({
          id: usageStats.pokemonId,
          name: pokemon.nameEn,
          nameJa: pokemon.nameJa,
          usagePct: usageStats.usagePct,
          rawCount: usageStats.rawCount,
        })
        .from(usageStats)
        .innerJoin(pokemon, eq(usageStats.pokemonId, pokemon.id))
        .where(
          and(
            eq(usageStats.format, format),
            eq(usageStats.yearMonth, yearMonth),
            eq(usageStats.eloCutoff, elo),
          ),
        )
        .orderBy(desc(usageStats.usagePct))
        .limit(limit);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                format,
                yearMonth,
                eloCutoff: elo,
                count: rows.length,
                results: rows.map((r) => ({
                  id: r.id,
                  name: r.nameJa ?? r.name,
                  nameEn: r.name,
                  usagePct: Math.round(r.usagePct * 10000) / 100, // 2-dp percent
                  rawCount: r.rawCount,
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
