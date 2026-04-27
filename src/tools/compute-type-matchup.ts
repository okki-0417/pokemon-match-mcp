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
      'Pokemon name or ID. Accepts English, normalized ID, or Japanese (e.g. "Garchomp" / "garchomp" / "ガブリアス"). Use either this or `types`.',
    ),
  types: z
    .array(typeEnum)
    .min(1)
    .max(2)
    .optional()
    .describe('Defending types when querying without a specific Pokemon.'),
  ability: z
    .string()
    .optional()
    .describe(
      'Ability ID (e.g. "levitate"). Applies type-immunity/resistance abilities (Levitate, Flash Fire, Water Absorb, Thick Fat, etc.).',
    ),
};

export function registerComputeTypeMatchup(server: McpServer): void {
  server.registerTool(
    'compute_type_matchup',
    {
      title: 'compute_type_matchup',
      description:
        'Compute the defensive type matchup table for a Pokemon or for a given type combination. Returns a per-attacker damage multiplier and bucketed view (x4/x2/x1/x0.5/x0.25/x0).',
      inputSchema,
    },
    async ({ pokemon: pokemonInput, types, ability }) => {
      const provided = [pokemonInput, types].filter((v) => v !== undefined).length;
      if (provided !== 1) {
        throw new Error('Specify exactly one of `pokemon` or `types`.');
      }

      let type1: TypeName;
      let type2: TypeName | null;
      let resolved: { id: string; name: string } | null = null;

      if (pokemonInput) {
        const row = await db.query.pokemon.findFirst({
          where: pokemonLookup(pokemonInput),
        });
        if (!row) throw new Error(`Pokemon not found: "${pokemonInput}"`);
        type1 = row.type1;
        type2 = row.type2;
        resolved = { id: row.id, name: row.nameEn };
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
