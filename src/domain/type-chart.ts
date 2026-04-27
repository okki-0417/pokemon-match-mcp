import { pokemonType } from '../db/schema/index.js';

export type TypeName = (typeof pokemonType.enumValues)[number];

export const TYPE_NAMES: readonly TypeName[] = pokemonType.enumValues;

// TYPE_CHART[attacker][defender] = damage multiplier. Missing entries default to 1.
// Standard gen 6+ chart (includes Fairy).
const TYPE_CHART: Record<TypeName, Partial<Record<TypeName, number>>> = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: {
    fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5,
    bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5,
  },
  ice: {
    fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5,
  },
  fighting: {
    normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5,
    rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5,
  },
  poison: {
    grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2,
  },
  ground: {
    fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2,
  },
  flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug: {
    fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2,
    ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5,
  },
  rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
};

export function effectiveness(attacker: TypeName, defender: TypeName): number {
  return TYPE_CHART[attacker][defender] ?? 1;
}

// Multipliers granted by abilities. Multiplied with the type-chart result.
// Immunity abilities use 0 so the product collapses to 0.
const ABILITY_TYPE_MULTIPLIER: Record<string, Partial<Record<TypeName, number>>> = {
  levitate: { ground: 0 },
  flashfire: { fire: 0 },
  voltabsorb: { electric: 0 },
  motordrive: { electric: 0 },
  lightningrod: { electric: 0 },
  waterabsorb: { water: 0 },
  stormdrain: { water: 0 },
  sapsipper: { grass: 0 },
  wellbakedbody: { fire: 0 },
  eartheater: { ground: 0 },
  thickfat: { fire: 0.5, ice: 0.5 },
  heatproof: { fire: 0.5 },
  purifyingsalt: { ghost: 0.5 },
};

export function abilityMultiplier(abilityId: string, attacker: TypeName): number {
  return ABILITY_TYPE_MULTIPLIER[abilityId]?.[attacker] ?? 1;
}

export type DefensiveMatchup = Record<TypeName, number>;

export function computeDefensiveMatchup(
  type1: TypeName,
  type2: TypeName | null,
  abilityId?: string,
): DefensiveMatchup {
  const result = {} as DefensiveMatchup;
  for (const attacker of TYPE_NAMES) {
    let mult = effectiveness(attacker, type1);
    if (type2) mult *= effectiveness(attacker, type2);
    if (abilityId) mult *= abilityMultiplier(abilityId, attacker);
    result[attacker] = mult;
  }
  return result;
}

export function bucketize(matchup: DefensiveMatchup): Record<string, TypeName[]> {
  const buckets: Record<string, TypeName[]> = {
    'x4': [], 'x2': [], 'x1': [], 'x0.5': [], 'x0.25': [], 'x0': [],
  };
  for (const [type, mult] of Object.entries(matchup) as [TypeName, number][]) {
    if (mult === 0) buckets['x0']!.push(type);
    else if (mult === 0.25) buckets['x0.25']!.push(type);
    else if (mult === 0.5) buckets['x0.5']!.push(type);
    else if (mult === 1) buckets['x1']!.push(type);
    else if (mult === 2) buckets['x2']!.push(type);
    else if (mult === 4) buckets['x4']!.push(type);
    else buckets[`x${mult}`] = [...(buckets[`x${mult}`] ?? []), type];
  }
  return buckets;
}
