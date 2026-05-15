import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { db } from '../db/client.js';
import { pokemonLookup } from '../db/lookup.js';

const inputSchema = {
  name: z
    .string()
    .min(1)
    .describe(
      'ポケモン名または ID。日本語 ("テツノブジン")、英語 ("Iron Valiant")、正規化 ID ("ironvaliant") すべて受付。大文字小文字・空白は無視。',
    ),
};

export function registerGetPokemon(server: McpServer): void {
  server.registerTool(
    'get_pokemon',
    {
      title: 'get_pokemon',
      description:
        'ポケモンを名前または ID で参照。タイプ・種族値・合計・特性候補 (primary/secondary/hidden スロット付き) を返す。',
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
          name: pa.ability.nameJa ?? pa.ability.nameEn,
          nameEn: pa.ability.nameEn,
          slot: pa.slot,
          description: pa.ability.description,
          flags: pa.ability.flags,
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
                name: row.nameJa ?? row.nameEn,
                nameEn: row.nameEn,
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
