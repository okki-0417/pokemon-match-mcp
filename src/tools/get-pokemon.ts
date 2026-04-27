import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { pokemon } from '../db/schema/index.js';

function toId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const inputSchema = {
  name: z
    .string()
    .min(1)
    .describe('Pokemon name or ID. Case/whitespace-insensitive (e.g. "Iron Valiant" → "ironvaliant").'),
};

export function registerGetPokemon(server: McpServer): void {
  server.registerTool(
    'get_pokemon',
    {
      title: 'get_pokemon',
      description:
        'Look up a Pokemon by name or ID. Returns types, base stats, total, and ability candidates with slot (primary/secondary/hidden).',
      inputSchema,
    },
    async ({ name }) => {
      const id = toId(name);
      const row = await db.query.pokemon.findFirst({
        where: eq(pokemon.id, id),
        with: {
          abilities: {
            with: { ability: true },
          },
        },
      });
      if (!row) {
        throw new Error(`Pokemon not found: "${name}" (id="${id}")`);
      }

      const baseStats = {
        hp: row.hp,
        atk: row.atk,
        def: row.def,
        spa: row.spa,
        spd: row.spd,
        spe: row.spe,
      };
      const total = Object.values(baseStats).reduce((a, b) => a + b, 0);

      const abilities = row.abilities
        .map((pa) => ({
          id: pa.ability.id,
          name: pa.ability.nameEn,
          slot: pa.slot,
          description: pa.ability.description,
        }))
        .sort((a, b) => {
          const order = { primary: 0, secondary: 1, hidden: 2 } as const;
          return order[a.slot] - order[b.slot];
        });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                id: row.id,
                name: row.nameEn,
                nameJa: row.nameJa,
                types: row.type2 ? [row.type1, row.type2] : [row.type1],
                baseStats: { ...baseStats, total },
                abilities,
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
