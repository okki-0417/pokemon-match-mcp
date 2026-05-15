import 'dotenv/config';
import { Dex } from '@pkmn/dex';
import { sql as raw } from 'drizzle-orm';
import { db, sqlite } from '../db/client.js';
import { natures, NATURE_STATS, type NatureStat } from '../db/schema/index.js';

type NatureInsert = typeof natures.$inferInsert;
type StatName = NatureStat;

const STAT_NAMES = new Set<StatName>(NATURE_STATS);

function toStatName(value: string | undefined): StatName | null {
  if (!value) return null;
  if (!STAT_NAMES.has(value as StatName)) {
    throw new Error(`Unknown nature stat "${value}"`);
  }
  return value as StatName;
}

const JA_BY_ID: Record<string, string> = {
  adamant: 'いじっぱり',
  bashful: 'てれや',
  bold: 'ずぶとい',
  brave: 'ゆうかん',
  calm: 'おだやか',
  careful: 'しんちょう',
  docile: 'すなお',
  gentle: 'おとなしい',
  hardy: 'がんばりや',
  hasty: 'せっかち',
  impish: 'わんぱく',
  jolly: 'ようき',
  lax: 'のうてんき',
  lonely: 'さみしがり',
  mild: 'おっとり',
  modest: 'ひかえめ',
  naive: 'むじゃき',
  naughty: 'やんちゃ',
  quiet: 'れいせい',
  quirky: 'きまぐれ',
  rash: 'うっかりや',
  relaxed: 'のんき',
  sassy: 'なまいき',
  serious: 'まじめ',
  timid: 'おくびょう',
};

const rows: NatureInsert[] = Dex.natures.all().map((nature) => ({
  id: nature.id,
  nameEn: nature.name,
  nameJa: JA_BY_ID[nature.id] ?? null,
  plus: toStatName(nature.plus),
  minus: toStatName(nature.minus),
}));

await db
  .insert(natures)
  .values(rows)
  .onConflictDoUpdate({
    target: natures.id,
    set: {
      nameEn: raw`excluded.name_en`,
      nameJa: raw`excluded.name_ja`,
      plus: raw`excluded.plus`,
      minus: raw`excluded.minus`,
    },
  });

console.log(`seeded: ${rows.length} natures`);

sqlite.close();
