import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

// ── Conversations ─────────────────────────────────────────────────────────────
export const conversations = sqliteTable('conversations', {
  id:        text('id').primaryKey(),
  title:     text('title').notNull().default('New Session'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

// ── Messages ──────────────────────────────────────────────────────────────────
export const messages = sqliteTable('messages', {
  id:             text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id),
  role:           text('role', { enum: ['user', 'assistant'] }).notNull(),
  content:        text('content').notNull(),
  createdAt:      integer('created_at', { mode: 'timestamp' }).notNull(),
  tokenCount:     integer('token_count'),
})

// ── Settings ──────────────────────────────────────────────────────────────────
export const settings = sqliteTable('settings', {
  key:   text('key').primaryKey(),
  value: text('value').notNull(),
})

// ── Audio snapshots (visualizer history) ─────────────────────────────────────
export const audioSnapshots = sqliteTable('audio_snapshots', {
  id:        text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  rms:       real('rms').notNull(),
  peak:      real('peak').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})
