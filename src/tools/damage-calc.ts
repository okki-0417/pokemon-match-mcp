import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { calculate, Generations, Pokemon, Move, Field } from '@smogon/calc';
import { db } from '../db/client.js';
import { pokemonLookup } from '../db/lookup.js';
import { TYPE_NAMES, type TypeName } from '../domain/type-chart.js';

const gen = Generations.get(9);

function pruneStats<T extends Record<string, number | undefined>>(
  s: T | undefined,
): { [K in keyof T]?: number } | undefined {
  if (!s) return undefined;
  const out: { [K in keyof T]?: number } = {};
  for (const k of Object.keys(s) as (keyof T)[]) {
    const v = s[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const typeEnum = z.enum(TYPE_NAMES as readonly [TypeName, ...TypeName[]]);

const statSpread = z
  .object({
    hp: z.number().int().min(0).max(252).optional(),
    atk: z.number().int().min(0).max(252).optional(),
    def: z.number().int().min(0).max(252).optional(),
    spa: z.number().int().min(0).max(252).optional(),
    spd: z.number().int().min(0).max(252).optional(),
    spe: z.number().int().min(0).max(252).optional(),
  })
  .optional();

const ivSpread = z
  .object({
    hp: z.number().int().min(0).max(31).optional(),
    atk: z.number().int().min(0).max(31).optional(),
    def: z.number().int().min(0).max(31).optional(),
    spa: z.number().int().min(0).max(31).optional(),
    spd: z.number().int().min(0).max(31).optional(),
    spe: z.number().int().min(0).max(31).optional(),
  })
  .optional();

const boostSpread = z
  .object({
    atk: z.number().int().min(-6).max(6).optional(),
    def: z.number().int().min(-6).max(6).optional(),
    spa: z.number().int().min(-6).max(6).optional(),
    spd: z.number().int().min(-6).max(6).optional(),
    spe: z.number().int().min(-6).max(6).optional(),
  })
  .optional();

const sideSchema = z.object({
  pokemon: z
    .string()
    .min(1)
    .describe('Pokemon name. Accepts EN/JP/ID (e.g. "Garchomp" / "ガブリアス" / "garchomp").'),
  level: z.number().int().min(1).max(100).default(50),
  nature: z.string().optional().describe('Nature name in English (e.g. "Adamant").'),
  ability: z.string().optional().describe('Ability name in English (e.g. "Rough Skin").'),
  item: z.string().optional().describe('Held item in English (e.g. "Choice Band").'),
  evs: statSpread,
  ivs: ivSpread,
  boosts: boostSpread,
  status: z
    .enum(['', 'brn', 'par', 'psn', 'tox', 'slp', 'frz'])
    .optional()
    .describe('Status condition. Empty string or omit for none.'),
  teraType: typeEnum
    .optional()
    .describe('If set, the Pokemon is treated as Terastallized to this type.'),
});

const moveSchema = z.object({
  name: z.string().min(1).describe('Move name in English (e.g. "Earthquake").'),
  isCrit: z.boolean().optional(),
  hits: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe('Number of hits for multi-hit moves (e.g. Bullet Seed).'),
});

const fieldSchema = z
  .object({
    weather: z
      .enum(['Sand', 'Sun', 'Rain', 'Hail', 'Snow', 'Harsh Sunshine', 'Heavy Rain', 'Strong Winds'])
      .optional(),
    terrain: z.enum(['Electric', 'Grassy', 'Psychic', 'Misty']).optional(),
    isReflect: z.boolean().optional().describe('Reflect on the defender side.'),
    isLightScreen: z.boolean().optional().describe('Light Screen on the defender side.'),
    isAuroraVeil: z.boolean().optional().describe('Aurora Veil on the defender side.'),
  })
  .optional();

const inputSchema = {
  attacker: sideSchema,
  defender: sideSchema,
  move: moveSchema,
  field: fieldSchema,
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function resolveNameEn(input: string): Promise<string> {
  const row = await db.query.pokemon.findFirst({ where: pokemonLookup(input) });
  if (!row) throw new Error(`Pokemon not found: "${input}"`);
  return row.nameEn;
}

function buildPokemon(name: string, side: z.infer<typeof sideSchema>): Pokemon {
  const opts: ConstructorParameters<typeof Pokemon>[2] = { level: side.level };
  if (side.nature !== undefined) opts.nature = side.nature;
  if (side.ability !== undefined) opts.ability = side.ability;
  if (side.item !== undefined) opts.item = side.item;
  const evs = pruneStats(side.evs);
  if (evs) opts.evs = evs;
  const ivs = pruneStats(side.ivs);
  if (ivs) opts.ivs = ivs;
  const boosts = pruneStats(side.boosts);
  if (boosts) opts.boosts = boosts;
  if (side.status !== undefined && side.status !== '') opts.status = side.status;
  if (side.teraType !== undefined) {
    type TeraType = NonNullable<NonNullable<ConstructorParameters<typeof Pokemon>[2]>['teraType']>;
    opts.teraType = capitalize(side.teraType) as TeraType;
  }
  return new Pokemon(gen, name, opts);
}

export function registerDamageCalc(server: McpServer): void {
  server.registerTool(
    'damage_calc',
    {
      title: 'damage_calc',
      description:
        'Run a Gen 9 damage calculation via @smogon/calc. Returns damage rolls (16 values), HP-percent range, KO chance, and a human-readable description. Set `teraType` to evaluate post-Tera matchups.',
      inputSchema,
    },
    async ({ attacker, defender, move, field }) => {
      const [attackerName, defenderName] = await Promise.all([
        resolveNameEn(attacker.pokemon),
        resolveNameEn(defender.pokemon),
      ]);

      const atkPokemon = buildPokemon(attackerName, attacker);
      const defPokemon = buildPokemon(defenderName, defender);

      const calcMove = new Move(gen, move.name, {
        ...(move.isCrit !== undefined && { isCrit: move.isCrit }),
        ...(move.hits !== undefined && { hits: move.hits }),
      });

      const calcField = new Field({
        gameType: 'Singles',
        ...(field?.weather !== undefined && { weather: field.weather }),
        ...(field?.terrain !== undefined && { terrain: field.terrain }),
        defenderSide: {
          spikes: 0,
          steelsurge: false,
          vinelash: false,
          wildfire: false,
          cannonade: false,
          volcalith: false,
          isSR: false,
          isReflect: field?.isReflect ?? false,
          isLightScreen: field?.isLightScreen ?? false,
          isProtected: false,
          isSeeded: false,
          isSaltCured: false,
          isForesight: false,
          isTailwind: false,
          isHelpingHand: false,
          isFlowerGift: false,
          isFriendGuard: false,
          isAuroraVeil: field?.isAuroraVeil ?? false,
          isBattery: false,
          isPowerSpot: false,
          isSteelySpirit: false,
        },
      });

      const result = calculate(gen, atkPokemon, defPokemon, calcMove, calcField);
      const [minDmg, maxDmg] = result.range();
      const defMaxHP = defPokemon.maxHP();
      const koChance = result.kochance();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                attacker: { name: attackerName, level: attacker.level },
                defender: { name: defenderName, level: defender.level, maxHP: defMaxHP },
                move: move.name,
                damage: {
                  rolls: result.damage,
                  min: minDmg,
                  max: maxDmg,
                  minPercent: Math.floor((minDmg / defMaxHP) * 1000) / 10,
                  maxPercent: Math.floor((maxDmg / defMaxHP) * 1000) / 10,
                },
                ko: {
                  chance: koChance.chance ?? null,
                  hits: koChance.n,
                  text: koChance.text,
                },
                desc: result.desc(),
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
