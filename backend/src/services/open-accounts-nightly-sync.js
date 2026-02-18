import { getDatabase } from '../database/init.js'
import { withLocks } from '../utils/locks.js'
import { syncAccountInviteCount, syncAccountUserCount, isWorkspaceExpiredSyncError } from './account-sync.js'
import { getWorkspaceExpiredReason, isTokenInvalidSyncError, markAccountSpaceStatus } from './account-space-status.js'

const DEFAULT_ENABLED = true
const DEFAULT_HOUR = 22
const DEFAULT_MINUTE = 0
const DEFAULT_RUN_ON_STARTUP = false
const DEFAULT_CONCURRENCY = 3
const MIN_CONCURRENCY = 1
const MAX_CONCURRENCY = 10
const DEFAULT_MAX_RETRIES = 3
const BASE_RETRY_DELAY_MS = 400

let schedulerTimer = null
let running = false

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return Boolean(fallback)
  const raw = String(value).trim().toLowerCase()
  return raw !== '0' && raw !== 'false' && raw !== 'off'
}

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const getNightlySyncConfig = () => {
  const hour = Math.min(23, Math.max(0, toInt(process.env.OPEN_ACCOUNTS_NIGHTLY_SYNC_HOUR, DEFAULT_HOUR)))
  const minute = Math.min(59, Math.max(0, toInt(process.env.OPEN_ACCOUNTS_NIGHTLY_SYNC_MINUTE, DEFAULT_MINUTE)))
  const concurrency = Math.min(
    MAX_CONCURRENCY,
    Math.max(MIN_CONCURRENCY, toInt(process.env.OPEN_ACCOUNTS_NIGHTLY_SYNC_CONCURRENCY, DEFAULT_CONCURRENCY))
  )

  return {
    enabled: toBoolean(process.env.OPEN_ACCOUNTS_NIGHTLY_SYNC_ENABLED, DEFAULT_ENABLED),
    hour,
    minute,
    runOnStartup: toBoolean(process.env.OPEN_ACCOUNTS_NIGHTLY_SYNC_RUN_ON_STARTUP, DEFAULT_RUN_ON_STARTUP),
    concurrency,
    maxRetries: DEFAULT_MAX_RETRIES
  }
}

export const calculateNextRunTime = (now = new Date(), { hour, minute } = {}) => {
  const next = new Date(now)
  next.setSeconds(0, 0)
  next.setHours(Number(hour ?? DEFAULT_HOUR), Number(minute ?? DEFAULT_MINUTE), 0, 0)
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1)
  }
  return next
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const isRetriableStatus = (status) => {
  const numericStatus = Number(status)
  if (!Number.isFinite(numericStatus)) return false
  if (numericStatus === 429 || numericStatus === 503) return true
  return numericStatus >= 500 && numericStatus < 600
}

const isRetriableError = (error) => {
  if (!error) return false
  if (isRetriableStatus(error?.status ?? error?.statusCode)) return true
  const code = String(error?.code || '').toUpperCase()
  return ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN'].includes(code)
}

const runWithRetry = async (fn, maxAttempts = DEFAULT_MAX_RETRIES) => {
  let lastError = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn(attempt)
    } catch (error) {
      lastError = error
      if (attempt >= maxAttempts || !isRetriableError(error)) {
        throw error
      }
      const delay = BASE_RETRY_DELAY_MS * (2 ** (attempt - 1))
      await sleep(delay)
    }
  }
  throw lastError || new Error('夜间同步重试失败')
}

export const listOpenAccountsForNightlySync = async () => {
  const db = await getDatabase()
  const result = db.exec(
    `
      SELECT id
      FROM gpt_accounts
      WHERE is_open = 1
        AND COALESCE(is_banned, 0) = 0
      ORDER BY COALESCE(sort_order, id) ASC, id ASC
    `
  )

  return (result[0]?.values || [])
    .map(row => Number(row[0]))
    .filter(id => Number.isFinite(id) && id > 0)
}

export const syncSingleOpenAccount = async (accountId) => {
  return withLocks([`gpt-account:${accountId}`], async () => {
    const userSync = await runWithRetry(
      () => syncAccountUserCount(accountId, { userListParams: { offset: 0, limit: 1, query: '' } })
    )
    const inviteSync = await runWithRetry(
      () => syncAccountInviteCount(accountId, {
        accountRecord: userSync.account,
        inviteListParams: { offset: 0, limit: 1, query: '' }
      })
    )
    await markAccountSpaceStatus(accountId, { code: 'normal', reason: '正常' })
    return {
      ok: true,
      accountId,
      syncedUserCount: userSync.syncedUserCount,
      inviteCount: inviteSync.inviteCount,
      account: inviteSync.account
    }
  })
}

export const processAccountsWithConcurrency = async (accountIds, worker, concurrency) => {
  const list = Array.isArray(accountIds) ? accountIds : []
  const workerFn = typeof worker === 'function' ? worker : async (id) => ({ id, ok: true })
  const normalizedConcurrency = Math.max(1, Number(concurrency) || 1)

  const results = new Array(list.length)
  let cursor = 0

  const runWorker = async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= list.length) return
      const accountId = list[index]
      try {
        results[index] = await workerFn(accountId)
      } catch (error) {
        results[index] = { ok: false, accountId, error }
      }
    }
  }

  const threads = Array.from({ length: Math.min(normalizedConcurrency, list.length || 1) }, () => runWorker())
  await Promise.all(threads)
  return results
}

export const runOpenAccountsNightlySyncOnce = async (options = {}) => {
  const config = { ...getNightlySyncConfig(), ...options }
  const listAccounts = typeof options.listAccounts === 'function' ? options.listAccounts : listOpenAccountsForNightlySync
  const syncAccount = typeof options.syncAccount === 'function' ? options.syncAccount : syncSingleOpenAccount
  const onAccountError = typeof options.onAccountError === 'function' ? options.onAccountError : null
  const startedAt = new Date()
  const accountIds = await listAccounts()

  const summary = {
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    total: accountIds.length,
    success: 0,
    failed: 0,
    elapsedMs: 0,
    failures: []
  }

  const results = await processAccountsWithConcurrency(
    accountIds,
    async (accountId) => {
      try {
        return await syncAccount(accountId)
      } catch (error) {
        if (onAccountError) {
          await onAccountError(accountId, error)
          throw error
        }
        if (isTokenInvalidSyncError(error)) {
          await markAccountSpaceStatus(accountId, { code: 'abnormal', reason: 'Token 已过期或无效，请更新账号 token' })
        }
        if (isWorkspaceExpiredSyncError(error)) {
          await markAccountSpaceStatus(accountId, { code: 'abnormal', reason: getWorkspaceExpiredReason() })
        }
        throw error
      }
    },
    config.concurrency
  )

  for (const item of results) {
    if (item?.ok) {
      summary.success += 1
      continue
    }
    summary.failed += 1
    summary.failures.push({
      accountId: item?.accountId ?? null,
      message: item?.error?.message || String(item?.error || '同步失败'),
      code: item?.error?.code || null,
      status: item?.error?.status ?? item?.error?.statusCode ?? null
    })
  }

  const finishedAt = new Date()
  summary.finishedAt = finishedAt.toISOString()
  summary.elapsedMs = finishedAt.getTime() - startedAt.getTime()
  return summary
}

const scheduleNextRun = () => {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer)
    schedulerTimer = null
  }

  const config = getNightlySyncConfig()
  const now = new Date()
  const nextRunAt = calculateNextRunTime(now, config)
  const delayMs = Math.max(1000, nextRunAt.getTime() - now.getTime())

  console.log('[OpenAccountsNightlySync] 已调度下次执行', {
    now: now.toISOString(),
    nextRunAt: nextRunAt.toISOString(),
    delayMs,
    concurrency: config.concurrency
  })

  schedulerTimer = setTimeout(async () => {
    await triggerNightlySyncTask('scheduled')
    scheduleNextRun()
  }, delayMs)
}

export const triggerNightlySyncTask = async (trigger = 'manual') => {
  if (running) {
    console.warn('[OpenAccountsNightlySync] 跳过执行，任务仍在运行中', { trigger })
    return { skipped: true, reason: 'running' }
  }

  running = true
  const startedAt = new Date()
  console.log('[OpenAccountsNightlySync] 任务开始', { trigger, startedAt: startedAt.toISOString() })

  try {
    const summary = await runOpenAccountsNightlySyncOnce()
    console.log('[OpenAccountsNightlySync] 任务结束', {
      trigger,
      startedAt: summary.startedAt,
      finishedAt: summary.finishedAt,
      total: summary.total,
      success: summary.success,
      failed: summary.failed,
      elapsedMs: summary.elapsedMs
    })
    if (summary.failures.length > 0) {
      console.warn('[OpenAccountsNightlySync] 失败账号明细', { failures: summary.failures })
    }
    return summary
  } catch (error) {
    const finishedAt = new Date()
    console.error('[OpenAccountsNightlySync] 任务异常结束', {
      trigger,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      elapsedMs: finishedAt.getTime() - startedAt.getTime(),
      message: error?.message || String(error)
    })
    throw error
  } finally {
    running = false
  }
}

export const startOpenAccountsNightlySyncScheduler = () => {
  const config = getNightlySyncConfig()
  if (!config.enabled) {
    console.log('[OpenAccountsNightlySync] 已禁用，跳过启动')
    return
  }

  if (config.runOnStartup) {
    triggerNightlySyncTask('startup').catch(error => {
      console.error('[OpenAccountsNightlySync] 启动立即执行失败', error)
    })
  }

  scheduleNextRun()
}

export const __nightlySyncInternals = {
  isRetriableError,
  runWithRetry,
  setRunning(value) {
    running = Boolean(value)
  },
  isRunning() {
    return running
  }
}
