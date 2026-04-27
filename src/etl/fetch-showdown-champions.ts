import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = 'https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data/mods/champions';
const OUT_DIR = 'data/showdown-champions';
const FILES = [
  'abilities.ts',
  'conditions.ts',
  'formats-data.ts',
  'items.ts',
  'learnsets.ts',
  'moves.ts',
  'rulesets.ts',
  'scripts.ts',
];

await mkdir(OUT_DIR, { recursive: true });

// Strip `import('...').TypeName` annotations so the files load standalone
// without Showdown's sim/ directory.
function strip(text: string): string {
  return text.replace(/:\s*import\([^)]+\)\.[A-Za-z]+/g, '');
}

await Promise.all(
  FILES.map(async (name) => {
    const url = `${BASE}/${name}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} ${url}`);
    const text = strip(await res.text());
    const path = join(OUT_DIR, name);
    await writeFile(path, text);
    console.log(`  ${name}: ${text.length} bytes`);
  }),
);

console.log(`wrote ${FILES.length} files to ${OUT_DIR}`);
