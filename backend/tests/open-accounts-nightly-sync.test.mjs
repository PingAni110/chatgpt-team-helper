import assert from 'node:assert/strict'
import {
  __nightlySyncInternals,
  calculateNextRunTime,
  processAccountsWithConcurrency,
  runOpenAccountsNightlySyncOnce
} from '../src/services/open-accounts-nightly-sync.js'

const localDate = (y, m, d, h, min, s = 0) => new Date(y, m - 1, d, h, min, s, 0)

// 调度时间计算：22点前
{
  const now = localDate(2026, 1, 1, 21, 30)
  const next = calculateNextRunTime(now, { hour: 22, minute: 0 })
  assert.equal(next.getFullYear(), 2026)
  assert.equal(next.getMonth(), 0)
  assert.equal(next.getDate(), 1)
  assert.equal(next.getHours(), 22)
  assert.equal(next.getMinutes(), 0)
}

// 调度时间计算：正好22点，需要跨天
{
  const now = localDate(2026, 1, 1, 22, 0)
  const next = calculateNextRunTime(now, { hour: 22, minute: 0 })
  assert.equal(next.getDate(), 2)
  assert.equal(next.getHours(), 22)
  assert.equal(next.getMinutes(), 0)
}

// 调度时间计算：22点后，需要跨天
{
  const now = localDate(2026, 1, 1, 22, 0, 1)
  const next = calculateNextRunTime(now, { hour: 22, minute: 0 })
  assert.equal(next.getDate(), 2)
  assert.equal(next.getHours(), 22)
  assert.equal(next.getMinutes(), 0)
}

// 执行器：全成功
{
  const summary = await runOpenAccountsNightlySyncOnce({
    concurrency: 2,
    listAccounts: async () => [1, 2, 3],
    syncAccount: async (accountId) => ({ ok: true, accountId })
  })
  assert.equal(summary.total, 3)
  assert.equal(summary.success, 3)
  assert.equal(summary.failed, 0)
}

// 执行器：部分失败不中断
{
  const called = []
  const summary = await runOpenAccountsNightlySyncOnce({
    concurrency: 2,
    listAccounts: async () => [1, 2, 3],
    syncAccount: async (accountId) => {
      called.push(accountId)
      if (accountId === 2) throw Object.assign(new Error('mock failed'), { status: 503 })
      return { ok: true, accountId }
    },
    onAccountError: async () => {}
  })
  assert.deepEqual(called.sort((a, b) => a - b), [1, 2, 3])
  assert.equal(summary.total, 3)
  assert.equal(summary.success, 2)
  assert.equal(summary.failed, 1)
  assert.equal(summary.failures[0].accountId, 2)
}

// 重试生效
{
  let attempt = 0
  const result = await __nightlySyncInternals.runWithRetry(async () => {
    attempt += 1
    if (attempt < 3) {
      const error = new Error('temporary unavailable')
      error.status = 503
      throw error
    }
    return 'ok'
  }, 3)

  assert.equal(result, 'ok')
  assert.equal(attempt, 3)
}

// 并发上限生效
{
  let running = 0
  let maxRunning = 0
  await processAccountsWithConcurrency(
    [1, 2, 3, 4, 5],
    async () => {
      running += 1
      maxRunning = Math.max(maxRunning, running)
      await new Promise(resolve => setTimeout(resolve, 20))
      running -= 1
      return { ok: true }
    },
    2
  )

  assert.ok(maxRunning <= 2)
}

console.log('open-accounts-nightly-sync tests passed')
