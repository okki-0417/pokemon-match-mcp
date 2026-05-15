// Common internal shape for Champions species/ability overrides.
// Adapters convert source-specific data (otterlyclueless / yakkun / manual /
// Showdown direct) into these shapes; the seed only knows this interface.

import type { TypeName } from '../../domain/type-chart.js';

export type BaseStats = { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };

export type ChampionsOverride = {
  // Normalized pokemon id matching our DB (e.g. "meganiummega").
  pokemonId: string;
  // Omit a field to keep mainline @pkmn/dex value; provide it to overwrite.
  types?: TypeName[]; // 1 or 2 entries
  abilities?: string[]; // EN ability names (canonical, will be normalized to ids)
  baseStats?: BaseStats;
};

export type ChampionsAbility = {
  id: string; // normalized id (e.g. "megasol")
  nameEn: string; // "Mega Sol"
  nameJa?: string; // manual mapping (PokéAPI doesn't carry these)
  description?: string;
};

export interface ChampionsSource {
  readonly name: string;
  /** Per-pokemon overrides (types/abilities/baseStats) to apply on top of mainline seed. */
  loadOverrides(): Promise<ChampionsOverride[]>;
  /** Champions-original abilities not present in @pkmn/dex base, to seed into abilities table. */
  loadCustomAbilities(): Promise<ChampionsAbility[]>;
}
