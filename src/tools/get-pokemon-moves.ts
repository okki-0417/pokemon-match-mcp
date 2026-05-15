import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { eq, asc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { learnsets, moves, pokemon } from '../db/schema/index.js';
import { pokemonLookup } from '../db/lookup.js';

const inputSchema = {
  pokemon: z
    .string()
    .min(1)
    .describe('ポケモン名または ID (EN/JP/正規化)。'),
};

export function registerGetPokemonMoves(server: McpServer): void {
  server.registerTool(
    'get_pokemon_moves',
    {
      title: 'get_pokemon_moves',
      description:
        '指定ポケモンが Champions で覚える全技を一覧。各技にタイプ・分類・威力・命中・PP・優先度・習得方法タグ (例 "9L13"=Lv13、"9M"=TM/わざマシン、"9E"=タマゴ、"9T"=おしえわざ) を付与。',
      inputSchema,
    },
    async ({ pokemon: pokemonInput }) => {
      const row = await db.query.pokemon.findFirst({ where: pokemonLookup(pokemonInput) });
      if (!row) throw new Error(`Pokemon not found: "${pokemonInput}"`);

      const rows = await db
        .select({
          id: moves.id,
          nameEn: moves.nameEn,
          nameJa: moves.nameJa,
          type: moves.type,
          category: moves.category,
          basePower: moves.basePower,
          accuracy: moves.accuracy,
          pp: moves.pp,
          priority: moves.priority,
          description: moves.description,
          sources: learnsets.sources,
        })
        .from(learnsets)
        .innerJoin(moves, eq(learnsets.moveId, moves.id))
        .where(eq(learnsets.pokemonId, row.id))
        .orderBy(asc(moves.id));

      const movesOut = rows.map((m) => ({
        id: m.id,
        name: m.nameJa ?? m.nameEn,
        nameEn: m.nameEn,
        type: m.type,
        category: m.category,
        basePower: m.basePower,
        accuracy: m.accuracy,
        pp: m.pp,
        priority: m.priority,
        description: m.description,
        sources: m.sources,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                pokemon: { id: row.id, name: row.nameJa ?? row.nameEn, nameEn: row.nameEn },
                count: movesOut.length,
                moves: movesOut,
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
