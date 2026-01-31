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
  'purchase_products',
  'purchase_notice'
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
  const notice = String(
    process.env.PURCHASE_NOTICE ||
      '订单信息将发送至填写的邮箱，请确认邮箱可正常收信。\n支付成功后系统自动处理，无需手动兑换。\n如未收到邮件请检查垃圾箱，或使用"查询订单"页进行订单查询。'
  ).trim()

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
    notice,
    products: [
      {
        key: 'warranty',
        productName,
        amount,
        serviceDays,
        sortOrder: 1,
        isActive: true,
        isNoWarranty: false,
        isAntiBan: false
      },
      {
        key: 'anti_ban',
        productName: antiBanProductName,
        amount: antiBanAmount,
        serviceDays: antiBanServiceDays,
        sortOrder: 2,
        isActive: true,
        isNoWarranty: false,
        isAntiBan: true
      },
      {
        key: 'no_warranty',
        productName: noWarrantyProductName,
        amount: noWarrantyAmount,
        serviceDays: noWarrantyServiceDays,
        sortOrder: 3,
        isActive: true,
        isNoWarranty: true,
        isAntiBan: false
      }
    ]
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

  const productName = resolveTrimmedString('purchase_product_name', env.products[0].productName)
  const amount = normalizeMoney(resolveTrimmedString('purchase_price', env.products[0].amount), env.products[0].amount)
  const serviceDays = Math.max(1, toInt(resolveTrimmedString('purchase_service_days', env.products[0].serviceDays), env.products[0].serviceDays))
  const expireMinutes = Math.max(5, toInt(resolveTrimmedString('purchase_order_expire_minutes', env.expireMinutes), env.expireMinutes))
  const notice = resolveTrimmedString('purchase_notice', env.notice)

  const noWarrantyProductName = resolveTrimmedString('purchase_no_warranty_product_name', env.products[2].productName)
  const noWarrantyAmount = normalizeMoney(resolveTrimmedString('purchase_no_warranty_price', env.products[2].amount), env.products[2].amount)
  const noWarrantyServiceDays = Math.max(
    1,
    toInt(resolveTrimmedString('purchase_no_warranty_service_days', env.products[2].serviceDays), env.products[2].serviceDays)
  )

  const antiBanProductName = resolveTrimmedString('purchase_anti_ban_product_name', env.products[1].productName)
  const antiBanAmount = normalizeMoney(resolveTrimmedString('purchase_anti_ban_price', env.products[1].amount), env.products[1].amount)
  const antiBanServiceDays = Math.max(
    1,
    toInt(resolveTrimmedString('purchase_anti_ban_service_days', env.products[1].serviceDays), env.products[1].serviceDays)
  )

  const storedProductsRaw = resolveTrimmedString('purchase_products', '')
  let storedProducts = null
  if (storedProductsRaw) {
    try {
      const parsed = JSON.parse(storedProductsRaw)
      if (Array.isArray(parsed)) {
        storedProducts = parsed
      }
    } catch {
      storedProducts = null
    }
  }

  const normalizeProduct = (input, fallback) => {
    const rawKey = String(input?.key ?? fallback?.key ?? '').trim().toLowerCase()
    const key = rawKey || String(fallback?.key || '').trim()
    const fallbackName = String(fallback?.productName || '').trim()
    const fallbackAmount = String(fallback?.amount || '').trim()
    const fallbackDays = Number(fallback?.serviceDays || 1)
    const productNameResolved = String(input?.productName ?? fallbackName).trim() || fallbackName
    const amountResolved = normalizeMoney(input?.amount ?? fallbackAmount, fallbackAmount)
    const serviceDaysResolved = Math.max(1, toInt(input?.serviceDays ?? fallbackDays, fallbackDays))
    const sortOrderResolved = Number.isFinite(Number(input?.sortOrder)) ? Number(input.sortOrder) : (fallback?.sortOrder ?? 0)
    const isActiveResolved = input?.isActive === false ? false : Boolean(input?.isActive ?? true)
    const isNoWarrantyResolved = Boolean(input?.isNoWarranty ?? fallback?.isNoWarranty ?? false)
    const isAntiBanResolved = Boolean(input?.isAntiBan ?? fallback?.isAntiBan ?? false)
    const descriptionResolved = String(input?.description ?? fallback?.description ?? '').trim()
    const noticeResolved = Array.isArray(input?.notice)
      ? input.notice.map(item => String(item || '').trim()).filter(Boolean).join('\n')
      : String(input?.notice ?? fallback?.notice ?? '').trim()
    return {
      key,
      productName: productNameResolved,
      amount: amountResolved,
      serviceDays: serviceDaysResolved,
      sortOrder: sortOrderResolved,
      isActive: isActiveResolved,
      isNoWarranty: isNoWarrantyResolved,
      isAntiBan: isAntiBanResolved,
      description: descriptionResolved,
      notice: noticeResolved
    }
  }

  const fallbackProducts = [
    {
      key: 'warranty',
      productName,
      amount,
      serviceDays,
      sortOrder: 1,
      isActive: true,
      isNoWarranty: false,
      isAntiBan: false,
      description: '',
      notice: ''
    },
    {
      key: 'anti_ban',
      productName: antiBanProductName,
      amount: antiBanAmount,
      serviceDays: antiBanServiceDays,
      sortOrder: 2,
      isActive: true,
      isNoWarranty: false,
      isAntiBan: true,
      description: '',
      notice: ''
    },
    {
      key: 'no_warranty',
      productName: noWarrantyProductName,
      amount: noWarrantyAmount,
      serviceDays: noWarrantyServiceDays,
      sortOrder: 3,
      isActive: true,
      isNoWarranty: true,
      isAntiBan: false,
      description: '',
      notice: ''
    }
  ]

  const normalizedProducts = (storedProducts || fallbackProducts)
    .map((item) => {
      const fallback = fallbackProducts.find(product => product.key === String(item?.key ?? '').trim().toLowerCase()) || fallbackProducts[0]
      return normalizeProduct(item, fallback)
    })
    .filter(item => item.key && item.productName)

  const uniqueProducts = []
  const seenKeys = new Set()
  for (const product of normalizedProducts) {
    if (seenKeys.has(product.key)) continue
    seenKeys.add(product.key)
    uniqueProducts.push(product)
  }

  cachedSettings = {
    expireMinutes,
    notice,
    products: uniqueProducts.length ? uniqueProducts : fallbackProducts,
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
      antiBanServiceDays: stored.has('purchase_anti_ban_service_days'),
      products: stored.has('purchase_products'),
      notice: stored.has('purchase_notice')
    }
  }
  cachedAt = now
  return cachedSettings
}
