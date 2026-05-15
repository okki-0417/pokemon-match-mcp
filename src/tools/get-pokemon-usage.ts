import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, eq, inArray, max } from 'drizzle-orm';
import { db } from '../db/client.js';
import { usageStats, pokemon, moves, items, abilities } from '../db/schema/index.js';
import { pokemonLookup, normalizePokemonId } from '../db/lookup.js';

const inputSchema = {
  name: z
    .string()
    .min(1)
    .describe('ポケモン名または ID (EN/JP/正規化、例: "ガブリアス" / "garchomp")。'),
  format: z.string().optional().describe('Smogon フォーマット ID。デフォルト "gen9championsvgc2026regma"。'),
  elo_cutoff: z.number().int().optional().describe('ラダー Elo カット。デフォルト 1500。'),
  year_month: z.string().optional().describe('YYYY-MM。指定なしなら最新月を自動選択。'),
  top_n: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('各内訳 (技/道具/特性/同居ポケ/努力値スプレッド) の返却件数上限。デフォルト 10。'),
};

type Entry = { key: string; name: string; weight: number; pct: number };

function topNRaw(
  map: Record<string, number>,
  n: number,
): { key: string; weight: number; total: number }[] {
  const total = Object.values(map).reduce((a, b) => a + b, 0);
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, weight]) => ({ key, weight, total }));
}

function attach(
  raw: { key: string; weight: number; total: number }[],
  display: (key: string) => string,
): Entry[] {
  return raw.map(({ key, weight, total }) => ({
    key,
    name: display(key),
    weight,
    pct: total > 0 ? Math.round((weight / total) * 10000) / 100 : 0,
  }));
}

export function registerGetPokemonUsage(server: McpServer): void {
  server.registerTool(
    'get_pokemon_usage',
    {
      title: 'get_pokemon_usage',
      description:
        '指定ポケの実採用内訳を Smogon chaos JSON から返す: 上位の技/道具/特性/同居ポケ/努力値スプレッドを種内シェア % 付きで。デフォルト: gen9championsvgc2026regma / elo 1500 / 最新月。',
      inputSchema,
    },
    async (args) => {
      const format = args.format ?? 'gen9championsvgc2026regma';
      const elo = args.elo_cutoff ?? 1500;
      const topNCount = args.top_n ?? 10;

      const pkmn = await db.query.pokemon.findFirst({ where: pokemonLookup(args.name) });
      if (!pkmn) throw new Error(`Pokemon not found: "${args.name}"`);

      let yearMonth = args.year_month;
      if (!yearMonth) {
        const latest = await db
          .select({ ym: max(usageStats.yearMonth) })
          .from(usageStats)
          .where(
            and(
              eq(usageStats.format, format),
              eq(usageStats.eloCutoff, elo),
              eq(usageStats.pokemonId, pkmn.id),
            ),
          );
        yearMonth = latest[0]?.ym ?? undefined;
      }
      if (!yearMonth) {
        throw new Error(
          `No usage_stats for "${pkmn.nameEn}" in ${format} elo=${elo}. May simply mean it had no recorded usage that month.`,
        );
      }

      const row = await db.query.usageStats.findFirst({
        where: and(
          eq(usageStats.format, format),
          eq(usageStats.yearMonth, yearMonth),
          eq(usageStats.eloCutoff, elo),
          eq(usageStats.pokemonId, pkmn.id),
        ),
      });
      if (!row) {
        throw new Error(`No usage_stats row found despite latest year_month resolved to ${yearMonth}`);
      }

      // Build raw top-N first so we know which keys to translate.
      const rawMoves = topNRaw(row.moves, topNCount);
      const rawItems = topNRaw(row.items, topNCount);
      const rawAbilities = topNRaw(row.abilities, topNCount);
      const rawTeammates = topNRaw(row.teammates, topNCount);
      const rawSpreads = topNRaw(row.spreads, topNCount);

      // Resolve EN keys to JP via DB. Move/item/ability keys are already
      // normalized IDs; teammate keys are EN species names that need
      // normalizePokemonId (e.g. "Charizard-Mega-Y" → "charizardmegay").
      const moveIds = rawMoves.map((e) => e.key);
      const itemIds = rawItems.map((e) => e.key);
      const abilityIds = rawAbilities.map((e) => e.key);
      const teammateIds = rawTeammates.map((e) => normalizePokemonId(e.key));

      const [moveRows, itemRows, abilityRows, teammateRows] = await Promise.all([
        moveIds.length
          ? db.select({ id: moves.id, ja: moves.nameJa, en: moves.nameEn })
              .from(moves).where(inArray(moves.id, moveIds))
          : Promise.resolve([] as { id: string; ja: string | null; en: string }[]),
        itemIds.length
          ? db.select({ id: items.id, ja: items.nameJa, en: items.nameEn })
              .from(items).where(inArray(items.id, itemIds))
          : Promise.resolve([] as { id: string; ja: string | null; en: string }[]),
        abilityIds.length
          ? db.select({ id: abilities.id, ja: abilities.nameJa, en: abilities.nameEn })
              .from(abilities).where(inArray(abilities.id, abilityIds))
          : Promise.resolve([] as { id: string; ja: string | null; en: string }[]),
        teammateIds.length
          ? db.select({ id: pokemon.id, ja: pokemon.nameJa, en: pokemon.nameEn })
              .from(pokemon).where(inArray(pokemon.id, teammateIds))
          : Promise.resolve([] as { id: string; ja: string | null; en: string }[]),
      ]);

      const display = (rows: { id: string; ja: string | null; en: string }[]) => {
        const m = new Map(rows.map((r) => [r.id, r.ja ?? r.en]));
        return (key: string) => m.get(key) ?? m.get(normalizePokemonId(key)) ?? key;
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                pokemon: {
                  id: pkmn.id,
                  name: pkmn.nameJa ?? pkmn.nameEn,
                  nameEn: pkmn.nameEn,
                },
                format,
                yearMonth,
                eloCutoff: elo,
                usagePct: Math.round(row.usagePct * 10000) / 100,
                rawCount: row.rawCount,
                moves: attach(rawMoves, display(moveRows)),
                items: attach(rawItems, display(itemRows)),
                abilities: attach(rawAbilities, display(abilityRows)),
                teammates: attach(rawTeammates, display(teammateRows)),
                // Spread keys are "Nature:hp/atk/def/spa/spd/spe" — translate the
                // nature prefix only (EVs are language-neutral).
                spreads: rawSpreads.map((e) => ({
                  key: e.key,
                  name: e.key, // nature lookup omitted for now; spreads stay as-is
                  weight: e.weight,
                  pct: e.total > 0 ? Math.round((e.weight / e.total) * 10000) / 100 : 0,
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
