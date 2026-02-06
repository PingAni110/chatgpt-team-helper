import assert from 'node:assert/strict'
import { SPACE_MEMBER_LIMIT, calcRedeemableSlots, hasAvailableSeat } from '../src/utils/space-capacity.js'
import { withLocks } from '../src/utils/locks.js'

// 1. 创建空间后人数=1 -> 兑换码=4
assert.equal(calcRedeemableSlots(1), 4)

// 1.1 创建空间后人数=0 -> 兑换码=5
assert.equal(calcRedeemableSlots(0), 5)

// 2. 创建空间后人数=3 -> 兑换码=2
assert.equal(calcRedeemableSlots(3), 2)

// 3. 创建空间后人数=5 -> 兑换码=0
assert.equal(calcRedeemableSlots(5), 0)

// 历史脏数据 > 5 -> 兑换码仍为 0
assert.equal(calcRedeemableSlots(8), 0)

// 4. 人数=5 时禁止继续加入
assert.equal(hasAvailableSeat({ userCount: 5, inviteCount: 0, limit: SPACE_MEMBER_LIMIT }), false)
assert.equal(hasAvailableSeat({ userCount: 4, inviteCount: 1, limit: SPACE_MEMBER_LIMIT }), false)

// 5. 并发加入模拟：使用锁确保最终不会超过 5
let occupied = 4
const join = async (idx) => withLocks(['test-space:1'], async () => {
  const allowed = occupied < SPACE_MEMBER_LIMIT
  if (allowed) occupied += 1
  return { idx, allowed }
})

const results = await Promise.all(Array.from({ length: 6 }, (_, i) => join(i)))
const success = results.filter(r => r.allowed).length
assert.equal(success, 1)
assert.equal(occupied, 5)

console.log('space-capacity tests passed')
