import { getDatabase, saveDatabase } from '../database/init.js'
import { SPACE_MEMBER_LIMIT } from '../utils/space-capacity.js'

export const resolveSpaceStatus = (account) => {
  const statusCode = String(account?.spaceStatusCode || account?.space_status_code || '').trim().toLowerCase()
  const statusReason = String(account?.spaceStatusReason || account?.space_status_reason || '').trim()
  if (statusCode === 'abnormal') {
    return { code: 'abnormal', reason: statusReason || '空间异常' }
  }
  if (statusCode === 'unknown') {
    return { code: 'unknown', reason: statusReason || '状态待确认' }
  }
  if (statusCode === 'normal') {
    return { code: 'normal', reason: statusReason || '正常' }
  }

  if (Boolean(account?.isBanned)) {
    return { code: 'abnormal', reason: '账号被封' }
  }

  const token = String(account?.token || '').trim()
  if (!token) {
    return { code: 'abnormal', reason: 'Token 失效' }
  }

  const userCount = Number(account?.userCount ?? account?.user_count ?? 0)
  if (Number.isFinite(userCount) && userCount > SPACE_MEMBER_LIMIT) {
    return { code: 'abnormal', reason: `超员（${userCount}/${SPACE_MEMBER_LIMIT}）` }
  }

  return { code: 'unknown', reason: statusReason || '状态待确认' }
}

export const getWorkspaceExpiredReason = () => '到期'

export const isTokenInvalidSyncError = (error) => {
  const status = Number(error?.status ?? error?.statusCode ?? 0)
  const message = String(error?.message || '').toLowerCase()
  if (status === 401 || status === 403) return true
  return /token.*(过期|无效|invalid|expired)|unauthorized|invalid token/.test(message)
}

export const markAccountSpaceStatus = async (accountId, { code, reason = '' } = {}, options = {}) => {
  const normalizedAccountId = Number(accountId)
  if (!Number.isFinite(normalizedAccountId) || normalizedAccountId <= 0) {
    return false
  }

  const normalizedInputCode = String(code || '').trim().toLowerCase()
  const normalizedCode = ['normal', 'abnormal', 'unknown'].includes(normalizedInputCode) ? normalizedInputCode : 'unknown'
  const normalizedReason = String(reason || '').trim()

  const db = options.db || await getDatabase()
  try {
    db.run(
      `
        UPDATE gpt_accounts
        SET space_status_code = ?,
            space_status_reason = ?,
            updated_at = DATETIME('now', 'localtime')
        WHERE id = ?
      `,
      [normalizedCode, normalizedReason || null, normalizedAccountId]
    )
    if (!options.skipSaveDatabase) {
      saveDatabase()
    }
    return true
  } catch (error) {
    console.warn('[AccountSpaceStatus] skip space status update (legacy schema):', error?.message || error)
    return false
  }
}
