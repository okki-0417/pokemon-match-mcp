import { eq, type SQL } from 'drizzle-orm';
import { pokemon } from './schema/index.js';

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
