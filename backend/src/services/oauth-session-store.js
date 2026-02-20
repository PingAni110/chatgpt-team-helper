import { getDatabase, saveDatabase } from '../database/init.js'

const DEFAULT_TTL_MS = 12 * 60 * 1000

function nowMs() {
  return Date.now()
}

function isoFromMs(ms) {
  return new Date(ms).toISOString()
}

async function cleanupExpired(database) {
  database.run("DELETE FROM oauth_pkce_sessions WHERE expires_at <= DATETIME('now')")
}

export async function setOAuthSession(payload, ttlMs = DEFAULT_TTL_MS) {
  const db = await getDatabase()
  const expiresAtMs = nowMs() + ttlMs
  const record = {
    state: String(payload.state || '').trim(),
    sessionKey: String(payload.sessionKey || '').trim(),
    codeVerifier: String(payload.codeVerifier || '').trim(),
    codeChallenge: String(payload.codeChallenge || '').trim(),
    proxy: payload.proxy ? String(payload.proxy) : null,
    accountIdentifier: String(payload.accountIdentifier || 'unknown').trim(),
    nonce: String(payload.nonce || '').trim(),
    createdAt: isoFromMs(nowMs()),
    expiresAt: isoFromMs(expiresAtMs)
  }

  if (!record.state || !record.sessionKey || !record.codeVerifier) {
    throw new Error('OAuth 会话信息不完整，无法持久化')
  }

  cleanupExpired(db)

  db.run(
    `INSERT INTO oauth_pkce_sessions (
      session_key, state, code_verifier, code_challenge, proxy, account_identifier, nonce, consumed_at, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, DATETIME('now', 'localtime'), DATETIME(?, 'unixepoch', 'localtime'))`,
    [record.sessionKey, record.state, record.codeVerifier, record.codeChallenge, record.proxy, record.accountIdentifier, record.nonce, Math.floor(expiresAtMs / 1000)]
  )

  await saveDatabase()
  return record
}

export async function consumeOAuthSessionByState(state) {
  const db = await getDatabase()
  const normalizedState = String(state || '').trim()
  if (!normalizedState) return null

  cleanupExpired(db)

  const result = db.exec(
    `SELECT id, session_key, state, code_verifier, code_challenge, proxy, account_identifier, nonce, created_at, expires_at
     FROM oauth_pkce_sessions
     WHERE state = ? AND consumed_at IS NULL AND expires_at > DATETIME('now')
     LIMIT 1`,
    [normalizedState]
  )

  if (!result[0]?.values?.length) {
    return null
  }

  const row = result[0].values[0]
  const record = {
    id: Number(row[0]),
    sessionKey: row[1],
    state: row[2],
    codeVerifier: row[3],
    codeChallenge: row[4],
    proxy: row[5],
    accountIdentifier: row[6],
    nonce: row[7],
    createdAt: row[8],
    expiresAt: row[9]
  }

  db.run(
    `UPDATE oauth_pkce_sessions
      SET consumed_at = DATETIME('now', 'localtime')
     WHERE id = ? AND consumed_at IS NULL`,
    [record.id]
  )

  if (db.getRowsModified() === 0) {
    return null
  }

  await saveDatabase()
  return record
}
