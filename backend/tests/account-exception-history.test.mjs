import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-ex-history-'))
const dbPath = path.join(tempDir, 'database.sqlite')
process.env.DATABASE_PATH = dbPath

const { initDatabase, getDatabase } = await import('../src/database/init.js')
const {
  upsertAccountExceptionHistory,
  normalizeHistoryExceptionStatus,
} = await import('../src/services/account-exception-history.js')

await initDatabase()
const db = await getDatabase()

// 新账号异常插入
await upsertAccountExceptionHistory({
  accountId: 101,
  accountName: 'acc-101',
  exceptionType: 'invite_failed',
  exceptionCode: 'INVITE_FAILED',
  exceptionMessage: '邀请失败',
  source: 'unit_test',
}, { db, skipSave: true })

let result = db.exec('SELECT account_id, exception_type, exception_code, status FROM account_exception_history WHERE account_id = 101')
assert.equal(result[0]?.values?.length, 1)
assert.equal(result[0].values[0][1], 'invite_failed')
assert.equal(result[0].values[0][2], 'INVITE_FAILED')
assert.equal(result[0].values[0][3], 'active')

// 同账号重复异常仅更新不新增
await upsertAccountExceptionHistory({
  accountId: 101,
  accountName: 'acc-101-renamed',
  exceptionType: 'account_not_found',
  exceptionCode: 'ACCOUNT_NOT_FOUND',
  exceptionMessage: '账号不存在',
  source: 'unit_test',
  status: 'resolved',
}, { db, skipSave: true })

result = db.exec('SELECT COUNT(*) FROM account_exception_history WHERE account_id = 101')
assert.equal(Number(result[0].values[0][0]), 1)

result = db.exec('SELECT account_name, exception_type, exception_code, status FROM account_exception_history WHERE account_id = 101')
assert.equal(result[0].values[0][0], 'acc-101-renamed')
assert.equal(result[0].values[0][1], 'account_not_found')
assert.equal(result[0].values[0][2], 'ACCOUNT_NOT_FOUND')
assert.equal(result[0].values[0][3], 'resolved')

// 并发 upsert 不产生重复行
await Promise.all(
  Array.from({ length: 10 }, (_, index) => {
    return upsertAccountExceptionHistory({
      accountId: 202,
      accountName: `acc-202-${index}`,
      exceptionType: 'invite_failed',
      exceptionCode: `INVITE_${index}`,
      exceptionMessage: `错误-${index}`,
      source: 'unit_test',
      status: index % 2 ? 'active' : 'ignored',
    }, { db, skipSave: true })
  })
)

result = db.exec('SELECT COUNT(*) FROM account_exception_history WHERE account_id = 202')
assert.equal(Number(result[0].values[0][0]), 1)

// 缺少 account_id 写入待人工处理记录
await upsertAccountExceptionHistory({
  accountName: 'missing-id',
  exceptionType: 'parse_failed',
  source: 'unit_test',
}, { db, skipSave: true })

result = db.exec("SELECT COUNT(*) FROM account_exception_parse_failures WHERE reason = 'missing_account_id'")
assert.equal(Number(result[0].values[0][0]), 1)

// 状态枚举校验
assert.equal(normalizeHistoryExceptionStatus('resolved'), 'resolved')
assert.equal(normalizeHistoryExceptionStatus('invalid_status'), 'active')

console.log('account-exception-history tests passed')
