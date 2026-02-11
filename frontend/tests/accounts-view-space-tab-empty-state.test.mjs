import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/views/AccountsView.vue', import.meta.url), 'utf-8')

const tabBlockStart = source.indexOf('<div class="px-6 pt-5">')
const loadingMarker = source.indexOf('<!-- Loading State -->')
const emptyMarker = source.indexOf('<!-- Empty State -->')
const tableMarker = source.indexOf('<!-- Table & Mobile List -->')

assert.ok(tabBlockStart > -1, '应渲染空间切换按钮容器')
assert.ok(loadingMarker > tabBlockStart, '切换按钮应位于加载态之前，保证主内容区顶部始终可见')
assert.ok(emptyMarker > tabBlockStart, '切换按钮应位于空状态之前')
assert.ok(tableMarker > tabBlockStart, '切换按钮应位于表格列表之前')

assert.match(source, /@click="handleSpaceTabChange\('normal'\)"/, '正常空间按钮应绑定切换交互')
assert.match(source, /@click="handleSpaceTabChange\('abnormal'\)"/, '异常空间按钮应绑定切换交互')

const emptyBranchStart = source.indexOf('<div v-else-if="accounts.length === 0"')
const emptyBranchEnd = source.indexOf('<!-- Table & Mobile List -->')
const emptyBranch = source.slice(emptyBranchStart, emptyBranchEnd)
assert.doesNotMatch(emptyBranch, /handleSpaceTabChange\('/, '空状态分支不应包裹空间切换按钮，避免异常空间空结果时无法切回正常空间')

console.log('accounts view space tab empty-state tests passed')
