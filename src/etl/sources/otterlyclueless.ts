import { readFile } from 'node:fs/promises';
import { Dex } from '@pkmn/dex';
import { TYPE_NAMES, type TypeName } from '../../domain/type-chart.js';
import type { ChampionsAbility, ChampionsOverride, ChampionsSource } from './types.js';

const RAW_DIR = 'data/champions-overrides/raw';

type RosterEntry = {
  name: string;
  dexNumber: number;
  types: string[];
  form: string;
  abilities: Record<string, string>; // {0: "Mega Sol", 1: "...", H: "..."}
  championsVerified: boolean;
};
type StatsEntry = {
  name: string;
  dexNumber: number;
  form: string;
  hp: number; atk: number; def: number; spa: number; spd: number; spe: number;
  total: number;
  championsVerified: boolean;
};
type AbilityEntry = {
  name: string;
  description: string;
  championsVerified: boolean;
};

const TYPE_SET = new Set<TypeName>(TYPE_NAMES);

function toTypeName(raw: string): TypeName {
  const lower = raw.toLowerCase();
  if (!TYPE_SET.has(lower as TypeName)) {
    throw new Error(`unknown type "${raw}" from otterlyclueless`);
  }
  return lower as TypeName;
}

function normalizeId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Map an otterlyclueless display name like "Mega Meganium" to one or more
 * canonical pokemon ids in our DB. Most cases resolve via @pkmn/dex's name
 * lookup; the gendered Meowstic mega is the one place a single source-side
 * entry expands to two DB rows because otterlyclueless doesn't distinguish
 * the M/F variants.
 */
function deriveTargetIds(name: string): string[] {
  // Mega Meowstic: otterlyclueless lists one entry but our DB tracks both
  // gendered megas (Meowstic-M-Mega / Meowstic-F-Mega). Same Champions data
  // applies to both per Showdown.
  if (name === 'Mega Meowstic') return ['meowsticmmega', 'meowsticfmega'];
  // Paldean Tauros: otterlyclueless only has the base Combat (Fighting) entry;
  // Blaze/Aqua forms aren't represented. Map to Combat only and let the other
  // two formes retain mainline @pkmn/dex data.
  if (name === 'Paldean Tauros') return ['taurospaldeacombat'];
  const s = Dex.species.get(name);
  if (s.exists) return [s.id];
  return [];
}

/** Convert ability display name to our canonical id (matches normalizePokemonId). */
function abilityNameToId(name: string): string {
  return normalizeId(name);
}

export const otterlycluelessSource: ChampionsSource = {
  name: 'otterlyclueless/pokemon-champions-data',

  async loadOverrides(): Promise<ChampionsOverride[]> {
    const [rosterText, statsText] = await Promise.all([
      readFile(`${RAW_DIR}/roster.json`, 'utf8'),
      readFile(`${RAW_DIR}/base-stats.json`, 'utf8'),
    ]);
    const roster = JSON.parse(rosterText) as Record<string, RosterEntry>;
    const stats = JSON.parse(statsText) as Record<string, StatsEntry>;

    // Stats keyed by (dexNumber, form, name) since same dex+form can occur
    // (e.g. Charizard Mega X / Y both dex=6 form=Mega).
    const statsByKey = new Map<string, StatsEntry>();
    for (const e of Object.values(stats)) {
      statsByKey.set(`${e.dexNumber}|${e.form}|${e.name}`, e);
    }

    const overrides: ChampionsOverride[] = [];
    const unmappedNames = new Set<string>();

    for (const entry of Object.values(roster)) {
      const ids = deriveTargetIds(entry.name);
      if (ids.length === 0) {
        unmappedNames.add(entry.name);
        continue;
      }

      const statEntry = statsByKey.get(`${entry.dexNumber}|${entry.form}|${entry.name}`);
      const types = entry.types.map(toTypeName);
      const abilities = Object.values(entry.abilities).filter((s) => s);

      for (const pokemonId of ids) {
        const o: ChampionsOverride = { pokemonId };
        if (types.length) o.types = types;
        if (abilities.length) o.abilities = abilities;
        if (statEntry) {
          o.baseStats = {
            hp: statEntry.hp, atk: statEntry.atk, def: statEntry.def,
            spa: statEntry.spa, spd: statEntry.spd, spe: statEntry.spe,
          };
        }
        overrides.push(o);
      }
    }

    if (unmappedNames.size > 0) {
      console.warn(
        `otterlyclueless: ${unmappedNames.size} entries unmapped: ${[...unmappedNames].slice(0, 5).join(', ')}${unmappedNames.size > 5 ? '...' : ''}`,
      );
    }

    return overrides;
  },

  async loadCustomAbilities(): Promise<ChampionsAbility[]> {
    const text = await readFile(`${RAW_DIR}/abilities.json`, 'utf8');
    const data = JSON.parse(text) as Record<string, AbilityEntry>;

    // JP names for Champions-original abilities — manual mapping since PokéAPI
    // doesn't have them. Add new entries here as Champions adds new megas.
    const JA: Record<string, string> = {
      megasol: 'メガソーラー',
      dragonize: 'ドラゴンスキン',
      piercingdrill: 'かんつうドリル',
      spicyspray: 'とびだすハバネロ',
    };

    const out: ChampionsAbility[] = [];
    for (const e of Object.values(data)) {
      const id = abilityNameToId(e.name);
      const ability: ChampionsAbility = {
        id,
        nameEn: e.name,
        description: e.description,
      };
      if (JA[id]) ability.nameJa = JA[id];
      out.push(ability);
    }
    return out;
  },
};
