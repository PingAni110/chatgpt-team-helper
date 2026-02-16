import { getDatabase, saveDatabase } from '../database/init.js'

export const HISTORY_EXCEPTION_STATUS = {
  ACTIVE: 'active',
  RESOLVED: 'resolved',
  IGNORED: 'ignored',
}

export const HISTORY_EXCEPTION_STATUS_SET = new Set(Object.values(HISTORY_EXCEPTION_STATUS))

const normalizeText = (value) => {
  const text = String(value ?? '').trim()
  return text || null
}

const normalizeAccountId = (value) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export const normalizeHistoryExceptionStatus = (value, fallback = HISTORY_EXCEPTION_STATUS.ACTIVE) => {
  const normalized = String(value ?? '').trim().toLowerCase()
  return HISTORY_EXCEPTION_STATUS_SET.has(normalized) ? normalized : fallback
}

export const buildHistoryExceptionPagination = ({ page, pageSize, total }) => {
  const safePage = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1
  const safePageSize = Number.isFinite(Number(pageSize)) ? Math.max(1, Number(pageSize)) : 20
  const safeTotal = Number.isFinite(Number(total)) ? Math.max(0, Number(total)) : 0
  return {
    page: safePage,
    pageSize: safePageSize,
    total: safeTotal,
    totalPages: Math.max(1, Math.ceil(safeTotal / safePageSize)),
  }
}

export const upsertAccountExceptionHistory = async (payload, options = {}) => {
  const db = options.db || (await getDatabase())
  const now = String(options.now || '').trim() || "DATETIME('now', 'localtime')"

  const accountId = normalizeAccountId(payload?.accountId)
  if (!accountId) {
    await enqueueAccountExceptionParseFailure(
      {
        source: payload?.source,
        reason: 'missing_account_id',
        rawPayload: payload,
      },
      { db }
    )
    const reason = '[HistoryException] upsert skipped: missing account_id'
    console.error(reason, payload)
    return { ok: false, reason: 'missing_account_id' }
  }

  const accountName = normalizeText(payload?.accountName)
  const exceptionType = normalizeText(payload?.exceptionType) || 'unknown'
  const exceptionCode = normalizeText(payload?.exceptionCode)
  const exceptionMessage = normalizeText(payload?.exceptionMessage)
  const source = normalizeText(payload?.source) || 'unknown'
  const status = normalizeHistoryExceptionStatus(payload?.status)

  db.run(
    `
      INSERT INTO account_exception_history (
        account_id,
        account_name,
        exception_type,
        exception_code,
        exception_message,
        source,
        first_seen_at,
        last_seen_at,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ${now}, ${now}, ?, ${now}, ${now})
      ON CONFLICT(account_id) DO UPDATE SET
        account_name = COALESCE(excluded.account_name, account_exception_history.account_name),
        exception_type = excluded.exception_type,
        exception_code = excluded.exception_code,
        exception_message = excluded.exception_message,
        source = excluded.source,
        last_seen_at = excluded.last_seen_at,
        status = excluded.status,
        updated_at = ${now}
    `,
    [accountId, accountName, exceptionType, exceptionCode, exceptionMessage, source, status]
  )

  if (!options.skipSave) {
    await saveDatabase()
  }

  return { ok: true, accountId }
}

export const enqueueAccountExceptionParseFailure = async (payload, options = {}) => {
  const db = options.db || (await getDatabase())
  const source = normalizeText(payload?.source) || 'unknown'
  const reason = normalizeText(payload?.reason) || 'unknown'
  const rawPayload = payload?.rawPayload ? JSON.stringify(payload.rawPayload) : null

  db.run(
    `
      INSERT INTO account_exception_parse_failures (
        source,
        reason,
        raw_payload,
        created_at
      ) VALUES (?, ?, ?, DATETIME('now', 'localtime'))
    `,
    [source, reason, rawPayload]
  )

  if (!options.skipSave) {
    await saveDatabase()
  }
}
