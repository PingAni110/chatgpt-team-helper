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

export function createRequestGuard(): {
  nextId(): number
  isLatest(id: number): boolean
}
