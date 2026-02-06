import assert from 'node:assert/strict'
import {
  buildSpaceTabQuery,
  createRequestGuard,
  resolveInitialSpaceTab,
  resolveSpaceTab
} from '../src/lib/accounts-view-state.js'

assert.equal(resolveSpaceTab('abnormal'), 'abnormal')
assert.equal(resolveSpaceTab('normal'), 'normal')
assert.equal(resolveSpaceTab('unknown'), 'normal')
assert.equal(resolveSpaceTab(['abnormal']), 'abnormal')

assert.equal(resolveInitialSpaceTab({ queryValue: 'abnormal', storedValue: 'normal' }), 'abnormal')
assert.equal(resolveInitialSpaceTab({ queryValue: undefined, storedValue: 'abnormal' }), 'abnormal')
assert.equal(resolveInitialSpaceTab({ queryValue: undefined, storedValue: undefined }), 'normal')

const query = buildSpaceTabQuery({ foo: 'bar' }, 'abnormal')
assert.deepEqual(query, { foo: 'bar', spaceStatus: 'abnormal' })

const guard = createRequestGuard()
const first = guard.nextId()
assert.equal(guard.isLatest(first), true)
const second = guard.nextId()
assert.equal(guard.isLatest(first), false)
assert.equal(guard.isLatest(second), true)

console.log('accounts-view-state tests passed')
