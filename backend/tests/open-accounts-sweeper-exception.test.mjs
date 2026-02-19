import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-acct-sweeper-ex-'))
const dbPath = path.join(tempDir, 'database.sqlite')
process.env.DATABASE_PATH = dbPath

const { initDatabase, getDatabase } = await import('../src/database/init.js')
const {
  mapOpenAccountsSweeperExceptionCode,
  upsertOpenAccountsSweeperException,
  upsertOvercapacityHistory,
} = await import('../src/services/open-accounts-sweeper.js')

await initDatabase()
const db = await getDatabase()

// 扫描失败写入一条记录
let result = await upsertOpenAccountsSweeperException(
  {
    accountId: 301,
    accountName: 'open-301',
    exceptionCode: mapOpenAccountsSweeperExceptionCode({ status: 401, stage: 'worker' }),
    exceptionMessage: 'Token 已过期或无效，请更新账号 token',
  },
  { db, skipSave: true, now: "DATETIME('2024-01-01 10:00:00')" }
)
assert.equal(result.ok, true)

let rows = db.exec('SELECT account_id, exception_type, exception_code, exception_message, source, status FROM account_exception_history WHERE account_id = 301')
assert.equal(rows[0]?.values?.length, 1)
assert.equal(Number(rows[0].values[0][0]), 301)
assert.equal(rows[0].values[0][1], 'open_account_sweeper_failure')
assert.equal(rows[0].values[0][2], 'http_401')
assert.equal(rows[0].values[0][3], 'Token 已过期或无效，请更新账号 token')
assert.equal(rows[0].values[0][4], 'open_accounts_sweeper')
assert.equal(rows[0].values[0][5], 'active')

// 同账号重复失败只更新不新增
await upsertOpenAccountsSweeperException(
  {
    accountId: 301,
    accountName: 'open-301-renamed',
    exceptionCode: 'stage_enforce_account_capacity',
    exceptionMessage: '踢人失败，等待重试',
  },
  { db, skipSave: true, now: "DATETIME('2024-01-02 10:00:00')" }
)

rows = db.exec('SELECT COUNT(*) FROM account_exception_history WHERE account_id = 301')
assert.equal(Number(rows[0].values[0][0]), 1)

rows = db.exec('SELECT account_name, exception_code, exception_message FROM account_exception_history WHERE account_id = 301')
assert.equal(rows[0].values[0][0], 'open-301-renamed')
assert.equal(rows[0].values[0][1], 'stage_enforce_account_capacity')
assert.equal(rows[0].values[0][2], '踢人失败，等待重试')

// 失败消息更新后 last_seen_at 刷新
await upsertOpenAccountsSweeperException(
  {
    accountId: 301,
    accountName: 'open-301-renamed',
    exceptionCode: 'stage_worker',
    exceptionMessage: 'Token 已过期，请重新配置',
  },
  { db, skipSave: true, now: "DATETIME('2024-01-03 10:00:00')" }
)

rows = db.exec('SELECT first_seen_at, last_seen_at, exception_message FROM account_exception_history WHERE account_id = 301')
assert.equal(rows[0].values[0][0], '2024-01-01 10:00:00')
assert.equal(rows[0].values[0][1], '2024-01-03 10:00:00')
assert.equal(rows[0].values[0][2], 'Token 已过期，请重新配置')

// 账号 ID 缺失进入失败队列
result = await upsertOpenAccountsSweeperException(
  {
    accountName: 'missing-account-id',
    exceptionCode: 'stage_worker',
    exceptionMessage: '缺少 account_id',
    rawPayload: { stage: 'worker' },
  },
  { db, skipSave: true }
)
assert.equal(result.ok, false)
assert.equal(result.reason, 'missing_account_id')

rows = db.exec("SELECT source, reason FROM account_exception_parse_failures WHERE source = 'open_accounts_sweeper' ORDER BY rowid DESC LIMIT 1")
assert.equal(rows[0]?.values?.length, 1)
assert.equal(rows[0].values[0][0], 'open_accounts_sweeper')
assert.equal(rows[0].values[0][1], 'missing_account_id')



// 超员检测/已处理/未处理都应写入历史异常
await upsertOvercapacityHistory(
  {
    accountId: 302,
    accountName: 'open-302',
    stage: 'detected',
    beforeJoined: 62,
    joined: 62,
    maxJoinedCount: 60,
  },
  { db, skipSave: true, now: "DATETIME('2024-01-04 10:00:00')" }
)

rows = db.exec('SELECT exception_type, exception_code, status, exception_message FROM account_exception_history WHERE account_id = 302')
assert.equal(rows[0].values[0][0], 'open_account_overcapacity')
assert.equal(rows[0].values[0][1], 'overcapacity_detected')
assert.equal(rows[0].values[0][2], 'active')
assert.match(String(rows[0].values[0][3]), /检测到超员/)

await upsertOvercapacityHistory(
  {
    accountId: 302,
    accountName: 'open-302',
    stage: 'resolved',
    beforeJoined: 62,
    joined: 60,
    maxJoinedCount: 60,
  },
  { db, skipSave: true, now: "DATETIME('2024-01-04 10:05:00')" }
)

rows = db.exec('SELECT exception_code, status, exception_message FROM account_exception_history WHERE account_id = 302')
assert.equal(rows[0].values[0][0], 'overcapacity_resolved')
assert.equal(rows[0].values[0][1], 'resolved')
assert.match(String(rows[0].values[0][2]), /超员已处理/)

await upsertOvercapacityHistory(
  {
    accountId: 302,
    accountName: 'open-302',
    stage: 'active',
    beforeJoined: 62,
    joined: 61,
    maxJoinedCount: 60,
    reason: 'no_standard_users',
  },
  { db, skipSave: true, now: "DATETIME('2024-01-04 10:10:00')" }
)

rows = db.exec('SELECT exception_code, status, exception_message FROM account_exception_history WHERE account_id = 302')
assert.equal(rows[0].values[0][0], 'overcapacity_active')
assert.equal(rows[0].values[0][1], 'active')
assert.match(String(rows[0].values[0][2]), /无可踢用户/)

console.log('open-accounts-sweeper-exception tests passed')
