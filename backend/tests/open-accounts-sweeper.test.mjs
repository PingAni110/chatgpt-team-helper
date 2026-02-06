import assert from 'node:assert/strict'
import { selectUsersToKick } from '../src/services/open-accounts-sweeper.js'

const buildUsers = (count) =>
  Array.from({ length: count }, (_, idx) => {
    const order = idx + 1
    return {
      id: `user-${order}`,
      email: `user${order}@example.com`,
      created_time: `2024-01-01T00:00:0${order}.000Z`
    }
  })

const users6 = buildUsers(6)
const users7 = buildUsers(7)
const users8 = buildUsers(8)

const kickFor6 = selectUsersToKick({ users: users6, currentJoined: 6, maxJoinedCount: 5 })
assert.equal(kickFor6.length, 1)
assert.equal(kickFor6[0].id, 'user-6')

const kickFor7 = selectUsersToKick({ users: users7, currentJoined: 7, maxJoinedCount: 5 })
assert.equal(kickFor7.length, 2)
assert.deepEqual(kickFor7.map(user => user.id), ['user-7', 'user-6'])

const kickFor8 = selectUsersToKick({ users: users8, currentJoined: 8, maxJoinedCount: 5 })
assert.equal(kickFor8.length, 3)
assert.deepEqual(kickFor8.map(user => user.id), ['user-8', 'user-7', 'user-6'])

console.log('open-accounts-sweeper tests passed')
