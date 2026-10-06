import pg from 'pg'

// pg is CommonJS — destructure after default import
const { Pool } = pg

let _pool: pg.Pool | null = null

/**
 * Returns a Postgres connection pool when DATABASE_URL is set.
 * Returns null when running locally without a DB — code falls back to JSON files.
 */
export function getDb(): pg.Pool | null {
  if (!process.env.DATABASE_URL) return null
  if (!_pool) {
    const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 2,   // Cloud SQL db-f1-micro hard limit ~25 conns; 2/instance is safe at up to 10 Cloud Run instances
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
    _pool.on('error', (err) => console.error('[db] pool error:', err))
  }
  return _pool
}

/**
 * Creates all tables on first boot. Safe to call on every startup — uses
 * CREATE TABLE IF NOT EXISTS so existing data is never touched.
 */
export async function initDb(): Promise<void> {
  const db = getDb()
  if (!db) {
    console.log('[db] No DATABASE_URL set — running with local JSON files')
    return
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id           TEXT PRIMARY KEY,
      key_hash     TEXT UNIQUE NOT NULL,
      name         TEXT NOT NULL DEFAULT '',
      owner_email  TEXT NOT NULL DEFAULT '',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      active       BOOLEAN NOT NULL DEFAULT TRUE,
      quota_limit  INTEGER NOT NULL DEFAULT 10000,
      quota_used   INTEGER NOT NULL DEFAULT 0
    )
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS usage_log (
      id           SERIAL PRIMARY KEY,
      key_id       TEXT NOT NULL,
      endpoint     TEXT NOT NULL,
      called_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      tokens_saved INTEGER NOT NULL DEFAULT 0
    )
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS wiki_store (
      key_id      TEXT PRIMARY KEY,
      user_wiki   JSONB,
      llm_wiki    JSONB,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS key_requests (
      id           SERIAL PRIMARY KEY,
      name         TEXT,
      email        TEXT,
      use_case     TEXT,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      fulfilled_at TIMESTAMPTZ
    )
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS context_policies (
      key_id      TEXT PRIMARY KEY,
      policy      JSONB NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS context_traces (
      id          BIGSERIAL PRIMARY KEY,
      key_id      TEXT NOT NULL,
      endpoint    TEXT NOT NULL,
      trace       JSONB NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  // Indexes for common query patterns
  await db.query(`CREATE INDEX IF NOT EXISTS idx_usage_key_id  ON usage_log(key_id)`)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_usage_time    ON usage_log(called_at DESC)`)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_keys_active   ON api_keys(active)`)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_traces_key_time ON context_traces(key_id, created_at DESC)`)

  console.log('[db] PostgreSQL schema ready ✓')
}
