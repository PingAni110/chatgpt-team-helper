import express from 'express'
import crypto from 'crypto'
import axios from 'axios'
import { apiKeyAuth } from '../middleware/api-key-auth.js'
import { consumeOAuthSessionByState, setOAuthSession } from '../services/oauth-session-store.js'
import { getOpenAIOAuthConfig, hashRedirectUri } from '../services/openai-oauth-config.js'
import { incMetric, getMetricsSnapshot } from '../services/openai-oauth-metrics.js'

const router = express.Router()
const OPENAI_CONFIG = getOpenAIOAuthConfig()

function parseProxyConfig(proxyUrl) {
  if (!proxyUrl) return null
  try {
    const parsed = new URL(proxyUrl)
    if (!parsed.hostname) return null
    return {
      protocol: parsed.protocol?.replace(':', '') || 'http',
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80,
      auth: parsed.username
        ? { username: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password || '') }
        : undefined
    }
  } catch {
    return null
  }
}

function decodeJwtPayload(token) {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid ID token format')
  const payloadSegment = parts[1].replace(/-/g, '+').replace(/_/g, '/')
  const paddedPayload = payloadSegment.padEnd(Math.ceil(payloadSegment.length / 4) * 4, '=')
  return JSON.parse(Buffer.from(paddedPayload, 'base64').toString('utf-8'))
}

function generateOpenAIPKCE() {
  const codeVerifier = crypto.randomBytes(64).toString('hex')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}

function classifyExchangeError(status, upstreamCode) {
  const businessCodes = new Set(['invalid_grant', 'invalid_request', 'invalid_client', 'invalid_scope', 'unauthorized_client'])
  if (businessCodes.has(String(upstreamCode || ''))) return status && status >= 400 && status < 500 ? status : 400
  return 500
}

router.post('/generate-auth-url', apiKeyAuth, async (req, res) => {
  try {
    if (!OPENAI_CONFIG.REDIRECT_URI) {
      return res.status(500).json({ success: false, message: 'OPENAI_REDIRECT_URI 未配置，无法生成授权链接' })
    }

    const { proxy, accountIdentifier } = req.body || {}
    const pkce = generateOpenAIPKCE()
    const state = crypto.randomBytes(32).toString('hex')
    const nonce = crypto.randomBytes(8).toString('hex')
    const normalizedAccountIdentifier = String(accountIdentifier || 'unknown').trim() || 'unknown'
    const sessionKey = `openai:pkce:${normalizedAccountIdentifier}:${nonce}`

    await setOAuthSession({
      sessionKey,
      codeVerifier: pkce.codeVerifier,
      codeChallenge: pkce.codeChallenge,
      state,
      nonce,
      accountIdentifier: normalizedAccountIdentifier,
      proxy: proxy || null
    })

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: OPENAI_CONFIG.CLIENT_ID,
      redirect_uri: OPENAI_CONFIG.REDIRECT_URI,
      scope: OPENAI_CONFIG.SCOPE,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: 'S256',
      state,
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true'
    })

    return res.json({
      success: true,
      data: {
        authUrl: `${OPENAI_CONFIG.BASE_URL}/oauth/authorize?${params.toString()}`,
        state,
        sessionKey,
        instructions: ['1. 浏览器打开授权链接', '2. 完成登录与授权', '3. 复制回调 URL（含 code 和 state）', '4. 粘贴到输入框完成交换']
      }
    })
  } catch (error) {
    return res.status(500).json({ success: false, message: '生成授权链接失败', error: error.message })
  }
})

router.post('/exchange-code', apiKeyAuth, async (req, res) => {
  const requestId = crypto.randomUUID()
  try {
    const { code, state } = req.body || {}
    if (!code || !state) {
      incMetric('exchangeCodeFailure')
      return res.status(400).json({ success: false, message: '缺少必要参数 code/state' })
    }

    if (!OPENAI_CONFIG.REDIRECT_URI) {
      incMetric('exchangeCodeFailure')
      return res.status(500).json({ success: false, message: 'OPENAI_REDIRECT_URI 未配置，无法交换授权码' })
    }

    const sessionData = await consumeOAuthSessionByState(state)
    if (!sessionData?.codeVerifier) {
      incMetric('exchangeCodeFailure')
      return res.status(400).json({ success: false, message: 'state 无效、过期或已使用' })
    }

    const tokenPayload = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code).trim(),
      client_id: OPENAI_CONFIG.CLIENT_ID,
      redirect_uri: OPENAI_CONFIG.REDIRECT_URI,
      code_verifier: sessionData.codeVerifier
    }).toString()

    const axiosConfig = {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 60000
    }
    const proxyConfig = parseProxyConfig(sessionData.proxy)
    if (proxyConfig) axiosConfig.proxy = proxyConfig

    const tokenResponse = await axios.post(`${OPENAI_CONFIG.BASE_URL}/oauth/token`, tokenPayload, axiosConfig)
    const { id_token: idToken, access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } = tokenResponse.data || {}
    if (!idToken || !accessToken) throw new Error('未返回有效的授权令牌')

    const payload = decodeJwtPayload(idToken)
    const authClaims = payload['https://api.openai.com/auth'] || {}
    const organizations = authClaims.organizations || []
    const defaultOrg = organizations.find(org => org.is_default) || organizations[0] || {}

    return res.json({
      success: true,
      data: {
        tokens: { idToken, accessToken, refreshToken, expiresIn: expiresIn || 0 },
        accountInfo: {
          accountId: authClaims.chatgpt_account_id || '',
          chatgptUserId: authClaims.chatgpt_user_id || authClaims.user_id || '',
          organizationId: defaultOrg.id || '',
          organizationRole: defaultOrg.role || '',
          organizationTitle: defaultOrg.title || '',
          planType: authClaims.chatgpt_plan_type || '',
          email: payload.email || '',
          name: payload.name || '',
          emailVerified: payload.email_verified || false,
          organizations
        }
      }
    })
  } catch (error) {
    const upstreamStatus = Number(error?.response?.status || 0) || null
    const upstreamError = String(error?.response?.data?.error || '') || null
    const upstreamDescription = String(error?.response?.data?.error_description || '') || null
    const status = classifyExchangeError(upstreamStatus, upstreamError)
    incMetric('exchangeCodeFailure')
    if (upstreamError === 'invalid_grant') incMetric('exchangeCodeInvalidGrant')

    console.error('[OpenAI OAuth exchange] 失败', {
      requestId,
      upstreamStatus,
      error: upstreamError,
      errorDescription: upstreamDescription,
      redirectUriHash: hashRedirectUri(OPENAI_CONFIG.REDIRECT_URI),
      hasCodeVerifier: true
    })

    return res.status(status).json({
      success: false,
      message: status >= 500 ? '交换授权码失败' : '授权参数无效或授权码已失效',
      error: upstreamError || error.message,
      error_description: upstreamDescription
    })
  }
})

router.get('/oauth-metrics', apiKeyAuth, async (_req, res) => {
  res.json({ success: true, data: getMetricsSnapshot() })
})

export default router
