import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { Dex } from '@pkmn/dex';
import { sql as raw } from 'drizzle-orm';
import { db, sqlite } from '../db/client.js';
import {
  pokemon,
  abilities,
  pokemonAbilities,
  POKEMON_TYPES,
  ABILITY_SLOTS,
  type PokemonType,
  type AbilitySlot,
} from '../db/schema/index.js';
import { chunked, chunkSize } from './_chunk.js';

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
type TypeName = PokemonType;
type SlotName = AbilitySlot;

const TYPE_NAMES = new Set<TypeName>(POKEMON_TYPES);
void ABILITY_SLOTS; // re-exported for downstream use; not needed locally

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

  // genderRatio in @pkmn/dex: undefined for genderless or single-gender; when
  // present it's {M: number, F: number} summing to 1. Normalize to GenderRatio
  // shape, leaving null when truly genderless.
  let genderRatio: { M: number; F: number } | null = null;
  if (species.genderRatio) {
    genderRatio = { M: species.genderRatio.M ?? 0, F: species.genderRatio.F ?? 0 };
  } else if (species.gender === 'M') {
    genderRatio = { M: 1, F: 0 };
  } else if (species.gender === 'F') {
    genderRatio = { M: 0, F: 1 };
  } // species.gender === 'N' or undefined → null (genderless)

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
    weightkg: species.weightkg,
    gen: species.gen,
    dexNum: species.num,
    baseSpecies: species.baseSpecies,
    forme: species.forme || null,
    prevo: species.prevo || null,
    evos: species.evos ?? [],
    otherFormes: species.otherFormes ?? [],
    // @pkmn/dex's isMega flag misses formes named "M-Mega" / "F-Mega" (e.g.
    // Meowstic-M-Mega) because it's set only when forme === "Mega". Detect via
    // suffix as well so gender-split megas register as megas.
    isMega: !!species.isMega || (species.forme || '').endsWith('Mega'),
    isPrimal: !!species.isPrimal,
    eggGroups: species.eggGroups ?? [],
    genderRatio,
    tier: species.tier || null,
    doublesTier: species.doublesTier || null,
    natDexTier: species.natDexTier || null,
    tags: species.tags ?? [],
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
        flags: ability.flags ? Object.keys(ability.flags) : [],
        descLong: ability.desc ?? null,
      });
    }

    pokemonAbilityRows.push({
      pokemonId: species.id,
      abilityId: ability.id,
      slot,
    });
  }
}

const abilityList = Array.from(abilityRows.values());
for (const slice of chunked(abilityList, chunkSize(6))) {
  await db
    .insert(abilities)
    .values(slice)
    .onConflictDoUpdate({
      target: abilities.id,
      set: {
        nameEn: raw`excluded.name_en`,
        nameJa: raw`excluded.name_ja`,
        description: raw`excluded.description`,
        flags: raw`excluded.flags`,
        descLong: raw`excluded.desc_long`,
      },
    });
}
for (const slice of chunked(pokemonRows, chunkSize(29))) {
  await db
    .insert(pokemon)
    .values(slice)
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
        weightkg: raw`excluded.weightkg`,
        gen: raw`excluded.gen`,
        dexNum: raw`excluded.dex_num`,
        baseSpecies: raw`excluded.base_species`,
        forme: raw`excluded.forme`,
        prevo: raw`excluded.prevo`,
        evos: raw`excluded.evos`,
        otherFormes: raw`excluded.other_formes`,
        isMega: raw`excluded.is_mega`,
        isPrimal: raw`excluded.is_primal`,
        eggGroups: raw`excluded.egg_groups`,
        genderRatio: raw`excluded.gender_ratio`,
        tier: raw`excluded.tier`,
        doublesTier: raw`excluded.doubles_tier`,
        natDexTier: raw`excluded.nat_dex_tier`,
        tags: raw`excluded.tags`,
      },
    });
}
for (const slice of chunked(pokemonAbilityRows, chunkSize(3))) {
  await db.insert(pokemonAbilities).values(slice).onConflictDoNothing();
}

console.log(
  `seeded: ${abilityRows.size} abilities, ${pokemonRows.length} pokemon, ${pokemonAbilityRows.length} pokemon_abilities`,
);

sqlite.close();
