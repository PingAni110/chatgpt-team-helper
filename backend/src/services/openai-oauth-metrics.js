const counters = {
  exchangeCodeFailure: 0,
  exchangeCodeInvalidGrant: 0,
  refreshLockConflict: 0,
  refreshDuplicateAttempt: 0,
  refreshSuccess: 0
}

export function incMetric(name, value = 1) {
  if (!Object.prototype.hasOwnProperty.call(counters, name)) return
  counters[name] += Number(value) || 0
}

export function getMetricsSnapshot() {
  return { ...counters, timestamp: new Date().toISOString() }
}
