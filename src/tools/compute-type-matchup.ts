import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { db } from '../db/client.js';
import { pokemonLookup } from '../db/lookup.js';
import {
  TYPE_NAMES,
  type TypeName,
  bucketize,
  computeDefensiveMatchup,
} from '../domain/type-chart.js';

const typeEnum = z.enum(TYPE_NAMES as readonly [TypeName, ...TypeName[]]);

const inputSchema = {
  pokemon: z
    .string()
    .optional()
    .describe(
      'ポケモン名または ID (EN/JP/正規化 ID 受付、例: "Garchomp" / "garchomp" / "ガブリアス")。`types` とどちらか一方を指定。',
    ),
  types: z
    .array(typeEnum)
    .min(1)
    .max(2)
    .optional()
    .describe('特定ポケを指定せず、タイプ組合せだけで相性表を見たい時の防御側タイプ。'),
  ability: z
    .string()
    .optional()
    .describe(
      '特性 ID (例: "levitate")。タイプ無効化/半減特性 (ふゆう / もらいび / ちょすい / あついしぼう 等) を相性表に反映する。指定しないと特性無視。',
    ),
};

export function registerComputeTypeMatchup(server: McpServer): void {
  server.registerTool(
    'compute_type_matchup',
    {
      title: 'compute_type_matchup',
      description:
        'ポケモン or タイプ組合せの防御面相性表を計算。各攻撃タイプの倍率 + バケット (×4/×2/×1/×0.5/×0.25/×0) を返す。',
      inputSchema,
    },
    async ({ pokemon: pokemonInput, types, ability }) => {
      const provided = [pokemonInput, types].filter((v) => v !== undefined).length;
      if (provided !== 1) {
        throw new Error('Specify exactly one of `pokemon` or `types`.');
      }

      let type1: TypeName;
      let type2: TypeName | null;
      let resolved: { id: string; name: string; nameEn: string } | null = null;

      if (pokemonInput) {
        const row = await db.query.pokemon.findFirst({
          where: pokemonLookup(pokemonInput),
        });
        if (!row) throw new Error(`Pokemon not found: "${pokemonInput}"`);
        type1 = row.type1;
        type2 = row.type2;
        resolved = { id: row.id, name: row.nameJa ?? row.nameEn, nameEn: row.nameEn };
      } else {
        type1 = types![0]!;
        type2 = types![1] ?? null;
      }

      const matchup = computeDefensiveMatchup(type1, type2, ability);
      const buckets = bucketize(matchup);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                input: {
                  pokemon: resolved,
                  types: type2 ? [type1, type2] : [type1],
                  ability: ability ?? null,
                },
                matchup,
                buckets,
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
