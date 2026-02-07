import { getDatabase, saveDatabase } from '../database/init.js'
import { withLocks } from '../utils/locks.js'
import { formatProxyForLog, loadProxyList } from '../utils/proxy.js'
import { AccountSyncError, deleteAccountUser, fetchAccountUsersList, syncAccountInviteCount, syncAccountUserCount } from './account-sync.js'
import { sendOpenAccountsSweeperReportEmail } from './email-service.js'
import { getFeatureFlags, isFeatureEnabled } from '../utils/feature-flags.js'
import { SPACE_MEMBER_LIMIT } from '../utils/space-capacity.js'
import { upsertSystemConfigValue } from '../utils/system-config.js'

const DEFAULT_INTERVAL_HOURS = 1
const DEFAULT_MAX_JOINED = SPACE_MEMBER_LIMIT
const DEFAULT_CREATED_WITHIN_DAYS = 30

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const isOpenAccountsSweeperEnabled = () => {
  const raw = String(process.env.OPEN_ACCOUNTS_SWEEPER_ENABLED ?? 'true').trim().toLowerCase()
  return raw !== '0' && raw !== 'false' && raw !== 'off'
}

const isEnabledFlag = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === '') return Boolean(defaultValue)
  const raw = String(value).trim().toLowerCase()
  return raw !== '0' && raw !== 'false' && raw !== 'off'
}

const runOnStartup = () => isEnabledFlag(process.env.OPEN_ACCOUNTS_SWEEPER_RUN_ON_STARTUP, false)

// 间隔小时数，默认1小时
const intervalHours = () => Math.max(1, toInt(process.env.OPEN_ACCOUNTS_SWEEPER_INTERVAL_HOURS, DEFAULT_INTERVAL_HOURS))
const maxJoined = () => Math.max(0, toInt(process.env.OPEN_ACCOUNTS_MAX_JOINED, DEFAULT_MAX_JOINED))
const concurrency = () => Math.max(1, toInt(process.env.OPEN_ACCOUNTS_SWEEPER_CONCURRENCY, 3))
const createdWithinDays = () => Math.max(0, toInt(process.env.OPEN_ACCOUNTS_SWEEPER_CREATED_WITHIN_DAYS, DEFAULT_CREATED_WITHIN_DAYS))

const parseTime = (value) => {
  const time = Date.parse(String(value || ''))
  return Number.isFinite(time) ? time : 0
}

const SWEEPER_LAST_RUN_AT_KEY = 'open_accounts_sweeper_last_run_at'
const SWEEPER_LAST_SKIP_REASON_KEY = 'open_accounts_sweeper_last_skip_reason'
const SWEEPER_LAST_SKIP_AT_KEY = 'open_accounts_sweeper_last_skip_at'

const recordSweeperRun = async (timestamp) => {
  const db = await getDatabase()
  const value = timestamp instanceof Date ? timestamp.toISOString() : new Date().toISOString()
  upsertSystemConfigValue(db, SWEEPER_LAST_RUN_AT_KEY, value)
  saveDatabase()
}

const recordSweeperSkip = async (reason, timestamp) => {
  const db = await getDatabase()
  const value = timestamp instanceof Date ? timestamp.toISOString() : new Date().toISOString()
  upsertSystemConfigValue(db, SWEEPER_LAST_SKIP_REASON_KEY, reason)
  upsertSystemConfigValue(db, SWEEPER_LAST_SKIP_AT_KEY, value)
  saveDatabase()
}

const fetchAllStandardUsers = async (accountId, { proxy } = {}) => {
  const limit = 100
  let offset = 0
  let total = null
  const items = []

  while (total === null || items.length < total) {
    const page = await fetchAccountUsersList(accountId, { userListParams: { offset, limit, query: '' }, proxy })
    total = typeof page.total === 'number' ? page.total : items.length
    items.push(...(page.items || []))
    if (!page.items || page.items.length === 0) break
    offset += page.items.length
    if (offset > 2000) break
  }

  return {
    total: typeof total === 'number' ? total : items.length,
    items: (items || []).filter(item => String(item.role || '').toLowerCase() === 'standard-user')
  }
}

export const sortUsersByJoinTimeDesc = (users) => {
  return [...(users || [])].sort((a, b) => {
    const diff = parseTime(b.created_time) - parseTime(a.created_time)
    if (diff !== 0) return diff
    return String(b.id || '').localeCompare(String(a.id || ''))
  })
}

export const selectUsersToKick = ({ users, currentJoined, maxJoinedCount }) => {
  const overflow = Math.max(0, Number(currentJoined || 0) - Number(maxJoinedCount || 0))
  if (overflow <= 0) return []
  const sorted = sortUsersByJoinTimeDesc(users)
  return sorted.slice(0, overflow)
}

const enforceAccountCapacity = async (accountId, { maxJoinedCount, proxy } = {}) => {
  // Sync joined count first; the API's total is authoritative.
  const { account } = await syncAccountUserCount(accountId, { userListParams: { offset: 0, limit: 1, query: '' }, proxy })
  let joined = Number(account?.userCount || 0)
  const beforeJoined = joined

  if (joined <= maxJoinedCount) {
    // Still refresh invite count so card page stays reasonably up to date.
    await syncAccountInviteCount(accountId, { inviteListParams: { offset: 0, limit: 1, query: '' }, proxy })
    return { kicked: 0, joined, beforeJoined, kickedUsers: [], skippedUsers: [], failedUsers: [] }
  }

  let kicked = 0
  const kickedUsers = []
  const skippedUsers = []
  const failedUsers = []

  let attempt = 0
  while (joined > maxJoinedCount && attempt < 3) {
    const { items: candidates } = await fetchAllStandardUsers(accountId, { proxy })
    if (candidates.length === 0) {
      await syncAccountInviteCount(accountId, { inviteListParams: { offset: 0, limit: 1, query: '' }, proxy })
      return { kicked, joined, beforeJoined, reason: 'no_standard_users', kickedUsers, skippedUsers, failedUsers }
    }

    const toKick = selectUsersToKick({ users: candidates, currentJoined: joined, maxJoinedCount })
    if (toKick.length === 0) break

    for (const user of toKick) {
      if (joined <= maxJoinedCount) break
      try {
        const deleteResult = await deleteAccountUser(accountId, user.id, { userListParams: { offset: 0, limit: 1, query: '' }, proxy })
        const email = String(user.email || '').trim().toLowerCase()
        if (email) {
          const db = await getDatabase()
          db.run(
            `
              UPDATE linuxdo_users
              SET current_open_account_id = NULL,
                  current_open_account_email = NULL,
                  updated_at = DATETIME('now', 'localtime')
              WHERE current_open_account_id = ?
                AND (lower(email) = ? OR lower(current_open_account_email) = ?)
            `,
            [accountId, email, email]
          )
          saveDatabase()
        }
        kicked += 1
        joined = Number(deleteResult?.syncedUserCount || deleteResult?.account?.userCount || Math.max(0, joined - 1))
        kickedUsers.push({
          id: user.id,
          email: user.email,
          joinedAt: user.created_time || null
        })
      } catch (error) {
        const status = error instanceof AccountSyncError ? error.status : undefined
        if (status === 404) {
          skippedUsers.push({
            id: user.id,
            email: user.email,
            joinedAt: user.created_time || null,
            reason: 'not_found'
          })
          continue
        }
        failedUsers.push({
          id: user.id,
          email: user.email,
          joinedAt: user.created_time || null,
          status,
          message: error?.message || String(error)
        })
        console.warn('[OpenAccountsSweeper] kick failed', { accountId, userId: user?.id, status, message: error?.message || String(error) })
        break
      }
    }

    const refreshed = await syncAccountUserCount(accountId, { userListParams: { offset: 0, limit: 1, query: '' }, proxy })
    joined = Number(refreshed?.account?.userCount || joined)
    attempt += 1
  }

  if (joined <= maxJoinedCount) {
    await syncAccountInviteCount(accountId, { inviteListParams: { offset: 0, limit: 1, query: '' }, proxy })
    return { kicked, joined, beforeJoined, kickedUsers, skippedUsers, failedUsers }
  }

  const candidates = await fetchAllStandardUsers(accountId, { proxy })
  if ((candidates?.items || []).length === 0) {
    await syncAccountInviteCount(accountId, { inviteListParams: { offset: 0, limit: 1, query: '' }, proxy })
    return { kicked, joined, beforeJoined, reason: 'no_standard_users', kickedUsers, skippedUsers, failedUsers }
  }

  // Refresh counts for card page after kicking.
  const { account: updatedAccount } = await syncAccountUserCount(accountId, { userListParams: { offset: 0, limit: 1, query: '' }, proxy })
  await syncAccountInviteCount(accountId, { inviteListParams: { offset: 0, limit: 1, query: '' }, proxy })

  return { kicked, joined: Number(updatedAccount?.userCount || 0), beforeJoined, kickedUsers, skippedUsers, failedUsers }
}

export const startOpenAccountsOvercapacitySweeper = () => {
  if (!isOpenAccountsSweeperEnabled()) {
    console.log('[OpenAccountsSweeper] disabled', {
      OPEN_ACCOUNTS_SWEEPER_ENABLED: process.env.OPEN_ACCOUNTS_SWEEPER_ENABLED ?? 'true'
    })
    return () => {}
  }

  let running = false
  const runOnce = async () => {
    if (running) return
    running = true
    const startedAt = new Date()
    try {
      const features = await getFeatureFlags()
      if (!isFeatureEnabled(features, 'openAccounts')) {
        console.log('[OpenAccountsSweeper] skipped: feature disabled', { feature: 'openAccounts' })
        await recordSweeperSkip('feature_open_accounts_disabled', startedAt)
        return
      }

      await recordSweeperRun(startedAt)

      const db = await getDatabase()
	      const windowDays = createdWithinDays()
	      const result = windowDays > 0
	        ? db.exec(
	            `SELECT id, email FROM gpt_accounts WHERE is_open = 1 AND COALESCE(is_banned, 0) = 0 AND created_at >= DATETIME('now', 'localtime', ?)`,
	            [`-${windowDays} days`]
	          )
	        : db.exec('SELECT id, email FROM gpt_accounts WHERE is_open = 1 AND COALESCE(is_banned, 0) = 0')
      const accountRows = (result[0]?.values || [])
        .map(row => {
          const id = Number(row[0])
          const email = String(row[1] || '')
          const emailPrefix = email.split('@')[0] || ''
          return Number.isFinite(id) ? { id, emailPrefix } : null
        })
        .filter(Boolean)
      if (accountRows.length === 0) return

      const max = maxJoined()
      const workerCount = Math.min(concurrency(), accountRows.length)
      const queue = [...accountRows]
      const proxies = loadProxyList()
      let proxyCursor = 0
      const pickProxy = () => (proxies.length ? proxies[(proxyCursor++) % proxies.length] : null)
      const results = []
      const failures = []
      let totalKicked = 0

      const worker = async () => {
        while (queue.length > 0) {
          const item = queue.shift()
          if (!item) return
          const { id, emailPrefix } = item
          const proxyEntry = pickProxy()
          const proxy = proxyEntry?.url || null
          const proxyLabel = proxyEntry ? formatProxyForLog(proxyEntry.url) : null
          await withLocks([`acct:${id}`], async () => {
            try {
              const outcome = await enforceAccountCapacity(id, { maxJoinedCount: max, proxy })
              const kicked = Number(outcome?.kicked || 0)
              const joined = Number(outcome?.joined || 0)
              const beforeJoined = Number(outcome?.beforeJoined || joined)
              const didKick = kicked > 0
              totalKicked += kicked
              results.push({
                accountId: id,
                emailPrefix,
                beforeJoined,
                joined,
                didKick,
                kicked,
                kickedUsers: outcome?.kickedUsers || [],
                skippedUsers: outcome?.skippedUsers || [],
                failedUsers: outcome?.failedUsers || [],
                note: outcome?.reason === 'no_standard_users' ? '无可踢用户' : (kicked ? '超员已处理' : '')
              })
              if (kicked || (outcome?.failedUsers || []).length > 0) {
                console.log('[OpenAccountsSweeper] kicked', {
                  accountId: id,
                  beforeJoined,
                  afterJoined: joined,
                  maxJoined: max,
                  kicked,
                  kickedUsers: outcome?.kickedUsers || [],
                  failedUsers: outcome?.failedUsers || []
                })
              }
            } catch (error) {
              console.error('[OpenAccountsSweeper] sweep error', {
                accountId: id,
                proxy: proxyLabel,
                message: error?.message || String(error)
              })
              failures.push({ accountId: id, emailPrefix, error: error?.message || String(error) })
            }
          })
        }
      }

      await Promise.all(Array.from({ length: workerCount }, worker))

      const finishedAt = new Date()

      // 按邮箱名称排序
      results.sort((a, b) => (a.emailPrefix || '').localeCompare(b.emailPrefix || ''))
      failures.sort((a, b) => (a.emailPrefix || '').localeCompare(b.emailPrefix || ''))

      try {
        await sendOpenAccountsSweeperReportEmail({
          startedAt,
          finishedAt,
          maxJoined: max,
          scanCreatedWithinDays: windowDays,
          scannedCount: accountRows.length,
          totalKicked,
          results,
          failures
        })
      } catch (error) {
        console.warn('[OpenAccountsSweeper] send email failed', error?.message || error)
      }
    } finally {
      running = false
    }
  }

  // 计算下一个整点执行时间
  const getNextScheduledTime = () => {
    const now = new Date()
    const hours = intervalHours()
    // 计算下一个整点（基于间隔小时数）
    const currentHour = now.getHours()
    // 找到下一个符合间隔的整点小时
    const nextHour = Math.ceil((currentHour + 1) / hours) * hours
    const next = new Date(now)
    next.setHours(nextHour % 24, 0, 0, 0)
    // 如果计算出的时间已经过了，加一天
    if (next <= now) {
      next.setDate(next.getDate() + 1)
      next.setHours(0, 0, 0, 0)
    }
    return next
  }

  // 调度下一次执行
  let scheduledTimer = null
  const scheduleNext = () => {
    const nextTime = getNextScheduledTime()
    const delay = nextTime.getTime() - Date.now()
    console.log('[OpenAccountsSweeper] next run scheduled at', nextTime.toISOString(), `(in ${Math.round(delay / 1000 / 60)} minutes)`)
    scheduledTimer = setTimeout(async () => {
      await runOnce()
      scheduleNext()
    }, delay)
  }

  // 直接开始整点调度，不在启动时执行
  scheduleNext()

  if (runOnStartup()) {
    runOnce().catch(error => {
      console.warn('[OpenAccountsSweeper] startup run failed', error?.message || error)
    })
  }

  console.log('[OpenAccountsSweeper] started', {
    intervalHours: intervalHours(),
    maxJoined: maxJoined(),
    concurrency: concurrency(),
    runOnStartup: runOnStartup(),
    createdWithinDays: createdWithinDays()
  })

  return () => {
    if (scheduledTimer) clearTimeout(scheduledTimer)
  }
}
