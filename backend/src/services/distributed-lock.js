import { getDatabase, saveDatabase } from '../database/init.js'

function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000)
}

export async function acquireLock(lockKey, lockValue, ttlSeconds = 30) {
  const db = await getDatabase()
  const now = nowEpochSeconds()

  db.run('DELETE FROM distributed_locks WHERE expires_at_epoch <= ?', [now])

  try {
    db.run(
      `INSERT INTO distributed_locks (lock_key, lock_value, expires_at_epoch, created_at)
       VALUES (?, ?, ?, DATETIME('now', 'localtime'))`,
      [lockKey, lockValue, now + ttlSeconds]
    )
    await saveDatabase()
    return {
      acquired: true,
      release: async () => {
        const d = await getDatabase()
        d.run('DELETE FROM distributed_locks WHERE lock_key = ? AND lock_value = ?', [lockKey, lockValue])
        await saveDatabase()
      }
    }
  } catch {
    return { acquired: false, release: async () => {} }
  }
}

export async function setJsonCache(key, payload, ttlSeconds = 20) {
  const db = await getDatabase()
  const now = nowEpochSeconds()
  db.run('DELETE FROM distributed_cache WHERE expires_at_epoch <= ?', [now])
  db.run(
    `INSERT INTO distributed_cache (cache_key, payload_json, expires_at_epoch, created_at)
     VALUES (?, ?, ?, DATETIME('now', 'localtime'))
     ON CONFLICT(cache_key) DO UPDATE SET
       payload_json = excluded.payload_json,
       expires_at_epoch = excluded.expires_at_epoch,
       created_at = DATETIME('now', 'localtime')`,
    [key, JSON.stringify(payload), now + ttlSeconds]
  )
  await saveDatabase()
}

export async function getJsonCache(key) {
  const db = await getDatabase()
  const now = nowEpochSeconds()
  const result = db.exec(
    `SELECT payload_json FROM distributed_cache
     WHERE cache_key = ? AND expires_at_epoch > ?
     LIMIT 1`,
    [key, now]
  )
  const text = result[0]?.values?.[0]?.[0]
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
