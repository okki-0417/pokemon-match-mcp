import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { db } from '../db/client.js';
import { pokemonLookup } from '../db/lookup.js';

const inputSchema = {
  name: z
    .string()
    .min(1)
    .describe(
      'Pokemon name or ID. Accepts English ("Iron Valiant"), normalized ID ("ironvaliant"), or Japanese name ("テツノブジン"). Case/whitespace-insensitive.',
    ),
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
      const row = await db.query.pokemon.findFirst({
        where: pokemonLookup(name),
        with: {
          abilities: {
            with: { ability: true },
          },
        },
      });
      if (!row) {
        throw new Error(`Pokemon not found: "${name}"`);
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
          nameJa: pa.ability.nameJa,
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
