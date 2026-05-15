import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const path = process.env.SQLITE_PATH ?? 'data/db.sqlite';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: path },
  strict: true,
  verbose: true,
});
