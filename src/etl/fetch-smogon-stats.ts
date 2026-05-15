import { writeFile, mkdir, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';

// Defaults: latest available month is published on the 1st of the following month.
// Champions VGC 2026 Reg M-A, mid-ladder cutoff 1500.
const FORMAT = process.env.SMOGON_FORMAT ?? 'gen9championsvgc2026regma';
const ELO = Number(process.env.SMOGON_ELO ?? 1500);
const YEAR_MONTH = process.env.SMOGON_YEAR_MONTH ?? defaultYearMonth();

function defaultYearMonth(): string {
  const now = new Date();
  // Stats for month M are published ~1st of M+1. Default to "previous month" so a
  // fetch run on the 5th of May returns April data without needing config.
  const target = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

const url = `https://www.smogon.com/stats/${YEAR_MONTH}/chaos/${FORMAT}-${ELO}.json.gz`;
const outPath = `data/smogon-stats/${YEAR_MONTH}/${FORMAT}-${ELO}.json`;

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

if (await exists(outPath) && process.env.FORCE !== '1') {
  console.log(`cache hit: ${outPath} (set FORCE=1 to refetch)`);
  process.exit(0);
}

console.log(`fetching ${url}...`);
const res = await fetch(url);
if (!res.ok) {
  throw new Error(`fetch failed: ${res.status} ${res.statusText} ${url}`);
}
const gz = Buffer.from(await res.arrayBuffer());
const json = gunzipSync(gz).toString('utf8');

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, json);
console.log(`wrote ${outPath} (${(json.length / 1024 / 1024).toFixed(1)} MB)`);
