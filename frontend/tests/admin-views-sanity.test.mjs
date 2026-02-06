import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const accountsView = await readFile(new URL('../src/views/AccountsView.vue', import.meta.url), 'utf8')
const productView = await readFile(new URL('../src/views/ProductManagementView.vue', import.meta.url), 'utf8')

assert.ok(!accountsView.includes('空间归属'), 'AccountsView should not render space affiliation')
assert.ok(!productView.includes('卖点'), 'ProductManagementView should not render selling points')
assert.ok(!productView.includes('featuresText'), 'ProductManagementView should not include selling points field')

console.log('admin views sanity tests passed')
