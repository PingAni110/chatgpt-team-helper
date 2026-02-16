import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const menuFile = await readFile(new URL('../src/lib/adminMenus.ts', import.meta.url), 'utf8')
const routerFile = await readFile(new URL('../src/router/index.ts', import.meta.url), 'utf8')
const settingsView = await readFile(new URL('../src/views/SettingsView.vue', import.meta.url), 'utf8')

assert.ok(menuFile.includes("product_management_site_notice"), '商品管理菜单下应包含公告设置子菜单')
assert.ok(routerFile.includes("path: 'product-management/site-notice'"), '路由应包含公告设置页面')
assert.ok(routerFile.includes("requiredMenuKey: 'product_management_site_notice'"), '公告设置路由应绑定独立菜单权限')
assert.ok(!settingsView.includes('站点公告'), '系统设置页面不应继续展示公告配置卡片')

console.log('site notice settings menu tests passed')
