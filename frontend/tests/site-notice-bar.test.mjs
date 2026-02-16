import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const noticeBar = await readFile(new URL('../src/components/SiteNoticeBar.vue', import.meta.url), 'utf8')
const appConfigStore = await readFile(new URL('../src/stores/appConfig.ts', import.meta.url), 'utf8')
const noticeUtil = await readFile(new URL('../src/lib/siteNotice.ts', import.meta.url), 'utf8')

assert.ok(noticeBar.includes("path === '/buy' || path === '/order' || path.startsWith('/purchase')"), '公告条应仅在购买相关页面显示')
assert.ok(noticeBar.includes('DialogContent'), '公告详情应使用弹窗展示')
assert.ok(noticeBar.includes('v-html="noticeHtml"'), '公告详情应展示完整富文本内容')
assert.ok(noticeUtil.includes('**加粗**') || noticeUtil.includes('NOTICE_BOLD_PREFIX'), '公告富文本应支持加粗语法')
assert.ok(noticeUtil.includes('[red]') && noticeUtil.includes('[/red]'), '公告富文本应支持标红语法')
assert.ok(appConfigStore.includes('const siteNotice = ref<SiteNoticeState>'), '运行时配置应包含公告状态')
assert.ok(appConfigStore.includes('if (config.siteNotice && typeof config.siteNotice === \'object\')'), '应在 applyConfig 中处理公告配置')

console.log('site notice bar tests passed')
