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

const formatExpireAtOutput = (value) => {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  if (EXPIRE_AT_REGEX.test(raw)) return raw
  const asNumber = Number(raw)
  if (Number.isFinite(asNumber) && asNumber > 0) {
    const ms = asNumber > 1e11 ? asNumber : asNumber * 1000
    const date = new Date(ms)
    if (!Number.isNaN(date.getTime())) {
      return formatExpireAt(date)
    }
  }
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) {
    return formatExpireAt(parsed)
  }
  return raw
}

export { formatExpireAt, formatExpireAtOutput, EXPIRE_AT_REGEX }
