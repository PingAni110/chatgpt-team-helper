import express from 'express'
import axios from 'axios'
import { getDatabase, saveDatabase } from '../database/init.js'
import { authenticateToken } from '../middleware/auth.js'
import { apiKeyAuth } from '../middleware/api-key-auth.js'
import { requireMenu } from '../middleware/rbac.js'
import { syncAccountUserCount, syncAccountInviteCount, fetchOpenAiAccountInfo, AccountSyncError, deleteAccountUser, inviteAccountUser, deleteAccountInvite } from '../services/account-sync.js'
import { SPACE_MEMBER_LIMIT, calcRedeemableSlots, normalizeMemberCount } from '../utils/space-capacity.js'
import { SPACE_TYPE_CHILD, normalizeSpaceType, shouldAutoGenerateCodes } from '../utils/space-type.js'
import { withLocks } from '../utils/locks.js'

const router = express.Router()
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase()

const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return null
  }
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return null
  if (['1', 'true', 'yes'].includes(raw)) return true
  if (['0', 'false', 'no'].includes(raw)) return false
  return null
}

const EXPIRE_AT_REGEX = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/

const formatExpireAt = (date) => {
  const pad = (value) => String(value).padStart(2, '0')
  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(date)
    const get = (type) => parts.find(p => p.type === type)?.value || ''
    return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
  } catch {
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }
}

const normalizeExpireAt = (value) => {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  if (EXPIRE_AT_REGEX.test(raw)) return raw

  // 支持 YYYY-MM-DD HH:mm:ss 或 YYYY/MM/DDTHH:mm:ss 格式
  const match = raw.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (match) {
    const seconds = match[6] || '00'
    return `${match[1]}/${match[2]}/${match[3]} ${match[4]}:${match[5]}:${seconds}`
  }

  const asNumber = Number(raw)
  if (Number.isFinite(asNumber) && asNumber > 0) {
    const date = new Date(asNumber)
    if (!Number.isNaN(date.getTime())) {
      return formatExpireAt(date)
    }
  }

  return null
}

const normalizeShanghaiDateTime = (value) => {
  const normalized = normalizeExpireAt(value)
  if (normalized) return normalized
  return null
}

const normalizeSpaceTypeInput = (value, fallback = null) => normalizeSpaceType(value, fallback)

const resolveSpaceStatus = (account) => {
  const statusCode = String(account?.spaceStatusCode || account?.space_status_code || '').trim().toLowerCase()
  const statusReason = String(account?.spaceStatusReason || account?.space_status_reason || '').trim()
  if (statusCode === 'abnormal') {
    return { code: 'abnormal', reason: statusReason || '空间异常' }
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

  return { code: 'normal', reason: statusReason || '正常' }
}

const isTokenInvalidSyncError = (error) => {
  const status = Number(error?.status ?? error?.statusCode ?? 0)
  const message = String(error?.message || '').toLowerCase()
  if (status === 401 || status === 403) return true
  return /token.*(过期|无效|invalid|expired)|unauthorized|invalid token/.test(message)
}

const markAccountSpaceStatus = async (db, accountId, { code, reason = '' } = {}) => {
  const normalizedCode = String(code || '').trim().toLowerCase() === 'abnormal' ? 'abnormal' : 'normal'
  const normalizedReason = String(reason || '').trim()
  try {
    db.run(
      `
        UPDATE gpt_accounts
        SET space_status_code = ?,
            space_status_reason = ?,
            updated_at = DATETIME('now', 'localtime')
        WHERE id = ?
      `,
      [normalizedCode, normalizedReason || null, accountId]
    )
    saveDatabase()
  } catch (error) {
    console.warn('[GptAccounts] skip space status update (legacy schema):', error?.message || error)
  }
}

const collectEmails = (payload) => {
  if (!payload) return []
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload.emails)) return payload.emails
  if (typeof payload.emails === 'string') return [payload.emails]
  if (typeof payload.email === 'string') return [payload.email]
  return []
}

// 使用系统设置中的 API 密钥（x-api-key）标记账号为“封号”
router.post('/ban', apiKeyAuth, async (req, res) => {
  try {
    const rawEmails = collectEmails(req.body)
    const emails = [...new Set(rawEmails.map(normalizeEmail).filter(Boolean))]

    if (emails.length === 0) {
      return res.status(400).json({ error: 'emails is required' })
    }
    if (emails.length > 500) {
      return res.status(400).json({ error: 'emails is too large (max 500)' })
    }

    const db = await getDatabase()
    const placeholders = emails.map(() => '?').join(',')

    const existing = db.exec(
      `
        SELECT id, email
        FROM gpt_accounts
        WHERE LOWER(email) IN (${placeholders})
      `,
      emails
    )

    const matched = (existing[0]?.values || [])
      .map(row => ({
        id: Number(row[0]),
        email: String(row[1] || '')
      }))
      .filter(item => Number.isFinite(item.id) && item.email)

    const matchedSet = new Set(matched.map(item => normalizeEmail(item.email)))
    const notFound = emails.filter(email => !matchedSet.has(email))

    if (matched.length > 0) {
      db.run(
        `
          UPDATE gpt_accounts
          SET is_open = 0,
              is_banned = 1,
              updated_at = DATETIME('now', 'localtime')
          WHERE LOWER(email) IN (${placeholders})
        `,
        emails
      )
      saveDatabase()
    }

    return res.json({
      message: 'ok',
      updated: matched.length,
      matched,
      notFound
    })
  } catch (error) {
    console.error('Ban GPT accounts by email error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.use(authenticateToken, requireMenu('accounts'))

// 校验 access token，并返回可用的 Team 账号列表（用于新建账号时选择 chatgptAccountId）
router.post('/check-token', async (req, res) => {
  try {
    const { token, proxy } = req.body || {}
    const normalizedToken = String(token ?? '').trim()
    if (!normalizedToken) {
      return res.status(400).json({ error: 'token is required' })
    }

    const accounts = await fetchOpenAiAccountInfo(normalizedToken, proxy ?? null)
    return res.json({ accounts })
  } catch (error) {
    console.error('Check GPT token error:', error)

    if (error instanceof AccountSyncError || error?.status) {
      return res.status(error.status || 500).json({ error: error.message })
    }

    return res.status(500).json({ error: '内部服务器错误' })
  }
})

// 获取账号列表（支持分页、搜索、筛选）
router.get('/', async (req, res) => {
  try {
    const db = await getDatabase()
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10))
    const search = (req.query.search || '').trim().toLowerCase()
    const openStatus = req.query.openStatus // 'open' | 'closed' | undefined
    const rawSpaceType = req.query.spaceType ?? req.query.space_type
    const hasSpaceType = rawSpaceType != null && String(rawSpaceType).trim() !== ''
    const normalizedSpaceType = hasSpaceType ? normalizeSpaceTypeInput(rawSpaceType, null) : null
    if (hasSpaceType && !normalizedSpaceType) {
      return res.status(400).json({ error: 'Invalid spaceType' })
    }

    // 构建 WHERE 条件
    const conditions = []
    const params = []

    if (search) {
      conditions.push(`(LOWER(email) LIKE ? OR LOWER(token) LIKE ? OR LOWER(refresh_token) LIKE ? OR LOWER(chatgpt_account_id) LIKE ?)`)
      const searchPattern = `%${search}%`
      params.push(searchPattern, searchPattern, searchPattern, searchPattern)
    }

    if (openStatus === 'open') {
      conditions.push('is_open = 1')
    } else if (openStatus === 'closed') {
      conditions.push('(is_open = 0 OR is_open IS NULL)')
    }
    if (normalizedSpaceType) {
      conditions.push(`COALESCE(space_type, '${SPACE_TYPE_CHILD}') = ?`)
      params.push(normalizedSpaceType)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // 查询总数
    const countResult = db.exec(`SELECT COUNT(*) FROM gpt_accounts ${whereClause}`, params)
    const total = countResult[0]?.values?.[0]?.[0] || 0

	    // 查询分页数据
	    const offset = (page - 1) * pageSize
    let dataResult
    try {
      dataResult = db.exec(`
        SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, is_open,
               COALESCE(is_demoted, 0) AS is_demoted,
               COALESCE(is_banned, 0) AS is_banned,
               COALESCE(sort_order, id) AS sort_order,
               COALESCE(space_type, '${SPACE_TYPE_CHILD}') AS space_type,
               COALESCE(space_status_code, 'normal') AS space_status_code,
               space_status_reason,
               created_at, updated_at
        FROM gpt_accounts
        ${whereClause}
        ORDER BY COALESCE(sort_order, id) ASC, created_at DESC
        LIMIT ? OFFSET ?
      `, [...params, pageSize, offset])
    } catch (error) {
      console.warn('[GptAccounts] fallback list query (legacy schema):', error?.message || error)
      dataResult = db.exec(`
        SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, is_open,
               COALESCE(is_demoted, 0) AS is_demoted,
               COALESCE(is_banned, 0) AS is_banned,
               COALESCE(sort_order, id) AS sort_order,
               created_at, updated_at
        FROM gpt_accounts
        ${whereClause}
        ORDER BY COALESCE(sort_order, id) ASC, created_at DESC
        LIMIT ? OFFSET ?
      `, [...params, pageSize, offset])
    }

    const accounts = (dataResult[0]?.values || []).map(row => {
      const hasStatusColumns = row.length >= 18
      const spaceType = hasStatusColumns ? (row[13] || SPACE_TYPE_CHILD) : SPACE_TYPE_CHILD
      const spaceStatusCode = hasStatusColumns ? (row[14] || 'normal') : 'normal'
      const spaceStatusReason = hasStatusColumns ? (row[15] || '') : ''
      const createdAt = hasStatusColumns ? row[16] : row[13]
      const updatedAt = hasStatusColumns ? row[17] : row[14]

      return {
        id: row[0],
        email: row[1],
        token: row[2],
        refreshToken: row[3],
        userCount: row[4],
        inviteCount: row[5],
        chatgptAccountId: row[6],
        oaiDeviceId: row[7],
        expireAt: row[8] || null,
        isOpen: Boolean(row[9]),
        isDemoted: Boolean(row[10]),
        isBanned: Boolean(row[11]),
        sortOrder: Number(row[12] || 0),
        spaceType,
        spaceStatusCode,
        spaceStatusReason,
        createdAt,
        updatedAt,
        spaceStatus: resolveSpaceStatus({
          isBanned: Boolean(row[11]),
          token: row[2],
          spaceStatusCode,
          spaceStatusReason
        })
      }
    })

    res.json({
      accounts,
      pagination: { page, pageSize, total }
    })
  } catch (error) {
    console.error('Get GPT accounts error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get a single GPT account
router.get('/:id', async (req, res) => {
  try {
	    const db = await getDatabase()
	    const result = db.exec(`
	      SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, is_open,
	             COALESCE(is_demoted, 0) AS is_demoted,
	             COALESCE(is_banned, 0) AS is_banned,
	             COALESCE(space_type, '${SPACE_TYPE_CHILD}') AS space_type,
	             created_at, updated_at
	      FROM gpt_accounts
	      WHERE id = ?
	    `, [req.params.id])

    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: 'Account not found' })
    }

    const row = result[0].values[0]
	    const account = {
	      id: row[0],
	      email: row[1],
	      token: row[2],
	      refreshToken: row[3],
	      userCount: row[4],
		      inviteCount: row[5],
		      chatgptAccountId: row[6],
		      oaiDeviceId: row[7],
		      expireAt: row[8] || null,
		      isOpen: Boolean(row[9]),
		      isDemoted: Boolean(row[10]),
		      isBanned: Boolean(row[11]),
          spaceType: row[12] || SPACE_TYPE_CHILD,
		      createdAt: row[13],
		      updatedAt: row[14]
	    }

    res.json(account)
  } catch (error) {
    console.error('Get GPT account error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create a new GPT account
router.post('/', async (req, res) => {
  try {
    const body = req.body || {}
    const { email, token, refreshToken, userCount, chatgptAccountId, oaiDeviceId, expireAt } = body

    const hasIsDemoted = Object.prototype.hasOwnProperty.call(body, 'isDemoted') || Object.prototype.hasOwnProperty.call(body, 'is_demoted')
    const isDemotedInput = Object.prototype.hasOwnProperty.call(body, 'isDemoted') ? body.isDemoted : body.is_demoted
    const normalizedIsDemoted = hasIsDemoted ? normalizeBoolean(isDemotedInput) : null
    if (hasIsDemoted && normalizedIsDemoted === null) {
      return res.status(400).json({ error: 'Invalid isDemoted format' })
    }
    const isDemotedValue = normalizedIsDemoted ? 1 : 0

    const hasIsBanned = Object.prototype.hasOwnProperty.call(body, 'isBanned') || Object.prototype.hasOwnProperty.call(body, 'is_banned')
    const isBannedInput = Object.prototype.hasOwnProperty.call(body, 'isBanned') ? body.isBanned : body.is_banned
    const normalizedIsBanned = hasIsBanned ? normalizeBoolean(isBannedInput) : null
    if (hasIsBanned && normalizedIsBanned === null) {
      return res.status(400).json({ error: 'Invalid isBanned format' })
    }
    const isBannedValue = normalizedIsBanned ? 1 : 0

    const normalizedChatgptAccountId = String(chatgptAccountId ?? '').trim()
    const normalizedOaiDeviceId = String(oaiDeviceId ?? '').trim()
    const normalizedExpireAt = normalizeShanghaiDateTime(expireAt)

    const hasSpaceType = Object.prototype.hasOwnProperty.call(body, 'spaceType') || Object.prototype.hasOwnProperty.call(body, 'space_type')
    const spaceTypeInput = Object.prototype.hasOwnProperty.call(body, 'spaceType') ? body.spaceType : body.space_type
    const normalizedSpaceType = hasSpaceType ? normalizeSpaceTypeInput(spaceTypeInput, null) : null
    if (hasSpaceType && !normalizedSpaceType) {
      return res.status(400).json({ error: 'Invalid spaceType' })
    }
    const spaceTypeValue = normalizedSpaceType || SPACE_TYPE_CHILD

    if (!email || !token || !normalizedChatgptAccountId) {
      return res.status(400).json({ error: 'Email, token and ChatGPT ID are required' })
    }

    if (expireAt != null && String(expireAt).trim() && !normalizedExpireAt) {
      return res.status(400).json({
        error: 'Invalid expireAt format',
        message: 'expireAt 格式错误，请使用 YYYY/MM/DD HH:mm'
      })
    }

    const normalizedEmail = normalizeEmail(email)

    const db = await getDatabase()

    // 账号初始人数默认 1；空间固定上限 5 人
    const finalUserCount = normalizeMemberCount(userCount !== undefined ? userCount : 1)
    if (finalUserCount > SPACE_MEMBER_LIMIT) {
      return res.status(400).json({ error: `空间人数不能超过 ${SPACE_MEMBER_LIMIT} 人` })
    }

    db.run(
      `INSERT INTO gpt_accounts (email, token, refresh_token, user_count, chatgpt_account_id, oai_device_id, expire_at, is_demoted, is_banned, space_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATETIME('now', 'localtime'), DATETIME('now', 'localtime'))`,
      [normalizedEmail, token, refreshToken || null, finalUserCount, normalizedChatgptAccountId, normalizedOaiDeviceId || null, normalizedExpireAt, isDemotedValue, isBannedValue, spaceTypeValue]
    )

		    // 获取新创建账号的ID
		    const accountResult = db.exec(`
		      SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, is_open,
		             COALESCE(is_demoted, 0) AS is_demoted,
		             COALESCE(is_banned, 0) AS is_banned,
		             COALESCE(space_type, '${SPACE_TYPE_CHILD}') AS space_type,
		             created_at, updated_at
		      FROM gpt_accounts
		      WHERE id = last_insert_rowid()
		    `)
    const row = accountResult[0].values[0]
	    const account = {
	      id: row[0],
	      email: row[1],
	      token: row[2],
	      refreshToken: row[3],
	      userCount: row[4],
		      inviteCount: row[5],
		      chatgptAccountId: row[6],
		      oaiDeviceId: row[7],
		      expireAt: row[8] || null,
		      isOpen: Boolean(row[9]),
		      isDemoted: Boolean(row[10]),
		      isBanned: Boolean(row[11]),
          spaceType: row[12] || SPACE_TYPE_CHILD,
		      createdAt: row[13],
		      updatedAt: row[14]
		    }

    // 生成随机兑换码的辅助函数
    function generateRedemptionCode(length = 12) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 排除容易混淆的字符
      let code = ''
      for (let i = 0; i < length; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length))
        // 每4位添加一个分隔符
        if ((i + 1) % 4 === 0 && i < length - 1) {
          code += '-'
        }
      }
      return code
    }

    // 自动生成兑换码并绑定到该账号。
    // 策略：人数已满(>=5)时不生成兑换码，与现有“满员不可继续上车/不可继续发码”的逻辑保持一致。
    const shouldGenerateCodes = shouldAutoGenerateCodes(spaceTypeValue)
    if (!shouldGenerateCodes) {
      console.info('[GptAccounts] skip auto redemption codes for mother space', {
        email: normalizedEmail,
        spaceType: spaceTypeValue
      })
    }

    const syncResult = await syncAccountUserCount(account.id, {
      accountRecord: {
        ...account,
        chatgptAccountId: normalizedChatgptAccountId,
        token,
        oaiDeviceId: normalizedOaiDeviceId || null
      },
      userListParams: { offset: 0, limit: 1, query: '' }
    })
    const joinedCount = Number(syncResult?.syncedUserCount ?? finalUserCount)
    const codesToGenerate = shouldGenerateCodes ? calcRedeemableSlots(joinedCount, SPACE_MEMBER_LIMIT) : 0

    const generatedCodes = []
    await withLocks([`redeem:${account.id}`], async () => {
      for (let i = 0; i < codesToGenerate; i++) {
        let code = generateRedemptionCode()
        let attempts = 0
        let success = false

        // 尝试生成唯一的兑换码（最多重试5次）
        while (attempts < 5 && !success) {
          try {
            db.run(
              `INSERT INTO redemption_codes (code, account_email, created_at, updated_at) VALUES (?, ?, DATETIME('now', 'localtime'), DATETIME('now', 'localtime'))`,
              [code, normalizedEmail]
            )
            generatedCodes.push(code)
            success = true
          } catch (err) {
            if (err.message.includes('UNIQUE')) {
              // 如果重复，重新生成
              code = generateRedemptionCode()
              attempts++
            } else {
              throw err
            }
          }
        }
      }
    })

    console.info('[GptAccounts] auto redemption summary', {
      accountId: account.id,
      joinedCount,
      capacity: SPACE_MEMBER_LIMIT,
      need: codesToGenerate,
      generated: generatedCodes.length
    })

    saveDatabase()

    // 获取生成的兑换码信息
    const codesResult = db.exec(
      `
        SELECT code FROM redemption_codes
        WHERE account_email = ?
        ORDER BY created_at DESC
      `,
      [normalizedEmail]
    )

    const codes = codesResult[0]?.values.map(row => row[0]) || []
    const autoGenerateMessage = shouldGenerateCodes
      ? `账号创建成功，已自动生成${generatedCodes.length}个兑换码`
      : '账号创建成功，母号空间已跳过自动生成兑换码'

    res.status(201).json({
      account,
      generatedCodes: codes,
      message: autoGenerateMessage
    })
  } catch (error) {
    console.error('Create GPT account error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update a GPT account
router.put('/:id', async (req, res) => {
  try {
    const body = req.body || {}
    const { email, token, refreshToken, userCount, chatgptAccountId, oaiDeviceId, expireAt } = body

    const normalizedChatgptAccountId = String(chatgptAccountId ?? '').trim()
    const normalizedOaiDeviceId = String(oaiDeviceId ?? '').trim()
    const hasExpireAt = Object.prototype.hasOwnProperty.call(body, 'expireAt')
    const normalizedExpireAt = hasExpireAt ? normalizeExpireAt(expireAt) : null

    const hasSpaceType = Object.prototype.hasOwnProperty.call(body, 'spaceType') || Object.prototype.hasOwnProperty.call(body, 'space_type')
    const spaceTypeInput = Object.prototype.hasOwnProperty.call(body, 'spaceType') ? body.spaceType : body.space_type
    const normalizedSpaceType = hasSpaceType ? normalizeSpaceTypeInput(spaceTypeInput, null) : null
    if (hasSpaceType && !normalizedSpaceType) {
      return res.status(400).json({ error: 'Invalid spaceType' })
    }

    const hasIsDemoted = Object.prototype.hasOwnProperty.call(body, 'isDemoted') || Object.prototype.hasOwnProperty.call(body, 'is_demoted')
    const isDemotedInput = Object.prototype.hasOwnProperty.call(body, 'isDemoted') ? body.isDemoted : body.is_demoted
    const normalizedIsDemoted = hasIsDemoted ? normalizeBoolean(isDemotedInput) : null
    if (hasIsDemoted && normalizedIsDemoted === null) {
      return res.status(400).json({ error: 'Invalid isDemoted format' })
    }
    const shouldUpdateIsDemoted = hasIsDemoted
    const isDemotedValue = normalizedIsDemoted ? 1 : 0

    const hasIsBanned = Object.prototype.hasOwnProperty.call(body, 'isBanned') || Object.prototype.hasOwnProperty.call(body, 'is_banned')
    const isBannedInput = Object.prototype.hasOwnProperty.call(body, 'isBanned') ? body.isBanned : body.is_banned
    const normalizedIsBanned = hasIsBanned ? normalizeBoolean(isBannedInput) : null
    if (hasIsBanned && normalizedIsBanned === null) {
      return res.status(400).json({ error: 'Invalid isBanned format' })
    }
    const shouldUpdateIsBanned = hasIsBanned
    const isBannedValue = normalizedIsBanned ? 1 : 0
    const shouldApplyBanSideEffects = shouldUpdateIsBanned && isBannedValue === 1

    if (!email || !token || !normalizedChatgptAccountId) {
      return res.status(400).json({ error: 'Email, token and ChatGPT ID are required' })
    }

    if (hasExpireAt && expireAt != null && String(expireAt).trim() && !normalizedExpireAt) {
      return res.status(400).json({
        error: 'Invalid expireAt format',
        message: 'expireAt 格式错误，请使用 YYYY/MM/DD HH:mm'
      })
    }

    const db = await getDatabase()

    // Check if account exists
    const checkResult = db.exec('SELECT id, email FROM gpt_accounts WHERE id = ?', [req.params.id])
    if (checkResult.length === 0 || checkResult[0].values.length === 0) {
      return res.status(404).json({ error: 'Account not found' })
    }

    const existingEmail = checkResult[0].values[0][1]

    const normalizedUserCount = normalizeMemberCount(userCount)
    if (normalizedUserCount > SPACE_MEMBER_LIMIT) {
      return res.status(400).json({ error: `空间人数不能超过 ${SPACE_MEMBER_LIMIT} 人` })
    }

    db.run(
      `UPDATE gpt_accounts
       SET email = ?,
           token = ?,
           refresh_token = ?,
           user_count = ?,
           chatgpt_account_id = ?,
           oai_device_id = ?,
           expire_at = CASE WHEN ? = 1 THEN ? ELSE expire_at END,
           space_type = CASE WHEN ? = 1 THEN ? ELSE space_type END,
           is_demoted = CASE WHEN ? = 1 THEN ? ELSE is_demoted END,
           is_banned = CASE WHEN ? = 1 THEN ? ELSE is_banned END,
           is_open = CASE WHEN ? = 1 THEN 0 ELSE is_open END,
           ban_processed = CASE WHEN ? = 1 THEN 0 ELSE ban_processed END,
           updated_at = DATETIME('now', 'localtime')
       WHERE id = ?`,
      [
        email,
        token,
        refreshToken || null,
        normalizedUserCount,
        normalizedChatgptAccountId,
        normalizedOaiDeviceId || null,
        hasExpireAt ? 1 : 0,
        normalizedExpireAt,
        hasSpaceType ? 1 : 0,
        normalizedSpaceType || SPACE_TYPE_CHILD,
        shouldUpdateIsDemoted ? 1 : 0,
        isDemotedValue,
        shouldUpdateIsBanned ? 1 : 0,
        isBannedValue,
        shouldApplyBanSideEffects ? 1 : 0,
        shouldApplyBanSideEffects ? 1 : 0,
        req.params.id
      ]
    )

    if (existingEmail && existingEmail !== email) {
      db.run(
        `UPDATE redemption_codes SET account_email = ?, updated_at = DATETIME('now', 'localtime') WHERE account_email = ?`,
        [email, existingEmail]
      )
    }
    saveDatabase()

		    // Get the updated account
		    const result = db.exec(`
		      SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, is_open,
		             COALESCE(is_demoted, 0) AS is_demoted,
		             COALESCE(is_banned, 0) AS is_banned,
		             COALESCE(space_type, '${SPACE_TYPE_CHILD}') AS space_type,
		             created_at, updated_at
		      FROM gpt_accounts
		      WHERE id = ?
		    `, [req.params.id])
    const row = result[0].values[0]
	    const account = {
	      id: row[0],
	      email: row[1],
	      token: row[2],
	      refreshToken: row[3],
	      userCount: row[4],
		      inviteCount: row[5],
		      chatgptAccountId: row[6],
		      oaiDeviceId: row[7],
		      expireAt: row[8] || null,
		      isOpen: Boolean(row[9]),
		      isDemoted: Boolean(row[10]),
		      isBanned: Boolean(row[11]),
          spaceType: row[12] || SPACE_TYPE_CHILD,
		      createdAt: row[13],
		      updatedAt: row[14]
		    }

    res.json(account)
  } catch (error) {
    console.error('Update GPT account error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// 设置账号是否开放展示
router.patch('/:id/open', async (req, res) => {
  try {
    const { isOpen } = req.body || {}
    if (typeof isOpen !== 'boolean') {
      return res.status(400).json({ error: 'isOpen must be a boolean' })
    }

	    const db = await getDatabase()

	    const checkResult = db.exec('SELECT id, COALESCE(is_banned, 0) AS is_banned FROM gpt_accounts WHERE id = ?', [req.params.id])
	    if (checkResult.length === 0 || checkResult[0].values.length === 0) {
	      return res.status(404).json({ error: 'Account not found' })
	    }

	    const isBanned = Boolean(checkResult[0].values[0][1])
	    if (isOpen && isBanned) {
	      return res.status(400).json({ error: '账号已封号，不能设置为开放账号' })
	    }

	    db.run(
	      `UPDATE gpt_accounts SET is_open = ?, updated_at = DATETIME('now', 'localtime') WHERE id = ?`,
	      [isOpen ? 1 : 0, req.params.id]
	    )
	    saveDatabase()

		    const result = db.exec(
		      `
		        SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, is_open,
		               COALESCE(is_demoted, 0) AS is_demoted,
		               COALESCE(is_banned, 0) AS is_banned,
		               COALESCE(space_type, '${SPACE_TYPE_CHILD}') AS space_type,
		               created_at, updated_at
		        FROM gpt_accounts
		        WHERE id = ?
		      `,
		      [req.params.id]
		    )
	    const row = result[0].values[0]
	    const account = {
	      id: row[0],
	      email: row[1],
	      token: row[2],
	      refreshToken: row[3],
	      userCount: row[4],
		      inviteCount: row[5],
		      chatgptAccountId: row[6],
		      oaiDeviceId: row[7],
		      expireAt: row[8] || null,
		      isOpen: Boolean(row[9]),
		      isDemoted: Boolean(row[10]),
		      isBanned: Boolean(row[11]),
          spaceType: row[12] || SPACE_TYPE_CHILD,
		      createdAt: row[13],
		      updatedAt: row[14]
		    }

    res.json(account)
  } catch (error) {
    console.error('Update GPT account open status error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// 标记账号为封号（后台手动操作）
router.patch('/:id/ban', async (req, res) => {
  try {
    const accountId = Number(req.params.id)
    if (!Number.isFinite(accountId)) {
      return res.status(400).json({ error: 'Invalid account id' })
    }

    const db = await getDatabase()
    const checkResult = db.exec('SELECT id FROM gpt_accounts WHERE id = ?', [accountId])
    if (checkResult.length === 0 || checkResult[0].values.length === 0) {
      return res.status(404).json({ error: 'Account not found' })
    }

    db.run(
      `
        UPDATE gpt_accounts
        SET is_open = 0,
            is_banned = 1,
            ban_processed = 0,
            updated_at = DATETIME('now', 'localtime')
        WHERE id = ?
      `,
      [accountId]
    )
    saveDatabase()

    const result = db.exec(
      `
        SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, is_open,
               COALESCE(is_demoted, 0) AS is_demoted,
               COALESCE(is_banned, 0) AS is_banned,
               COALESCE(sort_order, id) AS sort_order,
               COALESCE(space_type, '${SPACE_TYPE_CHILD}') AS space_type,
               COALESCE(space_status_code, 'normal') AS space_status_code,
               space_status_reason,
               created_at, updated_at
        FROM gpt_accounts
        WHERE id = ?
      `,
      [accountId]
    )
    const row = result[0].values[0]
    const account = {
      id: row[0],
      email: row[1],
      token: row[2],
      refreshToken: row[3],
      userCount: row[4],
      inviteCount: row[5],
      chatgptAccountId: row[6],
      oaiDeviceId: row[7],
      expireAt: row[8] || null,
      isOpen: Boolean(row[9]),
      isDemoted: Boolean(row[10]),
      isBanned: Boolean(row[11]),
      sortOrder: Number(row[12] || 0),
      spaceType: row[13] || SPACE_TYPE_CHILD,
      spaceStatusCode: row[14] || 'normal',
      spaceStatusReason: row[15] || '',
      createdAt: row[16],
      updatedAt: row[17],
      spaceStatus: resolveSpaceStatus({ isBanned: Boolean(row[11]), token: row[2], spaceStatusCode: row[14], spaceStatusReason: row[15] })
    }

    res.json(account)
  } catch (error) {
    console.error('Ban GPT account error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})


// 更新账号排序
router.patch('/reorder', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(v => Number(v)).filter(Number.isFinite) : []
    if (!ids.length) return res.status(400).json({ error: 'ids is required' })

    const db = await getDatabase()
    const placeholders = ids.map(() => '?').join(',')
    const existing = db.exec(`SELECT id FROM gpt_accounts WHERE id IN (${placeholders})`, ids)
    const existingSet = new Set((existing[0]?.values || []).map(row => Number(row[0])))
    for (const id of ids) {
      if (!existingSet.has(id)) return res.status(400).json({ error: `账号不存在: ${id}` })
    }

    ids.forEach((id, index) => {
      db.run(
        `UPDATE gpt_accounts SET sort_order = ?, updated_at = DATETIME('now', 'localtime') WHERE id = ?`,
        [index + 1, id]
      )
    })
    saveDatabase()
    return res.json({ message: '排序更新成功' })
  } catch (error) {
    console.error('更新账号排序失败:', error)
    return res.status(500).json({ error: '内部服务器错误' })
  }
})

// 一键同步全部空间信息
router.post('/sync-all', async (req, res) => {
  try {
    const db = await getDatabase()
    const rows = db.exec(`SELECT id FROM gpt_accounts ORDER BY COALESCE(sort_order, id) ASC, created_at DESC`)
    const ids = (rows[0]?.values || []).map(row => Number(row[0])).filter(Number.isFinite)

    const results = []
    for (const accountId of ids) {
      try {
        const userSync = await syncAccountUserCount(accountId)
        const inviteSync = await syncAccountInviteCount(accountId, {
          accountRecord: userSync.account,
          inviteListParams: { offset: 0, limit: 1, query: '' }
        })
        await markAccountSpaceStatus(db, accountId, { code: 'normal', reason: '正常' })
        results.push({
          id: accountId,
          ok: true,
          account: {
            ...inviteSync.account,
            spaceStatusCode: 'normal',
            spaceStatusReason: '正常',
            spaceStatus: resolveSpaceStatus({ ...inviteSync.account, spaceStatusCode: 'normal', spaceStatusReason: '正常' })
          },
          syncedUserCount: userSync.syncedUserCount,
          inviteCount: inviteSync.inviteCount
        })
      } catch (error) {
        if (isTokenInvalidSyncError(error)) {
          await markAccountSpaceStatus(db, accountId, { code: 'abnormal', reason: 'Token 已过期或无效，请更新账号 token' })
        }
        results.push({ id: accountId, ok: false, error: error?.message || '同步失败' })
      }
    }

    return res.json({ message: '批量同步完成', total: ids.length, results })
  } catch (error) {
    console.error('批量同步失败:', error)
    return res.status(500).json({ error: '内部服务器错误' })
  }
})

// Delete a GPT account
router.delete('/:id', async (req, res) => {
  try {
    const db = await getDatabase()

    // Check if account exists
    const checkResult = db.exec('SELECT id FROM gpt_accounts WHERE id = ?', [req.params.id])
    if (checkResult.length === 0 || checkResult[0].values.length === 0) {
      return res.status(404).json({ error: 'Account not found' })
    }

    db.run('DELETE FROM gpt_accounts WHERE id = ?', [req.params.id])
    saveDatabase()

    res.json({ message: 'Account deleted successfully' })
  } catch (error) {
    console.error('Delete GPT account error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// 同步账号用户数量
router.post('/:id/sync-user-count', async (req, res) => {
  try {
    const accountId = Number(req.params.id)
    const userSync = await syncAccountUserCount(accountId)
    const inviteSync = await syncAccountInviteCount(accountId, {
      accountRecord: userSync.account,
      inviteListParams: { offset: 0, limit: 1, query: '' }
    })
    const db = await getDatabase()
    await markAccountSpaceStatus(db, accountId, { code: 'normal', reason: '正常' })
    res.json({
      message: '账号同步成功',
      account: {
        ...inviteSync.account,
        spaceStatusCode: 'normal',
        spaceStatusReason: '正常',
        spaceStatus: resolveSpaceStatus({ ...inviteSync.account, spaceStatusCode: 'normal', spaceStatusReason: '正常' })
      },
      syncedUserCount: userSync.syncedUserCount,
      inviteCount: inviteSync.inviteCount,
      users: userSync.users
    })
  } catch (error) {
    console.error('同步账号人数错误:', error)

    if (error instanceof AccountSyncError || error.status) {
      if (isTokenInvalidSyncError(error)) {
        const db = await getDatabase()
        await markAccountSpaceStatus(db, Number(req.params.id), { code: 'abnormal', reason: 'Token 已过期或无效，请更新账号 token' })
      }
      return res.status(error.status || 500).json({ error: error.message })
    }

    res.status(500).json({ error: '内部服务器错误' })
  }
})

router.delete('/:id/users/:userId', async (req, res) => {
  try {
    const { account, syncedUserCount, users } = await deleteAccountUser(Number(req.params.id), req.params.userId)
    res.json({
      message: '成员删除成功',
      account,
      syncedUserCount,
      users
    })
  } catch (error) {
    console.error('删除成员失败:', error)

    if (error instanceof AccountSyncError || error.status) {
      return res.status(error.status || 500).json({ error: error.message })
    }

    res.status(500).json({ error: '内部服务器错误' })
  }
})

router.post('/:id/invite-user', async (req, res) => {
  try {
    const { email } = req.body || {}
    if (!email) {
      return res.status(400).json({ error: '请提供邀请邮箱地址' })
    }
    const result = await inviteAccountUser(Number(req.params.id), email)
    let inviteCount = null
    try {
      const synced = await syncAccountInviteCount(Number(req.params.id), {
        inviteListParams: { offset: 0, limit: 1, query: '' }
      })
      inviteCount = synced.inviteCount
    } catch (syncError) {
      console.warn('邀请发送成功，但同步邀请数失败:', syncError?.message || syncError)
    }

    res.json({
      ...result,
      inviteCount
    })
  } catch (error) {
    console.error('邀请成员失败:', error)

    if (error instanceof AccountSyncError || error.status) {
      return res.status(error.status || 500).json({ error: error.message })
    }

    res.status(500).json({ error: '内部服务器错误' })
  }
})

// 查询已邀请列表（用于统计待加入人数）
router.get('/:id/invites', async (req, res) => {
  try {
    const { invites } = await syncAccountInviteCount(Number(req.params.id), {
      inviteListParams: req.query || {}
    })
    res.json(invites)
  } catch (error) {
    console.error('获取邀请列表失败:', error)

    if (error instanceof AccountSyncError || error.status) {
      return res.status(error.status || 500).json({ error: error.message })
    }

    res.status(500).json({ error: '内部服务器错误' })
  }
})

// 撤回邀请
router.delete('/:id/invites', async (req, res) => {
  try {
    const emailAddress = req.body?.email_address || req.body?.emailAddress || req.body?.email
    if (!emailAddress) {
      return res.status(400).json({ error: '请提供邀请邮箱地址' })
    }

    const result = await deleteAccountInvite(Number(req.params.id), emailAddress)
    res.json(result)
  } catch (error) {
    console.error('撤回邀请失败:', error)

    if (error instanceof AccountSyncError || error.status) {
      return res.status(error.status || 500).json({ error: error.message })
    }

    res.status(500).json({ error: '内部服务器错误' })
  }
})

// 刷新账号的 access token
router.post('/:id/refresh-token', async (req, res) => {
  try {
    const db = await getDatabase()

	    const result = db.exec(
	      `SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, is_open,
	              COALESCE(is_demoted, 0) AS is_demoted,
	              COALESCE(is_banned, 0) AS is_banned,
	              COALESCE(space_type, '${SPACE_TYPE_CHILD}') AS space_type,
	              created_at, updated_at
	       FROM gpt_accounts WHERE id = ?`,
	      [req.params.id]
	    )

    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: '账号不存在' })
    }

    const row = result[0].values[0]
    const refreshToken = row[3]

    if (!refreshToken) {
      return res.status(400).json({ error: '该账号未配置 refresh token' })
    }

    const requestData = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: OPENAI_CLIENT_ID,
      refresh_token: refreshToken,
      scope: 'openid profile email'
    }).toString()

    const requestOptions = {
      method: 'POST',
      url: 'https://auth.openai.com/oauth/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': requestData.length
      },
      data: requestData,
      timeout: 60000
    }

    const response = await axios(requestOptions)

    if (response.status !== 200 || !response.data?.access_token) {
      return res.status(500).json({ error: '刷新 token 失败，未返回有效凭证' })
    }

    const resultData = response.data

    db.run(
      `UPDATE gpt_accounts SET token = ?, refresh_token = ?, updated_at = DATETIME('now', 'localtime') WHERE id = ?`,
      [resultData.access_token, resultData.refresh_token || refreshToken, req.params.id]
    )
    saveDatabase()

	    const updatedResult = db.exec(
	      `SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, is_open,
	              COALESCE(is_demoted, 0) AS is_demoted,
	              COALESCE(is_banned, 0) AS is_banned,
	              COALESCE(space_type, '${SPACE_TYPE_CHILD}') AS space_type,
	              created_at, updated_at
	       FROM gpt_accounts WHERE id = ?`,
	      [req.params.id]
	    )
    const updatedRow = updatedResult[0].values[0]
	    const account = {
	      id: updatedRow[0],
	      email: updatedRow[1],
	      token: updatedRow[2],
	      refreshToken: updatedRow[3],
	      userCount: updatedRow[4],
	      inviteCount: updatedRow[5],
	      chatgptAccountId: updatedRow[6],
	      oaiDeviceId: updatedRow[7],
	      expireAt: updatedRow[8] || null,
	      isOpen: Boolean(updatedRow[9]),
	      isDemoted: Boolean(updatedRow[10]),
	      isBanned: Boolean(updatedRow[11]),
	      spaceType: updatedRow[12] || SPACE_TYPE_CHILD,
	      createdAt: updatedRow[13],
	      updatedAt: updatedRow[14]
	    }

    res.json({
      message: 'Token 刷新成功',
      account,
      accessToken: resultData.access_token,
      idToken: resultData.id_token,
      refreshToken: resultData.refresh_token || refreshToken,
      expiresIn: resultData.expires_in || 3600
    })
  } catch (error) {
    console.error('刷新 token 错误:', error?.response?.data || error.message || error)

    if (error.response) {
      const message =
        error.response.data?.error?.message ||
        error.response.data?.error_description ||
        error.response.data?.error ||
        '刷新 token 失败'

      // 不直接透传 OpenAI 的状态码，统一返回 502 表示上游服务错误
      return res.status(502).json({
        error: message,
        upstream_status: error.response.status
      })
    }

    res.status(500).json({ error: '刷新 token 时发生内部错误' })
  }
})

export default router
