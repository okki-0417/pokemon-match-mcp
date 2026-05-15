import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { Dex } from '@pkmn/dex';
import { sql as raw } from 'drizzle-orm';
import { db, sqlite } from '../db/client.js';
import { items, pokemon } from '../db/schema/index.js';
import type { Fling, MegaStoneMap, NaturalGift } from '../db/schema/items.js';
import { chunked, chunkSize } from './_chunk.js';

type ItemInsert = typeof items.$inferInsert;

const ALLOWED_NONSTANDARD = new Set<string | null>([null, 'Past', 'Future']);

const jpNames = JSON.parse(await readFile('data/jp-names.json', 'utf8')) as {
  items?: Record<string, string>;
};
const itemsJa = jpNames.items ?? {};

// Champions mod overrides (same regex strategy as seed-moves.ts).
// The mod's items.ts only flips isNonstandard to null/"Past"; nothing else
// structural is changed, so a regex over each top-level item block is enough.
const championsItemsText = await readFile('data/showdown-champions/items.ts', 'utf8');
const championsOverrides = new Map<string, string | null>();
const itemBlockRegex = /^\t(\w+):\s*\{([\s\S]*?)^\t\},$/gm;
for (const match of championsItemsText.matchAll(itemBlockRegex)) {
  const itemId = match[1]!;
  const body = match[2]!;
  const ns = body.match(/\bisNonstandard:\s*(null|"[^"]+")/);
  if (!ns) continue;
  const v = ns[1]!;
  championsOverrides.set(itemId, v === 'null' ? null : v.slice(1, -1));
}

const rows: ItemInsert[] = [];
for (const item of Dex.items.all()) {
  if (!item.id) continue;

  const baseNs = item.isNonstandard ?? null;
  const effectiveNs = championsOverrides.has(item.id)
    ? championsOverrides.get(item.id) ?? null
    : baseNs;
  if (!ALLOWED_NONSTANDARD.has(effectiveNs)) continue;

  rows.push({
    id: item.id,
    nameEn: item.name,
    nameJa: itemsJa[item.id] ?? null,
    description: item.shortDesc ?? item.desc ?? null,
    isChampions: effectiveNs === null,
    isBerry: item.isBerry === true,
    megaStone: (item.megaStone ?? null) as MegaStoneMap | null,
    fling: (item.fling ?? null) as Fling | null,
    naturalGift: (item.naturalGift ?? null) as NaturalGift | null,
    itemUser: item.itemUser ?? null,
    onMemory: item.onMemory ?? null,
    descLong: item.desc ?? null,
  });
}

// Derive JP names for Champions-original mega stones (which PokéAPI doesn't carry):
// pattern is `{base species JP name}ナイト` (paren-form suffix stripped).
// Example: chandelurite (holder: Chandelure → シャンデラ) → シャンデラナイト.
const speciesJaByEn = new Map<string, string | null>();
for (const row of await db.select({ en: pokemon.nameEn, ja: pokemon.nameJa }).from(pokemon)) {
  speciesJaByEn.set(row.en, row.ja);
}
let derivedJa = 0;
for (const row of rows) {
  if (row.nameJa || !row.megaStone) continue;
  const holderEn = Object.keys(row.megaStone)[0];
  if (!holderEn) continue;
  const holderJa = speciesJaByEn.get(holderEn);
  if (!holderJa) continue;
  const baseJa = holderJa.replace(/\([^)]*\)$/, '');
  row.nameJa = `${baseJa}ナイト`;
  derivedJa++;
}

for (const slice of chunked(rows, chunkSize(12)))
await db
  .insert(items)
  .values(slice)
  .onConflictDoUpdate({
    target: items.id,
    set: {
      nameEn: raw`excluded.name_en`,
      nameJa: raw`excluded.name_ja`,
      description: raw`excluded.description`,
      isChampions: raw`excluded.is_champions`,
      isBerry: raw`excluded.is_berry`,
      megaStone: raw`excluded.mega_stone`,
      fling: raw`excluded.fling`,
      naturalGift: raw`excluded.natural_gift`,
      itemUser: raw`excluded.item_user`,
      onMemory: raw`excluded.on_memory`,
      descLong: raw`excluded.desc_long`,
    },
  });

const championsCount = rows.filter((r) => r.isChampions).length;
console.log(
  `seeded ${rows.length} items (champions-legal: ${championsCount}, derived JP for ${derivedJa} mega stones)`,
);

sqlite.close();
