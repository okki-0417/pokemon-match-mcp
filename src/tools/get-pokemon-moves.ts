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
    .describe('Pokemon name or ID (EN/JP/normalized).'),
};

export function registerGetPokemonMoves(server: McpServer): void {
  server.registerTool(
    'get_pokemon_moves',
    {
      title: 'get_pokemon_moves',
      description:
        'List the moves a Pokemon can learn in the Champions format. Each move includes type, category, base power, accuracy, PP, priority, and learn-source tags (e.g. "9L13" = level 13, "9M" = TM/record, "9E" = egg, "9T" = tutor).',
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

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                pokemon: { id: row.id, name: row.nameEn, nameJa: row.nameJa },
                count: rows.length,
                moves: rows,
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
