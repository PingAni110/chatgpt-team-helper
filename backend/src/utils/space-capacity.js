export const SPACE_MEMBER_LIMIT = 5

const toSafeInt = (value, fallback = 0) => {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.floor(num)
}

export const normalizeMemberCount = (value) => Math.max(0, toSafeInt(value, 0))

export const calcRedeemableSlots = (currentMemberCount, limit = SPACE_MEMBER_LIMIT) => {
  const safeLimit = Math.max(0, toSafeInt(limit, SPACE_MEMBER_LIMIT))
  const safeCurrent = normalizeMemberCount(currentMemberCount)
  return Math.max(0, safeLimit - safeCurrent)
}

export const hasAvailableSeat = ({ userCount = 0, inviteCount = 0, limit = SPACE_MEMBER_LIMIT } = {}) => {
  const safeLimit = Math.max(1, toSafeInt(limit, SPACE_MEMBER_LIMIT))
  const occupied = normalizeMemberCount(userCount) + normalizeMemberCount(inviteCount)
  return occupied < safeLimit
}
