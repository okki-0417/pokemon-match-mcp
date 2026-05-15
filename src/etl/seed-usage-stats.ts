import 'dotenv/config';
import { readFile, access } from 'node:fs/promises';
import { sql as raw } from 'drizzle-orm';
import { db, sqlite } from '../db/client.js';
import { usageStats, pokemon } from '../db/schema/index.js';
import { normalizePokemonId } from '../db/lookup.js';
import { chunked, chunkSize } from './_chunk.js';

const ALLOW_MISSING = process.env.SMOGON_OPTIONAL === '1';

const FORMAT = process.env.SMOGON_FORMAT ?? 'gen9championsvgc2026regma';
const ELO = Number(process.env.SMOGON_ELO ?? 1500);
const YEAR_MONTH = process.env.SMOGON_YEAR_MONTH ?? defaultYearMonth();

function defaultYearMonth(): string {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`;
}

type ChaosEntry = {
  'Raw count': number;
  Abilities: Record<string, number>;
  Items: Record<string, number>;
  Spreads: Record<string, number>;
  Moves: Record<string, number>;
  Teammates: Record<string, number>;
  usage: number;
};

type ChaosFile = {
  info: { metagame: string; cutoff: number; 'number of battles': number };
  data: Record<string, ChaosEntry>;
};

const path = `data/smogon-stats/${YEAR_MONTH}/${FORMAT}-${ELO}.json`;
try {
  await access(path);
} catch {
  if (ALLOW_MISSING) {
    console.log(`skipped: ${path} not found (SMOGON_OPTIONAL=1). Run \`pnpm data:fetch-smogon-stats\` to ingest.`);
    sqlite.close();
    process.exit(0);
  }
  throw new Error(`cache not found: ${path}. Run \`pnpm data:fetch-smogon-stats\` first, or set SMOGON_OPTIONAL=1 to skip.`);
}
const text = await readFile(path, 'utf8');
const chaos = JSON.parse(text) as ChaosFile;

console.log(
  `loaded ${path} (metagame=${chaos.info.metagame}, cutoff=${chaos.info.cutoff}, battles=${chaos.info['number of battles']})`,
);

// Build pokemon-id whitelist so we don't fail FK on Smogon-only entries
// (different forme spellings, removed mons, etc).
const knownIds = new Set(
  (await db.select({ id: pokemon.id }).from(pokemon)).map((r) => r.id),
);

type Insert = typeof usageStats.$inferInsert;
const rows: Insert[] = [];
const skipped: string[] = [];
for (const [name, entry] of Object.entries(chaos.data)) {
  const id = normalizePokemonId(name);
  if (!knownIds.has(id)) {
    skipped.push(name);
    continue;
  }
  rows.push({
    format: FORMAT,
    yearMonth: YEAR_MONTH,
    eloCutoff: ELO,
    pokemonId: id,
    usagePct: entry.usage,
    rawCount: entry['Raw count'],
    moves: entry.Moves,
    items: entry.Items,
    abilities: entry.Abilities,
    teammates: entry.Teammates,
    spreads: entry.Spreads,
  });
}

for (const slice of chunked(rows, chunkSize(11)))
await db
  .insert(usageStats)
  .values(slice)
  .onConflictDoUpdate({
    target: [usageStats.format, usageStats.yearMonth, usageStats.eloCutoff, usageStats.pokemonId],
    set: {
      usagePct: raw`excluded.usage_pct`,
      rawCount: raw`excluded.raw_count`,
      moves: raw`excluded.moves`,
      items: raw`excluded.items`,
      abilities: raw`excluded.abilities`,
      teammates: raw`excluded.teammates`,
      spreads: raw`excluded.spreads`,
    },
  });

console.log(
  `seeded ${rows.length} usage_stats rows for ${FORMAT} ${YEAR_MONTH} elo=${ELO}` +
    (skipped.length ? ` (skipped ${skipped.length} unknown species: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '...' : ''})` : ''),
);

sqlite.close();
