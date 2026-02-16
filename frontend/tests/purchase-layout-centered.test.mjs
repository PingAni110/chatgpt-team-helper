import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const catalogView = await readFile(new URL('../src/views/PurchaseCatalogView.vue', import.meta.url), 'utf8')
const productView = await readFile(new URL('../src/views/PurchaseProductView.vue', import.meta.url), 'utf8')

assert.ok(catalogView.includes("mx-auto w-full max-w-6xl"), '购买列表页应使用居中主容器')
assert.ok(catalogView.includes('mx-auto grid w-full'), '购买列表页商品网格应居中布局')
assert.ok(productView.includes("mx-auto w-full max-w-3xl"), '购买详情页应使用居中主容器')
assert.ok(productView.includes("<RedeemShell :maxWidth="), '购买详情页应保留外层容器约束')

console.log('purchase layout centered tests passed')
