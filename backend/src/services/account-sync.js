import { getDatabase, saveDatabase } from '../database/init.js'
import axios from 'axios'
import { loadProxyList, parseProxyConfig } from '../utils/proxy.js'
import { formatExpireAtOutput } from '../utils/expire-at.js'

const safeFormatExpireAtOutput = (value) => {
  try {
    return formatExpireAtOutput(value)
  } catch (error) {
    console.error('Format expireAt output error:', error)
    return null
  }
}

export class AccountSyncError extends Error {
  constructor(message, status = 500) {
    super(message)
    this.name = 'AccountSyncError'
    this.status = status
  }
}

const DEFAULT_PROXY_CACHE_TTL_MS = 60_000
let defaultProxyCache = { loadedAt: 0, proxies: [] }
let defaultProxyCursor = 0

const getDefaultProxyList = () => {
  const now = Date.now()
  if (defaultProxyCache.loadedAt && (now - defaultProxyCache.loadedAt) < DEFAULT_PROXY_CACHE_TTL_MS) {
    return defaultProxyCache.proxies
  }

  const proxies = loadProxyList()
  defaultProxyCache = { loadedAt: now, proxies }
  return proxies
}

const pickProxyFromList = (proxies = []) => {
  if (!proxies.length) return null
  const index = Math.abs(defaultProxyCursor++) % proxies.length
  return proxies[index] || null
}

const pickProxyFromEnv = () => {
  const candidates = [
    process.env.CHATGPT_PROXY_URL,
    process.env.CHATGPT_PROXY,
    process.env.ALL_PROXY,
    process.env.all_proxy,
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy
  ]

  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim()
    if (!normalized) continue
    const config = parseProxyConfig(normalized)
    if (config) {
      return { url: normalized, config }
    }
  }

  return null
}

const resolveRequestProxy = (proxy) => {
  if (proxy === false) return false

  const rawString = typeof proxy === 'string' ? String(proxy).trim() : ''
  if (rawString) return rawString
  if (proxy && typeof proxy === 'object') return proxy

  const entry = pickProxyFromList(getDefaultProxyList()) || pickProxyFromEnv()
  return entry ? entry.url : null
}

function mapRowToAccount(row) {
  try {
    return {
      id: row[0],
      email: row[1],
      token: row[2],
      refreshToken: row[3],
      userCount: row[4],
      inviteCount: row[5],
      chatgptAccountId: row[6],
      oaiDeviceId: row[7],
      expireAt: safeFormatExpireAtOutput(row[8]),
      sortOrder: row[9] ?? 0,
      isOpen: Boolean(row[10]),
      isDemoted: Boolean(row[11]),
      isBanned: Boolean(row[12]),
      createdAt: row[13],
      updatedAt: row[14]
    }
  } catch (error) {
    console.error('Map account row error:', error)
    return null
  }
}

async function fetchAccountById(db, accountId) {
  const result = db.exec(
    `
    SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, sort_order, is_open,
           COALESCE(is_demoted, 0) AS is_demoted,
           COALESCE(is_banned, 0) AS is_banned,
           created_at, updated_at
    FROM gpt_accounts
    WHERE id = ?
  `,
    [accountId]
  )

  if (result.length === 0 || result[0].values.length === 0) {
    return null
  }

  return mapRowToAccount(result[0].values[0])
}

export async function fetchAllAccounts() {
  const db = await getDatabase()
  const result = db.exec(`
    SELECT id, email, token, refresh_token, user_count, invite_count, chatgpt_account_id, oai_device_id, expire_at, sort_order, is_open,
           COALESCE(is_demoted, 0) AS is_demoted,
           COALESCE(is_banned, 0) AS is_banned,
           created_at, updated_at
    FROM gpt_accounts
    ORDER BY sort_order ASC, created_at DESC
  `)

  if (result.length === 0) {
    return []
  }

  return result[0].values.map(mapRowToAccount).filter(Boolean)
}

function buildHeaders(account) {
  return {
    accept: '*/*',
    'accept-language': 'zh-CN,zh;q=0.9',
    authorization: `Bearer ${account.token}`,
    'chatgpt-account-id': account.chatgptAccountId,
    'oai-client-version': 'prod-eddc2f6ff65fee2d0d6439e379eab94fe3047f72',
    'oai-device-id': account.oaiDeviceId || '',
    'oai-language': 'zh-CN',
    referer: 'https://chatgpt.com/admin/members?tab=members',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
  }
}

const normalizeProxyConfig = (proxy) => {
  if (!proxy) return null
  if (typeof proxy === 'string') return parseProxyConfig(proxy)
  if (typeof proxy === 'object' && proxy.host && proxy.port) {
    const protocol = proxy.protocol ? String(proxy.protocol).replace(':', '').toLowerCase() : 'http'
    if (!['http', 'https', 'socks', 'socks4', 'socks4a', 'socks5', 'socks5h'].includes(protocol)) return null
    const port = Number(proxy.port)
    if (!Number.isFinite(port) || port <= 0) return null

    const auth = proxy.auth && typeof proxy.auth === 'object'
      ? {
          username: proxy.auth.username ? String(proxy.auth.username) : '',
          password: proxy.auth.password ? String(proxy.auth.password) : ''
        }
      : undefined

    return {
      protocol,
      host: String(proxy.host),
      port,
      ...(auth && auth.username ? { auth } : {})
    }
  }

  return null
}

const formatProxyConfigForLog = (proxyConfig) => {
  if (!proxyConfig) return null
  return {
    protocol: proxyConfig.protocol,
    host: proxyConfig.host,
    port: proxyConfig.port
  }
}

const isSocksProxyConfig = (proxyConfig) => {
  if (!proxyConfig) return false
  const protocol = String(proxyConfig.protocol || '').toLowerCase()
  return protocol === 'socks' || protocol.startsWith('socks')
}

const buildProxyUrlFromConfig = (proxyConfig) => {
  if (!proxyConfig) return ''
  const protocol = String(proxyConfig.protocol || '').replace(':', '')
  const host = String(proxyConfig.host || '')
  const port = Number(proxyConfig.port || 0)
  if (!protocol || !host || !Number.isFinite(port) || port <= 0) return ''

  const auth = proxyConfig.auth && typeof proxyConfig.auth === 'object'
    ? {
        username: proxyConfig.auth.username ? String(proxyConfig.auth.username) : '',
        password: proxyConfig.auth.password ? String(proxyConfig.auth.password) : ''
      }
    : null

  const authPart = auth && auth.username
    ? `${encodeURIComponent(auth.username)}:${encodeURIComponent(auth.password || '')}@`
    : ''

  return `${protocol}://${authPart}${host}:${port}`
}

let socksProxyAgentModulePromise = null
const socksAgentCache = new Map()

async function getSocksProxyAgentModule() {
  if (!socksProxyAgentModulePromise) {
    socksProxyAgentModulePromise = import('socks-proxy-agent')
  }
  return socksProxyAgentModulePromise
}

async function getSocksAgent(proxyUrl, proxyConfigForLog) {
  const url = String(proxyUrl || '').trim()
  if (!url) return null

  const cached = socksAgentCache.get(url)
  if (cached) return cached

  let module
  try {
    module = await getSocksProxyAgentModule()
  } catch (error) {
    console.error('SOCKS 代理依赖缺失（socks-proxy-agent）', {
      proxy: formatProxyConfigForLog(proxyConfigForLog),
      message: error?.message || String(error)
    })
    throw new AccountSyncError('SOCKS5 代理需要安装依赖 socks-proxy-agent（请在 backend 执行 npm i socks-proxy-agent）', 500)
  }

  const SocksProxyAgent = module?.SocksProxyAgent || module?.default
  if (!SocksProxyAgent) {
    throw new AccountSyncError('SOCKS5 代理依赖 socks-proxy-agent 加载失败', 500)
  }

  const agent = new SocksProxyAgent(url)
  socksAgentCache.set(url, agent)
  return agent
}

async function requestChatgptText(apiUrl, { method, headers, data, proxy } = {}, logContext = {}) {
  const resolvedProxy = resolveRequestProxy(proxy)
  const rawProxyUrl = typeof resolvedProxy === 'string' ? String(resolvedProxy).trim() : ''
  const proxyConfig = normalizeProxyConfig(resolvedProxy)
  const socksProxyUrl = proxyConfig && isSocksProxyConfig(proxyConfig)
    ? (rawProxyUrl || buildProxyUrlFromConfig(proxyConfig))
    : ''
  const socksAgent = socksProxyUrl ? await getSocksAgent(socksProxyUrl, proxyConfig) : null

  let response
  try {
    response = await axios.request({
      url: apiUrl,
      method: method || 'GET',
      headers,
      data,
      timeout: 60000,
      proxy: socksAgent ? false : (proxyConfig || false),
      httpAgent: socksAgent || undefined,
      httpsAgent: socksAgent || undefined,
      responseType: 'text',
      transformResponse: [d => d],
      validateStatus: () => true
    })
  } catch (error) {
    console.error('请求 ChatGPT API 网络错误', {
      ...logContext,
      proxy: formatProxyConfigForLog(proxyConfig),
      code: error?.code,
      message: error?.message || String(error)
    })
    throw new AccountSyncError('无法连接到 ChatGPT API，请检查网络连接', 503)
  }

  const text = typeof response.data === 'string' ? response.data : (response.data == null ? '' : String(response.data))
  return { status: response.status, text, proxyConfig }
}

const parseJsonOrThrow = (text, { logContext, message }) => {
  try {
    return JSON.parse(text)
  } catch (error) {
    console.error(message, logContext, error)
    throw new AccountSyncError(message, 500)
  }
}

const throwChatgptApiStatusError = async ({ status, errorText, logContext, label }) => {
  console.error(label, {
    ...logContext,
    status,
    body: String(errorText || '').slice(0, 2000)
  })

  const rawErrorText = String(errorText || '').trim()
  if (rawErrorText) {
    try {
      const parsed = JSON.parse(rawErrorText)
      const code = parsed?.error?.code || parsed?.code
      if (code === 'account_deactivated') {
        const accountId = Number(logContext?.accountId)
        if (Number.isFinite(accountId)) {
          try {
            const db = await getDatabase()
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
            await saveDatabase()
            console.warn('[AccountSync] upstream account_deactivated; auto-banned', { accountId })
          } catch (error) {
            console.error('[AccountSync] auto-ban failed', {
              accountId,
              message: error?.message || String(error)
            })
          }
        }

        throw new AccountSyncError('OpenAI 账号已停用（account_deactivated），已自动标记为封号', 401)
      }
    } catch {
      // ignore parse errors
    }
  }

  if (status === 401) {
    throw new AccountSyncError('Token 已过期或无效，请更新账号 token', 401)
  }
  if (status === 404) {
    throw new AccountSyncError('ChatGPT 账号不存在或无权访问', 404)
  }
  if (status === 429) {
    throw new AccountSyncError('API 请求过于频繁，请稍后重试', 429)
  }

  throw new AccountSyncError(`ChatGPT API 请求失败: ${status}`, status || 500)
}

async function requestAccountInvites(account, params = {}, requestOptions = {}) {
  const parsedLimit = Number.parseInt(params.limit, 10)
  const parsedOffset = Number.parseInt(params.offset, 10)
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 25
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0
  const query = typeof params.query === 'string' ? params.query : ''

  const apiUrl = `https://chatgpt.com/backend-api/accounts/${account.chatgptAccountId}/invites?offset=${offset}&limit=${limit}&query=${encodeURIComponent(query)}`
  const logContext = {
    accountId: account.id,
    chatgptAccountId: account.chatgptAccountId,
    limit,
    offset,
    url: apiUrl
  }

  const { status, text } = await requestChatgptText(
    apiUrl,
    {
      method: 'GET',
      headers: {
        ...buildHeaders(account),
        referer: 'https://chatgpt.com/admin/members?tab=invites'
      },
      proxy: requestOptions.proxy
    },
    logContext
  )

  if (status < 200 || status >= 300) {
    await throwChatgptApiStatusError({
      status,
      errorText: text,
      logContext,
      label: 'ChatGPT API 错误: 获取邀请列表失败'
    })
  }

  const data = parseJsonOrThrow(text, { logContext, message: 'ChatGPT 邀请响应 JSON 解析失败' })

  if (typeof data.total !== 'number') {
    console.error('ChatGPT 邀请响应缺少 total 字段', {
      ...logContext,
      responseSample: JSON.stringify(data).slice(0, 500)
    })
    throw new AccountSyncError('ChatGPT API 响应格式异常，缺少 total 字段', 500)
  }

  if (!Array.isArray(data.items)) {
    console.error('ChatGPT 邀请响应 items 字段异常', {
      ...logContext,
      responseSample: JSON.stringify(data).slice(0, 500)
    })
    data.items = []
  }

  return {
    items: data.items.map(item => ({
      id: item.id,
      email_address: item.email_address,
      role: item.role,
      created_time: item.created_time,
      is_scim_managed: item.is_scim_managed
    })),
    total: data.total,
    limit: typeof data.limit === 'number' ? data.limit : limit,
    offset: typeof data.offset === 'number' ? data.offset : offset
  }
}

async function requestDeleteAccountInvite(account, emailAddress, requestOptions = {}) {
  const trimmedEmail = String(emailAddress || '').trim().toLowerCase()
  if (!trimmedEmail) {
    throw new AccountSyncError('请提供邀请邮箱地址', 400)
  }

  const apiUrl = `https://chatgpt.com/backend-api/accounts/${account.chatgptAccountId}/invites`
  const logContext = {
    accountId: account.id,
    chatgptAccountId: account.chatgptAccountId,
    email: trimmedEmail,
    url: apiUrl
  }

  const { status, text } = await requestChatgptText(
    apiUrl,
    {
      method: 'DELETE',
      headers: {
        ...buildHeaders(account),
        'content-type': 'application/json',
        origin: 'https://chatgpt.com',
        referer: 'https://chatgpt.com/admin/members?tab=invites'
      },
      data: { email_address: trimmedEmail },
      proxy: requestOptions.proxy
    },
    logContext
  )

  if (status < 200 || status >= 300) {
    await throwChatgptApiStatusError({
      status,
      errorText: text,
      logContext,
      label: 'ChatGPT API 错误: 删除邀请失败'
    })
  }

  // 上游可能返回空 body
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function requestAccountUsers(account, params = {}, requestOptions = {}) {
  const parsedLimit = Number.parseInt(params.limit, 10)
  const parsedOffset = Number.parseInt(params.offset, 10)
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 25
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0
  const query = typeof params.query === 'string' ? params.query : ''
  const apiUrl = `https://chatgpt.com/backend-api/accounts/${account.chatgptAccountId}/users?offset=${offset}&limit=${limit}&query=${encodeURIComponent(query)}`
  const logContext = {
    accountId: account.id,
    chatgptAccountId: account.chatgptAccountId,
    limit,
    offset,
    query,
    url: apiUrl
  }

  const { status, text } = await requestChatgptText(
    apiUrl,
    {
      method: 'GET',
      headers: buildHeaders(account),
      proxy: requestOptions.proxy
    },
    logContext
  )

  if (status < 200 || status >= 300) {
    await throwChatgptApiStatusError({
      status,
      errorText: text,
      logContext,
      label: 'ChatGPT API 错误: 获取成员失败'
    })
  }

  const data = parseJsonOrThrow(text, { logContext, message: 'ChatGPT 成员响应 JSON 解析失败' })

  if (typeof data.total !== 'number') {
    console.error('ChatGPT 成员响应缺少 total 字段', {
      ...logContext,
      responseSample: JSON.stringify(data).slice(0, 500)
    })
    throw new AccountSyncError('ChatGPT API 响应格式异常，缺少 total 字段', 500)
  }

  if (!Array.isArray(data.items)) {
    console.error('ChatGPT 成员响应 items 字段异常', {
      ...logContext,
      responseSample: JSON.stringify(data).slice(0, 500)
    })
    data.items = []
  }

  return {
    total: data.total,
    limit: typeof data.limit === 'number' ? data.limit : limit,
    offset: typeof data.offset === 'number' ? data.offset : offset,
    items: data.items.map(item => ({
      id: item.id,
      account_user_id: item.account_user_id,
      email: item.email,
      role: item.role,
      name: item.name,
      created_time: item.created_time,
      is_scim_managed: item.is_scim_managed
    }))
  }
}

async function fetchAllAccountUsers(account, options = {}) {
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 100
  let offset = 0
  let total = 0
  const items = []
  while (true) {
    const page = await requestAccountUsers(
      account,
      { offset, limit, query: '' },
      { proxy: options.proxy }
    )
    total = page.total
    items.push(...(page.items || []))
    offset += page.items.length
    if (items.length >= total || page.items.length === 0) break
  }
  return {
    total,
    limit,
    offset: Math.max(0, offset - limit),
    items
  }
}

const persistAccountMembers = (db, accountId, items = []) => {
  if (!db || !accountId) return
  db.run('DELETE FROM gpt_account_members WHERE account_id = ?', [accountId])
  for (const item of items) {
    const memberId = String(item?.id ?? '').trim()
    if (!memberId) continue
    db.run(
      `
        INSERT INTO gpt_account_members (
          account_id,
          member_id,
          email,
          name,
          role,
          created_time,
          synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, DATETIME('now', 'localtime'))
      `,
      [
        accountId,
        memberId,
        item.email || null,
        item.name || null,
        item.role || null,
        item.created_time || null
      ]
    )
  }
}

export async function fetchAccountUsersList(accountId, options = {}) {
  const db = await getDatabase()
  const account =
    options.accountRecord ||
    (await fetchAccountById(db, accountId))

  if (!account) {
    throw new AccountSyncError('账号不存在', 404)
  }

  if (!account.token || !account.chatgptAccountId) {
    throw new AccountSyncError('账号信息不完整，缺少 token 或 chatgpt_account_id', 400)
  }

  const usersData = await requestAccountUsers(account, options.userListParams, { proxy: options.proxy })
  return usersData
}

export async function syncAccountUserCount(accountId, options = {}) {
  const db = await getDatabase()
  const account =
    options.accountRecord ||
    (await fetchAccountById(db, accountId))

  if (!account) {
    throw new AccountSyncError('账号不存在', 404)
  }

  if (!account.token || !account.chatgptAccountId) {
    throw new AccountSyncError('账号信息不完整，缺少 token 或 chatgpt_account_id', 400)
  }

  const usersData = await requestAccountUsers(account, { ...(options.userListParams || {}), query: '' }, { proxy: options.proxy })

  db.run(
    `
      UPDATE gpt_accounts
      SET user_count = ?,
          updated_at = DATETIME('now', 'localtime')
      WHERE id = ?
    `,
    [usersData.total, account.id]
  )

  const fullUsersData = await fetchAllAccountUsers(account, { proxy: options.proxy })
  persistAccountMembers(db, account.id, fullUsersData.items)
  await saveDatabase()

  const updatedAccount = await fetchAccountById(db, account.id)

  return {
    account: updatedAccount,
    syncedUserCount: usersData.total,
    users: fullUsersData
  }
}

export async function fetchAccountInvites(accountId, options = {}) {
  const db = await getDatabase()
  const account =
    options.accountRecord ||
    (await fetchAccountById(db, accountId))

  if (!account) {
    throw new AccountSyncError('账号不存在', 404)
  }

  if (!account.token || !account.chatgptAccountId) {
    throw new AccountSyncError('账号信息不完整，缺少 token 或 chatgpt_account_id', 400)
  }

  const invitesData = await requestAccountInvites(account, options.inviteListParams, { proxy: options.proxy })
  return invitesData
}

export async function syncAccountInviteCount(accountId, options = {}) {
  const db = await getDatabase()
  const account =
    options.accountRecord ||
    (await fetchAccountById(db, accountId))

  if (!account) {
    throw new AccountSyncError('账号不存在', 404)
  }

  if (!account.token || !account.chatgptAccountId) {
    throw new AccountSyncError('账号信息不完整，缺少 token 或 chatgpt_account_id', 400)
  }

  const invitesData = await requestAccountInvites(account, options.inviteListParams, { proxy: options.proxy })

  db.run(
    `UPDATE gpt_accounts SET invite_count = ?, updated_at = DATETIME('now', 'localtime') WHERE id = ?`,
    [invitesData.total, account.id]
  )
  await saveDatabase()

  const updatedAccount = await fetchAccountById(db, account.id)

  return {
    account: updatedAccount,
    inviteCount: invitesData.total,
    invites: invitesData
  }
}

export async function deleteAccountInvite(accountId, emailAddress, options = {}) {
  const db = await getDatabase()
  const account =
    options.accountRecord ||
    (await fetchAccountById(db, accountId))

  if (!account) {
    throw new AccountSyncError('账号不存在', 404)
  }

  if (!account.token || !account.chatgptAccountId) {
    throw new AccountSyncError('账号信息不完整，缺少 token 或 chatgpt_account_id', 400)
  }

  const trimmedEmail = String(emailAddress || '').trim()
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(trimmedEmail)) {
    throw new AccountSyncError('邮箱格式不正确', 400)
  }

  const result = await requestDeleteAccountInvite(account, trimmedEmail, { proxy: options.proxy })
  const synced = await syncAccountInviteCount(account.id, {
    accountRecord: account,
    inviteListParams: { offset: 0, limit: 1, query: '' },
    proxy: options.proxy
  })

  return {
    message: '邀请删除成功',
    result,
    account: synced.account,
    inviteCount: synced.inviteCount
  }
}

export async function deleteAccountUser(accountId, userId, options = {}) {
  if (!userId) {
    throw new AccountSyncError('缺少用户ID', 400)
  }

  const db = await getDatabase()
  const account =
    options.accountRecord ||
    (await fetchAccountById(db, accountId))

  if (!account) {
    throw new AccountSyncError('账号不存在', 404)
  }

  if (!account.token || !account.chatgptAccountId) {
    throw new AccountSyncError('账号信息不完整，缺少 token 或 chatgpt_account_id', 400)
  }

  const normalizedUserId = userId.startsWith('user-') ? userId : `user-${userId}`
  const apiUrl = `https://chatgpt.com/backend-api/accounts/${account.chatgptAccountId}/users/${normalizedUserId}`
  const deleteLogContext = {
    accountId: account.id,
    chatgptAccountId: account.chatgptAccountId,
    userId: normalizedUserId,
    url: apiUrl
  }

  console.info('开始删除 ChatGPT 成员', deleteLogContext)
  const { status, text } = await requestChatgptText(
    apiUrl,
    { method: 'DELETE', headers: buildHeaders(account), proxy: options.proxy },
    deleteLogContext
  )

  if (status < 200 || status >= 300) {
    console.error('删除 ChatGPT 用户错误:', {
      ...deleteLogContext,
      status,
      body: String(text || '').slice(0, 2000)
    })

    if (status === 401) {
      throw new AccountSyncError('Token 已过期或无效，请更新账号 token', 401)
    }
    if (status === 404) {
      throw new AccountSyncError('指定的用户不存在或无权访问', 404)
    }
    if (status === 429) {
      throw new AccountSyncError('API 请求过于频繁，请稍后重试', 429)
    }

    throw new AccountSyncError(`ChatGPT API 请求失败: ${status}`, status)
  }

  const usersData = await requestAccountUsers(account, options.userListParams, { proxy: options.proxy })

  db.run(
    `UPDATE gpt_accounts SET user_count = ?, updated_at = DATETIME('now', 'localtime') WHERE id = ?`,
    [usersData.total, account.id]
  )
  await saveDatabase()

  const updatedAccount = await fetchAccountById(db, account.id)

  return {
    account: updatedAccount,
    syncedUserCount: usersData.total,
    users: usersData
  }
}

export async function inviteAccountUser(accountId, email, options = {}) {
  if (!email || typeof email !== 'string') {
    throw new AccountSyncError('请提供邀请邮箱地址', 400)
  }

  const trimmedEmail = email.trim()
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(trimmedEmail)) {
    throw new AccountSyncError('邮箱格式不正确', 400)
  }

  const db = await getDatabase()
  const account =
    options.accountRecord ||
    (await fetchAccountById(db, accountId))

  if (!account) {
    throw new AccountSyncError('账号不存在', 404)
  }

  if (!account.token || !account.chatgptAccountId) {
    throw new AccountSyncError('账号信息不完整，缺少 token 或 chatgpt_account_id', 400)
  }

  const apiUrl = `https://chatgpt.com/backend-api/accounts/${account.chatgptAccountId}/invites`
  const payload = {
    email_addresses: [trimmedEmail],
    role: 'standard-user',
    resend_emails: true
  }

  const headers = {
    ...buildHeaders(account),
    'content-type': 'application/json',
    origin: 'https://chatgpt.com',
    referer: 'https://chatgpt.com/admin/members'
  }

  const inviteLogContext = {
    accountId: account.id,
    chatgptAccountId: account.chatgptAccountId,
    email: trimmedEmail,
    url: apiUrl
  }

  const { status, text } = await requestChatgptText(
    apiUrl,
    { method: 'POST', headers, data: payload, proxy: options.proxy },
    inviteLogContext
  )

  if (status < 200 || status >= 300) {
    console.error('发送邀请失败:', status, String(text || '').slice(0, 2000))

    if (status === 401) {
      throw new AccountSyncError('Token 已过期或无效，请更新账号 token', 401)
    }
    if (status === 404) {
      throw new AccountSyncError('ChatGPT 账号不存在或无权访问', 404)
    }
    if (status === 429) {
      throw new AccountSyncError('API 请求过于频繁，请稍后重试', 429)
    }

    throw new AccountSyncError(`ChatGPT API 请求失败: ${status}`, status)
  }

  const data = parseJsonOrThrow(text, { logContext: inviteLogContext, message: '邀请接口返回格式异常，无法解析' })

  return {
    message: '邀请已发送',
    invite: data
  }
}
