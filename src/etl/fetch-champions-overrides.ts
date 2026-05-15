import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const REPO = 'otterlyclueless/pokemon-champions-data';
const REF = process.env.CHAMPIONS_OVERRIDES_REF ?? 'main';
const BASE = `https://raw.githubusercontent.com/${REPO}/${REF}`;
const OUT_DIR = 'data/champions-overrides/raw';

const FILES = [
  'pokemon/roster.json',
  'pokemon/base-stats.json',
  'abilities/abilities.json',
  'meta/version.json',
];

await mkdir(OUT_DIR, { recursive: true });

let bytes = 0;
await Promise.all(
  FILES.map(async (relPath) => {
    const url = `${BASE}/${relPath}`;
    const res = await fetch(url);
    if (!res.ok) {
      // meta/version.json may be missing in older snapshots; treat as soft.
      if (relPath === 'meta/version.json') {
        console.warn(`  skipped (${res.status}): ${relPath}`);
        return;
      }
      throw new Error(`${res.status} ${res.statusText} ${url}`);
    }
    const text = await res.text();
    const outPath = join(OUT_DIR, relPath.split('/').pop()!);
    await writeFile(outPath, text);
    bytes += text.length;
    console.log(`  ${relPath}: ${text.length} bytes`);
  }),
);

console.log(`fetched ${bytes} bytes from ${REPO}@${REF}`);
