export const SPACE_TYPE_MOTHER = 'mother'
export const SPACE_TYPE_CHILD = 'child'

const normalizeRaw = (value) => String(value ?? '').trim().toLowerCase()

export const normalizeSpaceType = (value, fallback = null) => {
  const raw = normalizeRaw(value)
  if (!raw) return fallback
  if (['mother', 'parent', 'main'].includes(raw)) return SPACE_TYPE_MOTHER
  if (['child', 'sub', 'secondary'].includes(raw)) return SPACE_TYPE_CHILD
  return fallback
}

export const resolveSpaceType = (value) => normalizeSpaceType(value, SPACE_TYPE_CHILD)

export const shouldAutoGenerateCodes = (spaceType) => resolveSpaceType(spaceType) === SPACE_TYPE_CHILD
