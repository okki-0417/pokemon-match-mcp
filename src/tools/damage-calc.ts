import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { calculate, Generations, Pokemon, Move, Field } from '@smogon/calc';
import { db } from '../db/client.js';
import {
  abilityLookup,
  itemLookup,
  moveLookup,
  natureLookup,
  pokemonLookup,
} from '../db/lookup.js';
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
    .describe('ポケモン名 (EN/JP/ID 受付、例: "ガブリアス" / "Garchomp" / "garchomp")。'),
  level: z.number().int().min(1).max(100).default(50).describe('レベル。デフォルト 50 (VGC 公式)。'),
  nature: z.string().optional().describe('性格 (EN/JP/ID、例: "いじっぱり" / "Adamant")。'),
  ability: z.string().optional().describe('特性 (EN/JP/ID、例: "さめはだ" / "Rough Skin")。'),
  item: z.string().optional().describe('持ち物 (EN/JP/ID、例: "こだわりハチマキ" / "Choice Band")。'),
  evs: statSpread,
  ivs: ivSpread,
  boosts: boostSpread,
  status: z
    .enum(['', 'brn', 'par', 'psn', 'tox', 'slp', 'frz'])
    .optional()
    .describe('状態異常 (brn=やけど / par=まひ / psn=どく / tox=もうどく / slp=ねむり / frz=こおり)。無しなら省略 or 空文字。'),
  teraType: typeEnum
    .optional()
    .describe('指定するとそのタイプにテラスタル済として扱う。Champions ではテラスタル無しのため通常未使用。'),
});

const moveSchema = z.object({
  name: z.string().min(1).describe('技名 (EN/JP/ID、例: "じしん" / "Earthquake" / "earthquake")。'),
  isCrit: z.boolean().optional().describe('急所固定 (true で急所計算)。'),
  hits: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe('連続技 (タネマシンガン・ロックブラスト等) のヒット数。省略時はその技の規定値。'),
});

const fieldSchema = z
  .object({
    weather: z
      .enum(['Sand', 'Sun', 'Rain', 'Hail', 'Snow', 'Harsh Sunshine', 'Heavy Rain', 'Strong Winds'])
      .optional()
      .describe('天候 (Sand=すなあらし / Sun=にほんばれ / Rain=あまごい / Hail=あられ / Snow=ゆき / Harsh Sunshine=おおひでり / Heavy Rain=おおあめ / Strong Winds=らんきりゅう)。'),
    terrain: z.enum(['Electric', 'Grassy', 'Psychic', 'Misty']).optional().describe('フィールド (エレキ/グラス/サイコ/ミスト)。'),
    isReflect: z.boolean().optional().describe('防御側にリフレクター展開中。'),
    isLightScreen: z.boolean().optional().describe('防御側にひかりのかべ展開中。'),
    isAuroraVeil: z.boolean().optional().describe('防御側にオーロラベール展開中。'),
  })
  .optional();

const inputSchema = {
  attacker: sideSchema,
  defender: sideSchema,
  move: moveSchema,
  field: fieldSchema,
  game_type: z
    .enum(['Singles', 'Doubles'])
    .default('Doubles')
    .describe(
      '対戦形式。デフォルト Doubles (VGC 2026 Reg M-A 想定)。スプレッド技は Doubles で自動 ×0.75。',
    ),
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type ResolvedPokemon = { nameEn: string; nameJa: string | null };
type ResolvedNamed = { nameEn: string; nameJa: string | null };

async function resolvePokemon(input: string): Promise<ResolvedPokemon> {
  const row = await db.query.pokemon.findFirst({ where: pokemonLookup(input) });
  if (!row) throw new Error(`Pokemon not found: "${input}"`);
  return { nameEn: row.nameEn, nameJa: row.nameJa };
}

async function resolveMove(input: string): Promise<ResolvedNamed> {
  const row = await db.query.moves.findFirst({ where: moveLookup(input) });
  if (!row) throw new Error(`Move not found: "${input}"`);
  return { nameEn: row.nameEn, nameJa: row.nameJa };
}

async function resolveNature(input: string): Promise<string> {
  const row = await db.query.natures.findFirst({ where: natureLookup(input) });
  if (!row) throw new Error(`Nature not found: "${input}"`);
  return row.nameEn;
}

async function resolveAbility(input: string): Promise<string> {
  const row = await db.query.abilities.findFirst({ where: abilityLookup(input) });
  if (!row) throw new Error(`Ability not found: "${input}"`);
  return row.nameEn;
}

async function resolveItem(input: string): Promise<string> {
  const row = await db.query.items.findFirst({ where: itemLookup(input) });
  if (!row) throw new Error(`Item not found: "${input}"`);
  return row.nameEn;
}

async function normalizeSide(side: z.infer<typeof sideSchema>) {
  const [pkmn, nature, ability, item] = await Promise.all([
    resolvePokemon(side.pokemon),
    side.nature ? resolveNature(side.nature) : Promise.resolve(undefined),
    side.ability ? resolveAbility(side.ability) : Promise.resolve(undefined),
    side.item ? resolveItem(side.item) : Promise.resolve(undefined),
  ]);
  return { ...side, pkmn, nature, ability, item };
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
        '@smogon/calc Gen 9 ダメージ計算。デフォルト Doubles (VGC 2026 Reg M-A)、Singles なら `game_type: "Singles"`。Doubles ではスプレッド技に自動で ×0.75 適用。返り値はダメージロール 16 個・HP % 範囲・確定数・@smogon/calc の説明文。`teraType` でテラ後のマッチアップも検証可。',
      inputSchema,
    },
    async ({ attacker, defender, move, field, game_type }) => {
      const [atkN, defN, moveResolved] = await Promise.all([
        normalizeSide(attacker),
        normalizeSide(defender),
        resolveMove(move.name),
      ]);

      const atkPokemon = buildPokemon(atkN.pkmn.nameEn, atkN);
      const defPokemon = buildPokemon(defN.pkmn.nameEn, defN);

      const calcMove = new Move(gen, moveResolved.nameEn, {
        ...(move.isCrit !== undefined && { isCrit: move.isCrit }),
        ...(move.hits !== undefined && { hits: move.hits }),
      });

      const calcField = new Field({
        gameType: game_type,
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
                attacker: {
                  name: atkN.pkmn.nameJa ?? atkN.pkmn.nameEn,
                  nameEn: atkN.pkmn.nameEn,
                  level: attacker.level,
                },
                defender: {
                  name: defN.pkmn.nameJa ?? defN.pkmn.nameEn,
                  nameEn: defN.pkmn.nameEn,
                  level: defender.level,
                  maxHP: defMaxHP,
                },
                move: { name: moveResolved.nameJa ?? moveResolved.nameEn, nameEn: moveResolved.nameEn },
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
