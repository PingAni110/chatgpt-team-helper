import { getDatabase } from '../database/init.js'

const CONFIG_KEYS = [
  'purchase_product_name',
  'purchase_price',
  'purchase_service_days',
  'purchase_order_expire_minutes',
  'purchase_no_warranty_product_name',
  'purchase_no_warranty_price',
  'purchase_no_warranty_service_days',
  'purchase_anti_ban_product_name',
  'purchase_anti_ban_price',
  'purchase_anti_ban_service_days',
]

const CACHE_TTL_MS = 60 * 1000
let cachedSettings = null
let cachedAt = 0

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const normalizeMoney = (value, fallback) => {
  const raw = String(value ?? '').trim()
  if (!raw) return fallback
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed.toFixed(2)
}

const loadSystemConfigMap = (database, keys) => {
  if (!database) return new Map()
  const list = Array.isArray(keys) && keys.length ? keys : CONFIG_KEYS
  const placeholders = list.map(() => '?').join(',')
  const result = database.exec(
    `SELECT config_key, config_value FROM system_config WHERE config_key IN (${placeholders})`,
    list
  )
  const map = new Map()
  const rows = result[0]?.values || []
  for (const row of rows) {
    map.set(String(row?.[0] ?? ''), String(row?.[1] ?? ''))
  }
  return map
}

export const getPurchaseSettingsFromEnv = () => {
  const productName = String(process.env.PURCHASE_PRODUCT_NAME || '通用渠道激活码').trim() || '通用渠道激活码'
  const amount = normalizeMoney(process.env.PURCHASE_PRICE ?? '1.00', '1.00')
  const serviceDays = Math.max(1, toInt(process.env.PURCHASE_SERVICE_DAYS, 30))
  const expireMinutes = Math.max(5, toInt(process.env.PURCHASE_ORDER_EXPIRE_MINUTES, 15))

  const noWarrantyAmount = normalizeMoney(process.env.PURCHASE_NO_WARRANTY_PRICE ?? '5.00', '5.00')
  const noWarrantyServiceDays = Math.max(1, toInt(process.env.PURCHASE_NO_WARRANTY_SERVICE_DAYS, serviceDays))
  const noWarrantyProductName = String(
    process.env.PURCHASE_NO_WARRANTY_PRODUCT_NAME || `${productName}（无质保）`
  ).trim() || `${productName}（无质保）`

  const antiBanAmount = normalizeMoney(process.env.PURCHASE_ANTI_BAN_PRICE ?? '10.00', '10.00')
  const antiBanServiceDays = Math.max(1, toInt(process.env.PURCHASE_ANTI_BAN_SERVICE_DAYS, serviceDays))
  const antiBanProductName = String(
    process.env.PURCHASE_ANTI_BAN_PRODUCT_NAME || `${productName}(防封禁)`
  ).trim() || `${productName}(防封禁)`

  return {
    expireMinutes,
    plans: {
      warranty: {
        productName,
        amount,
        serviceDays
      },
      noWarranty: {
        productName: noWarrantyProductName,
        amount: noWarrantyAmount,
        serviceDays: noWarrantyServiceDays
      },
      antiBan: {
        productName: antiBanProductName,
        amount: antiBanAmount,
        serviceDays: antiBanServiceDays
      }
    }
  }
}

export const invalidatePurchaseSettingsCache = () => {
  cachedSettings = null
  cachedAt = 0
}

export async function getPurchaseSettings(db, { forceRefresh = false } = {}) {
  const now = Date.now()
  if (!forceRefresh && cachedSettings && now - cachedAt < CACHE_TTL_MS) {
    return cachedSettings
  }

  const database = db || (await getDatabase())
  const stored = loadSystemConfigMap(database, CONFIG_KEYS)
  const env = getPurchaseSettingsFromEnv()

  const resolveString = (key, fallback) => {
    if (!stored.has(key)) return fallback
    return String(stored.get(key) ?? '')
  }

  const resolveTrimmedString = (key, fallback) => String(resolveString(key, fallback) ?? '').trim()

  const productName = resolveTrimmedString('purchase_product_name', env.plans.warranty.productName)
  const amount = normalizeMoney(resolveTrimmedString('purchase_price', env.plans.warranty.amount), env.plans.warranty.amount)
  const serviceDays = Math.max(1, toInt(resolveTrimmedString('purchase_service_days', env.plans.warranty.serviceDays), env.plans.warranty.serviceDays))
  const expireMinutes = Math.max(5, toInt(resolveTrimmedString('purchase_order_expire_minutes', env.expireMinutes), env.expireMinutes))

  const noWarrantyProductName = resolveTrimmedString('purchase_no_warranty_product_name', env.plans.noWarranty.productName)
  const noWarrantyAmount = normalizeMoney(resolveTrimmedString('purchase_no_warranty_price', env.plans.noWarranty.amount), env.plans.noWarranty.amount)
  const noWarrantyServiceDays = Math.max(
    1,
    toInt(resolveTrimmedString('purchase_no_warranty_service_days', env.plans.noWarranty.serviceDays), env.plans.noWarranty.serviceDays)
  )

  const antiBanProductName = resolveTrimmedString('purchase_anti_ban_product_name', env.plans.antiBan.productName)
  const antiBanAmount = normalizeMoney(resolveTrimmedString('purchase_anti_ban_price', env.plans.antiBan.amount), env.plans.antiBan.amount)
  const antiBanServiceDays = Math.max(
    1,
    toInt(resolveTrimmedString('purchase_anti_ban_service_days', env.plans.antiBan.serviceDays), env.plans.antiBan.serviceDays)
  )

  cachedSettings = {
    expireMinutes,
    plans: {
      warranty: {
        productName,
        amount,
        serviceDays
      },
      noWarranty: {
        productName: noWarrantyProductName,
        amount: noWarrantyAmount,
        serviceDays: noWarrantyServiceDays
      },
      antiBan: {
        productName: antiBanProductName,
        amount: antiBanAmount,
        serviceDays: antiBanServiceDays
      }
    },
    stored: {
      productName: stored.has('purchase_product_name'),
      amount: stored.has('purchase_price'),
      serviceDays: stored.has('purchase_service_days'),
      expireMinutes: stored.has('purchase_order_expire_minutes'),
      noWarrantyProductName: stored.has('purchase_no_warranty_product_name'),
      noWarrantyAmount: stored.has('purchase_no_warranty_price'),
      noWarrantyServiceDays: stored.has('purchase_no_warranty_service_days'),
      antiBanProductName: stored.has('purchase_anti_ban_product_name'),
      antiBanAmount: stored.has('purchase_anti_ban_price'),
      antiBanServiceDays: stored.has('purchase_anti_ban_service_days')
    }
  }
  cachedAt = now
  return cachedSettings
}
