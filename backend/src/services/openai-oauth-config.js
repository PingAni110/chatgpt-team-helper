const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://auth.openai.com'
const OPENAI_CLIENT_ID = process.env.OPENAI_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENAI_REDIRECT_URI = String(process.env.OPENAI_REDIRECT_URI || '').trim()
const OPENAI_SCOPE = process.env.OPENAI_SCOPE || 'openid profile email offline_access'

function isLocalhostUri(uri) {
  if (!uri) return false
  try {
    const parsed = new URL(uri)
    const host = String(parsed.hostname || '').toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  } catch {
    return false
  }
}

export function getOpenAIOAuthConfig() {
  return {
    BASE_URL: OPENAI_BASE_URL,
    CLIENT_ID: OPENAI_CLIENT_ID,
    REDIRECT_URI: OPENAI_REDIRECT_URI,
    SCOPE: OPENAI_SCOPE
  }
}

export function validateOpenAIOAuthConfig({ productionOnly = true } = {}) {
  const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production'
  if (productionOnly && !isProduction) {
    return
  }

  if (!OPENAI_REDIRECT_URI) {
    throw new Error('OPENAI_REDIRECT_URI 未配置，生产环境必须使用线上回调地址')
  }

  if (isLocalhostUri(OPENAI_REDIRECT_URI)) {
    throw new Error(`OPENAI_REDIRECT_URI 不允许使用 localhost：${OPENAI_REDIRECT_URI}`)
  }
}

export function hashRedirectUri(uri) {
  const text = String(uri || '')
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  }
  return hash.toString(16)
}
