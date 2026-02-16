import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const routerText = await readFile(new URL('../src/router/index.ts', import.meta.url), 'utf8')
const menuText = await readFile(new URL('../src/lib/adminMenus.ts', import.meta.url), 'utf8')
const viewText = await readFile(new URL('../src/views/history-exceptions/HistoryExceptionsView.vue', import.meta.url), 'utf8')

assert.ok(routerText.includes("path: 'history-exceptions'"), 'router should register history-exceptions route')
assert.ok(routerText.includes("requiredMenuKey: 'history_exception:view'"), 'route should require history_exception:view')
assert.ok(menuText.includes("history_exceptions"), 'admin menu should include history_exceptions')
assert.ok(viewText.includes('历史异常'), 'view should render 历史异常 title')

console.log('history-exceptions sanity tests passed')
