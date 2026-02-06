export type SpaceTab = 'normal' | 'abnormal'

export function resolveSpaceTab(value: unknown): SpaceTab

export function resolveInitialSpaceTab(args: {
  queryValue: unknown
  storedValue: unknown
}): SpaceTab

export function buildSpaceTabQuery(
  query: Record<string, unknown>,
  tab: SpaceTab | string | null | undefined
): Record<string, unknown>

export function readSpaceTabStorage(): string | null

export function writeSpaceTabStorage(tab: SpaceTab | string | null | undefined): void

export function resolveSpaceType(value: unknown): 'mother' | 'child'

export function resolveInitialSpaceType(args: {
  queryValue: unknown
  storedValue: unknown
}): 'mother' | 'child'

export function buildSpaceTypeQuery(
  query: Record<string, unknown>,
  value: 'mother' | 'child' | string | null | undefined
): Record<string, unknown>

export function readSpaceTypeStorage(): string | null

export function writeSpaceTypeStorage(value: 'mother' | 'child' | string | null | undefined): void

export function createRequestGuard(): {
  nextId(): number
  isLatest(id: number): boolean
}
