/**
 * db.ts — Drizzle/better-sqlite3 database singleton.
 *
 * Runs in the Electron main process (Node context).
 * The database file lives next to the app data directory.
 *
 * Usage:
 *   import { db } from './db.js'
 *   import { conversations, messages } from '../src/db/schema.js'
 *   const all = db.select().from(conversations).all()
 */

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Store the DB alongside the app — one level up from dist-electron/
const DB_PATH         = path.join(__dirname, '..', 'omni.db')
const MIGRATIONS_PATH = path.join(__dirname, '..', 'src', 'db', 'migrations')

const sqlite = new Database(DB_PATH)

// WAL mode — better concurrent read performance
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('synchronous = NORMAL')

export const db = drizzle(sqlite)

/**
 * Run pending migrations on startup.
 * Call this once in `app.whenReady()` before any queries.
 */
export function runMigrations() {
  try {
    migrate(db, { migrationsFolder: MIGRATIONS_PATH })
  } catch (e) {
    // Non-fatal — app works without migrations (schema may already be current)
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[db]', (e as Error).message)
    }
  }
}
