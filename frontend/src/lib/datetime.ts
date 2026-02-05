const DEFAULT_LOCALE = 'zh-CN'
const DEFAULT_TIMEZONE = 'Asia/Shanghai'
const formatterCache = new Map<string, Intl.DateTimeFormat>()

const DB_DATETIME_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/
const DB_EXPIRE_AT_REGEX = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}(?::\d{2})?$/
const ISO_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i

function getFormatter(locale: string, timeZone: string) {
  const cacheKey = `${locale}-${timeZone}`
  let formatter = formatterCache.get(cacheKey)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    formatterCache.set(cacheKey, formatter)
  }
  return formatter
}

function parseDate(value: string | number | Date): Date {
  if (value instanceof Date) return value

  if (typeof value === 'number') {
    const normalized = value > 1e12 ? value : value * 1000
    return new Date(normalized)
  }

  const trimmed = String(value || '').trim()
  if (!trimmed) return new Date('')

  if (DB_DATETIME_REGEX.test(trimmed)) {
    const normalized = trimmed.replace(' ', 'T')
    return new Date(normalized)
  }

  if (DB_EXPIRE_AT_REGEX.test(trimmed)) {
    const normalized = trimmed.replace(/\//g, '-').replace(' ', 'T')
    return new Date(normalized)
  }

  if (/^\d+$/.test(trimmed)) {
    const asNumber = Number(trimmed)
    if (Number.isFinite(asNumber)) {
      const normalized = asNumber > 1e12 ? asNumber : asNumber * 1000
      return new Date(normalized)
    }
  }

  if (ISO_REGEX.test(trimmed)) {
    return new Date(trimmed)
  }

  return new Date(trimmed.replace(/\//g, '-'))
}

export interface DateFormatOptions {
  locale?: string
  timeZone?: string
}

export function formatShanghaiDate(
  value?: string | number | Date | null,
  options?: DateFormatOptions,
): string {
  if (!value) return '-'
  try {
    const date = parseDate(value)
    if (Number.isNaN(date.getTime())) return '-'

    const locale = options?.locale || DEFAULT_LOCALE
    const timeZone = options?.timeZone || DEFAULT_TIMEZONE
    const parts = getFormatter(locale, timeZone).formatToParts(date)
    const pick = (type: string) => parts.find((part) => part.type === type)?.value || ''
    return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}`
  } catch (error) {
    console.warn('formatShanghaiDate failed:', error)
    return '-'
  }
}
