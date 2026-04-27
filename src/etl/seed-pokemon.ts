import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { Dex } from '@pkmn/dex';
import { sql as raw } from 'drizzle-orm';
import { db, sql } from '../db/client.js';
import {
  pokemon,
  abilities,
  pokemonAbilities,
  pokemonType,
  abilitySlot,
} from '../db/schema/index.js';

type JpNames = {
  species: Record<string, string>;
  abilities: Record<string, string>;
};

let jpNames: JpNames = { species: {}, abilities: {} };
try {
  const raw = await readFile('data/jp-names.json', 'utf8');
  jpNames = JSON.parse(raw) as JpNames;
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  console.warn('data/jp-names.json not found; nameJa will be null. Run `pnpm db:fetch-jp` first.');
}

type PokemonInsert = typeof pokemon.$inferInsert;
type AbilityInsert = typeof abilities.$inferInsert;
type PokemonAbilityInsert = typeof pokemonAbilities.$inferInsert;
type TypeName = (typeof pokemonType.enumValues)[number];
type SlotName = (typeof abilitySlot.enumValues)[number];

const TYPE_NAMES = new Set<TypeName>(pokemonType.enumValues);

function toTypeName(raw: string): TypeName {
  const lower = raw.toLowerCase();
  if (!TYPE_NAMES.has(lower as TypeName)) {
    throw new Error(`Unknown type "${raw}"`);
  }
  return lower as TypeName;
}

const SLOT_MAP: Record<string, SlotName> = {
  '0': 'primary',
  '1': 'secondary',
  H: 'hidden',
};

// Use raw Dex (not the gen-filtered wrapper) so that Pokemon Champions-relevant
// forms (mainline megas marked Past, Champions-original megas marked Future,
// AZ's eternal-flower Floette etc.) are included. The gen-N Generations wrapper
// hides these even though their stats/abilities are present in the dex data.
const ALLOWED_NONSTANDARD = new Set<string | null>([null, 'Past', 'Future']);

const abilityRows = new Map<string, AbilityInsert>();
const pokemonRows: PokemonInsert[] = [];
const pokemonAbilityRows: PokemonAbilityInsert[] = [];

// Forms whose JP labels can't be derived by the prefix rule below.
// Covers split/parens-disambiguated forms: rotom appliances, castform weather,
// aegislash blade, gourgeist sizes, lycanroc time-of-day, basculegion gender,
// maushold family-size, palafin form, ogerpon mask, gender-mega meowstic,
// floette eternal, paldea tauros sub-types.
const JA_OVERRIDES: Record<string, string> = {
  rotom: 'ロトム',
  rotomheat: 'ヒートロトム',
  rotomwash: 'ウォッシュロトム',
  rotomfrost: 'フロストロトム',
  rotomfan: 'スピンロトム',
  rotommow: 'カットロトム',
  castform: 'ポワルン',
  castformsunny: 'ポワルン(たいようのすがた)',
  castformrainy: 'ポワルン(あまみずのすがた)',
  castformsnowy: 'ポワルン(ゆきぐものすがた)',
  aegislash: 'ギルガルド(シールドフォルム)',
  aegislashblade: 'ギルガルド(ブレードフォルム)',
  floetteeternal: 'フラエッテ(えいえんのはな)',
  meowstic: 'ニャオニクス(オス)',
  meowsticf: 'ニャオニクス(メス)',
  meowsticmmega: 'メガニャオニクス(オス)',
  meowsticfmega: 'メガニャオニクス(メス)',
  taurospaldeacombat: 'パルデアケンタロス(かくとう)',
  taurospaldeablaze: 'パルデアケンタロス(ほのお)',
  taurospaldeaaqua: 'パルデアケンタロス(みず)',
  gourgeist: 'パンプジン(ちゅうだましゅ)',
  gourgeistsmall: 'パンプジン(こだましゅ)',
  gourgeistlarge: 'パンプジン(おおだましゅ)',
  gourgeistsuper: 'パンプジン(ギガだましゅ)',
  lycanroc: 'ルガルガン(まひる)',
  lycanrocmidnight: 'ルガルガン(まよなか)',
  lycanrocdusk: 'ルガルガン(たそがれ)',
  basculegion: 'イダイトウ(オス)',
  basculegionf: 'イダイトウ(メス)',
  maushold: 'イッカネズミ(3びきかぞく)',
  mausholdfour: 'イッカネズミ(4ひきかぞく)',
  palafin: 'イルカマン(ナイーブ)',
  palafinhero: 'イルカマン(マイティ)',
};

const REGIONAL_SUFFIX_TO_JA: { suffix: string; prefix: string }[] = [
  { suffix: 'alola', prefix: 'アローラ' },
  { suffix: 'hisui', prefix: 'ヒスイ' },
  { suffix: 'galar', prefix: 'ガラル' },
  { suffix: 'paldea', prefix: 'パルデア' },
];

function deriveJa(speciesId: string, baseJa: string | undefined, isMega: boolean): string | null {
  if (JA_OVERRIDES[speciesId]) return JA_OVERRIDES[speciesId];
  if (!baseJa) return null;
  if (isMega) {
    if (speciesId.endsWith('megax')) return `メガ${baseJa}X`;
    if (speciesId.endsWith('megay')) return `メガ${baseJa}Y`;
    if (speciesId.endsWith('mega') || speciesId.endsWith('primal')) return `メガ${baseJa}`;
  }
  for (const { suffix, prefix } of REGIONAL_SUFFIX_TO_JA) {
    if (speciesId.endsWith(suffix)) return `${prefix}${baseJa}`;
  }
  return baseJa;
}

for (const species of Dex.species.all()) {
  if (!ALLOWED_NONSTANDARD.has(species.isNonstandard ?? null)) continue;
  if (species.num <= 0) continue;

  const types = species.types.map(toTypeName);
  const type1 = types[0];
  if (!type1) {
    throw new Error(`Species ${species.name} has no types`);
  }

  const baseJa = jpNames.species[String(species.num)];
  const nameJa = deriveJa(species.id, baseJa, !!species.isMega);

  pokemonRows.push({
    id: species.id,
    nameEn: species.name,
    nameJa,
    type1,
    type2: types[1] ?? null,
    hp: species.baseStats.hp,
    atk: species.baseStats.atk,
    def: species.baseStats.def,
    spa: species.baseStats.spa,
    spd: species.baseStats.spd,
    spe: species.baseStats.spe,
  });

  for (const [slotKey, abilityName] of Object.entries(species.abilities)) {
    if (!abilityName) continue;
    const slot = SLOT_MAP[slotKey];
    if (!slot) continue;

    const ability = Dex.abilities.get(abilityName);
    if (!ability || !ability.exists) continue;

    if (!abilityRows.has(ability.id)) {
      abilityRows.set(ability.id, {
        id: ability.id,
        nameEn: ability.name,
        nameJa: jpNames.abilities[ability.id] ?? null,
        description: ability.shortDesc ?? ability.desc ?? null,
      });
    }

    pokemonAbilityRows.push({
      pokemonId: species.id,
      abilityId: ability.id,
      slot,
    });
  }
}

await db
  .insert(abilities)
  .values(Array.from(abilityRows.values()))
  .onConflictDoUpdate({
    target: abilities.id,
    set: {
      nameEn: raw`excluded.name_en`,
      nameJa: raw`excluded.name_ja`,
      description: raw`excluded.description`,
    },
  });
await db
  .insert(pokemon)
  .values(pokemonRows)
  .onConflictDoUpdate({
    target: pokemon.id,
    set: {
      nameEn: raw`excluded.name_en`,
      nameJa: raw`excluded.name_ja`,
      type1: raw`excluded.type1`,
      type2: raw`excluded.type2`,
      hp: raw`excluded.hp`,
      atk: raw`excluded.atk`,
      def: raw`excluded.def`,
      spa: raw`excluded.spa`,
      spd: raw`excluded.spd`,
      spe: raw`excluded.spe`,
    },
  });
await db.insert(pokemonAbilities).values(pokemonAbilityRows).onConflictDoNothing();

console.log(
  `seeded: ${abilityRows.size} abilities, ${pokemonRows.length} pokemon, ${pokemonAbilityRows.length} pokemon_abilities`,
);

await sql.end();
