import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const noticeBar = await readFile(new URL('../src/components/SiteNoticeBar.vue', import.meta.url), 'utf8')
const appConfigStore = await readFile(new URL('../src/stores/appConfig.ts', import.meta.url), 'utf8')

assert.ok(noticeBar.includes("Boolean(notice?.enabled) && Boolean(String(notice?.text || '').trim())"), '公告条应仅在启用且文案非空时显示')
assert.ok(noticeBar.includes('target="_blank"'), '公告链接应在新窗口打开')
assert.ok(noticeBar.includes('rel="noopener noreferrer"'), '公告链接应带上 noopener noreferrer')
assert.ok(appConfigStore.includes('const siteNotice = ref<SiteNoticeState>'), '运行时配置应包含公告状态')
assert.ok(appConfigStore.includes('if (config.siteNotice && typeof config.siteNotice === \'object\')'), '应在 applyConfig 中处理公告配置')

console.log('site notice bar tests passed')
