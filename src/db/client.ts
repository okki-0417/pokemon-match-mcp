import 'dotenv/config';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema/index.js';

const PATH = process.env.SQLITE_PATH ?? 'data/db.sqlite';
const sqlite = new Database(PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export { sqlite };
export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
