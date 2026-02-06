import assert from 'node:assert/strict'
import initSqlJs from 'sql.js'
import { normalizeSpaceType, resolveSpaceType, shouldAutoGenerateCodes, SPACE_TYPE_CHILD, SPACE_TYPE_MOTHER } from '../src/utils/space-type.js'

assert.equal(normalizeSpaceType('mother'), SPACE_TYPE_MOTHER)
assert.equal(normalizeSpaceType('parent'), SPACE_TYPE_MOTHER)
assert.equal(normalizeSpaceType('child'), SPACE_TYPE_CHILD)
assert.equal(normalizeSpaceType('sub'), SPACE_TYPE_CHILD)
assert.equal(normalizeSpaceType('unknown', null), null)

assert.equal(resolveSpaceType(undefined), SPACE_TYPE_CHILD)
assert.equal(resolveSpaceType('mother'), SPACE_TYPE_MOTHER)

assert.equal(shouldAutoGenerateCodes('child'), true)
assert.equal(shouldAutoGenerateCodes('mother'), false)

const SQL = await initSqlJs()
const db = new SQL.Database()
db.run(`CREATE TABLE gpt_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, space_type TEXT DEFAULT 'child')`)
db.run(`INSERT INTO gpt_accounts (email, space_type) VALUES ('mother@example.com', 'mother')`)
db.run(`INSERT INTO gpt_accounts (email) VALUES ('child@example.com')`)

const motherRows = db.exec(`SELECT email FROM gpt_accounts WHERE COALESCE(space_type, 'child') = 'mother'`)
const childRows = db.exec(`SELECT email FROM gpt_accounts WHERE COALESCE(space_type, 'child') = 'child'`)

assert.equal(motherRows[0].values.length, 1)
assert.equal(childRows[0].values.length, 1)

console.log('space-type tests passed')
