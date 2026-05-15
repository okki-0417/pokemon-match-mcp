import { eq, type SQL } from 'drizzle-orm';
import { abilities, items, moves, natures, pokemon } from './schema/index.js';

const ASCII_ONLY = /^[\x00-\x7F]+$/;

export function normalizePokemonId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function pokemonLookup(input: string): SQL {
  const trimmed = input.trim();
  if (!ASCII_ONLY.test(trimmed)) {
    return eq(pokemon.nameJa, trimmed);
  }
  return eq(pokemon.id, normalizePokemonId(trimmed));
}

export function itemLookup(input: string): SQL {
  const trimmed = input.trim();
  if (!ASCII_ONLY.test(trimmed)) {
    return eq(items.nameJa, trimmed);
  }
  return eq(items.id, normalizePokemonId(trimmed));
}

export function natureLookup(input: string): SQL {
  const trimmed = input.trim();
  if (!ASCII_ONLY.test(trimmed)) {
    return eq(natures.nameJa, trimmed);
  }
  return eq(natures.id, normalizePokemonId(trimmed));
}

export function moveLookup(input: string): SQL {
  const trimmed = input.trim();
  if (!ASCII_ONLY.test(trimmed)) {
    return eq(moves.nameJa, trimmed);
  }
  return eq(moves.id, normalizePokemonId(trimmed));
}

export function abilityLookup(input: string): SQL {
  const trimmed = input.trim();
  if (!ASCII_ONLY.test(trimmed)) {
    return eq(abilities.nameJa, trimmed);
  }
  return eq(abilities.id, normalizePokemonId(trimmed));
}
