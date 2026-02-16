import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const productView = await readFile(new URL('../src/views/PurchaseProductView.vue', import.meta.url), 'utf8')

assert.ok(productView.includes("const redeemEmail = ref('')"), '兑换邮箱默认值应为空字符串')
assert.ok(productView.includes('请输入你的邮箱'), '应展示邮箱辅助提示文案')
assert.ok(productView.includes("redeemErrorMessage.value = '请输入邮箱'"), '邮箱为空时提示应为“请输入邮箱”')
assert.ok(productView.includes("redeemErrorMessage.value = '邮箱格式不正确'"), '邮箱格式错误提示应为“邮箱格式不正确”')
assert.ok(!productView.includes('admin@example.com'), '页面中不应包含 admin@example.com 默认邮箱')

console.log('purchase product email tests passed')
