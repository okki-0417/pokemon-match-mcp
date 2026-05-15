import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Dex } from '@pkmn/dex';

const OUTPUT_PATH = 'data/jp-names.json';
const POKEAPI = 'https://pokeapi.co/api/v2';
const CONCURRENCY = 8;

type NameEntry = { name: string; language: { name: string } };

function pickJa(entries: NameEntry[]): string | null {
  return (
    entries.find((n) => n.language.name === 'ja')?.name ??
    entries.find((n) => n.language.name === 'ja-Hrkt')?.name ??
    null
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} ${url}`);
  return (await res.json()) as T;
}

async function pool<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      const item = items[i]!;
      results[i] = await worker(item);
    }
  });
  await Promise.all(runners);
  return results;
}

const ALLOWED_NONSTANDARD = new Set<string | null>([null, 'Past', 'Future']);

const speciesNums = new Set<number>();
for (const species of Dex.species.all()) {
  if (!ALLOWED_NONSTANDARD.has(species.isNonstandard ?? null)) continue;
  if (species.num <= 0) continue;
  speciesNums.add(species.num);
}

console.log(`fetching ${speciesNums.size} species...`);
const speciesEntries = await pool(Array.from(speciesNums), async (num) => {
  const data = await fetchJson<{ names: NameEntry[] }>(`${POKEAPI}/pokemon-species/${num}/`);
  return [num, pickJa(data.names)] as const;
});
const speciesJa: Record<number, string> = {};
for (const [num, ja] of speciesEntries) {
  if (ja) speciesJa[num] = ja;
}

async function fetchByList(resource: string): Promise<Record<string, string>> {
  const list = await fetchJson<{ count: number; results: { name: string; url: string }[] }>(
    `${POKEAPI}/${resource}/?limit=2000`,
  );
  console.log(`fetching ${list.results.length} ${resource}...`);
  const entries = await pool(list.results, async ({ name, url }) => {
    const data = await fetchJson<{ names: NameEntry[] }>(url);
    return [name.replace(/-/g, ''), pickJa(data.names)] as const;
  });
  const out: Record<string, string> = {};
  for (const [id, ja] of entries) {
    if (ja) out[id] = ja;
  }
  return out;
}

console.log(`fetching ability list...`);
const abilitiesJa = await fetchByList('ability');

console.log(`fetching move list...`);
const movesJa = await fetchByList('move');

console.log(`fetching item list...`);
const itemsJa = await fetchByList('item');

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(
  OUTPUT_PATH,
  JSON.stringify(
    {
      species: speciesJa,
      abilities: abilitiesJa,
      moves: movesJa,
      items: itemsJa,
    },
    null,
    2,
  ),
);

console.log(
  `wrote ${OUTPUT_PATH}: ${Object.keys(speciesJa).length} species, ${Object.keys(abilitiesJa).length} abilities, ${Object.keys(movesJa).length} moves, ${Object.keys(itemsJa).length} items`,
);
