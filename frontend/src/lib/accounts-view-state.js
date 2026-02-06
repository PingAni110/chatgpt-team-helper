export const resolveSpaceTab = (value) => {
  const raw = Array.isArray(value) ? value[0] : value
  return raw === 'abnormal' ? 'abnormal' : 'normal'
}

export const resolveInitialSpaceTab = ({ queryValue, storedValue }) => {
  const normalizedQuery = Array.isArray(queryValue) ? queryValue[0] : queryValue
  if (normalizedQuery === 'abnormal' || normalizedQuery === 'normal') {
    return normalizedQuery
  }
  return resolveSpaceTab(storedValue)
}

export const buildSpaceTabQuery = (query, tab) => {
  const next = resolveSpaceTab(tab)
  return { ...(query || {}), spaceStatus: next }
}

const STORAGE_KEY = 'accountsSpaceTab'

export const readSpaceTabStorage = () => {
  if (typeof sessionStorage === 'undefined') return null
  return sessionStorage.getItem(STORAGE_KEY)
}

export const writeSpaceTabStorage = (tab) => {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(STORAGE_KEY, resolveSpaceTab(tab))
}

export const createRequestGuard = () => {
  let latestId = 0
  return {
    nextId: () => {
      latestId += 1
      return latestId
    },
    isLatest: (id) => id === latestId
  }
}
