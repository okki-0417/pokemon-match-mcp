import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index.js';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');
}

export const sql = postgres(url, { max: 10 });
export const db = drizzle(sql, { schema });
export type DB = typeof db;
