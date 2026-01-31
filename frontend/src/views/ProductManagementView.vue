<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { adminService } from '@/services/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'

const loading = ref(true)
const saving = ref(false)
const error = ref('')
const { success: showSuccessToast, error: showErrorToast } = useToast()

const formData = ref({
  expireMinutes: 15,
  products: [] as Array<{
    key: string
    productName: string
    amount: string
    serviceDays: number
    sortOrder?: number
    isActive?: boolean
    isNoWarranty?: boolean
    isAntiBan?: boolean
    notice?: string
  }>
})

const loadSettings = async () => {
  loading.value = true
  error.value = ''
  try {
    const response = await adminService.getPurchaseSettings()
    const products = response.purchase.products || []
    formData.value = {
      expireMinutes: response.purchase.expireMinutes,
      products: products.map(item => ({
        key: item.key,
        productName: item.productName,
        amount: item.amount,
        serviceDays: item.serviceDays,
        sortOrder: item.sortOrder ?? 0,
        isActive: item.isActive !== false,
        isNoWarranty: Boolean(item.isNoWarranty),
        isAntiBan: Boolean(item.isAntiBan),
        notice: item.notice || ''
      }))
    }
  } catch (err: any) {
    error.value = err.response?.data?.error || '加载商品配置失败'
  } finally {
    loading.value = false
  }
}

const handleSave = async () => {
  saving.value = true
  error.value = ''
  try {
    await adminService.updatePurchaseSettings({
      expireMinutes: formData.value.expireMinutes,
      products: formData.value.products
    })
    showSuccessToast('商品配置已更新')
    await loadSettings()
  } catch (err: any) {
    const message = err.response?.data?.error || '保存失败，请稍后重试'
    error.value = message
    showErrorToast(message)
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  loadSettings()
})

const addProduct = () => {
  formData.value.products.push({
    key: '',
    productName: '',
    amount: '1.00',
    serviceDays: 30,
    sortOrder: formData.value.products.length + 1,
    isActive: true,
    isNoWarranty: false,
    isAntiBan: false,
    notice: ''
  })
}

const removeProduct = (index: number) => {
  formData.value.products.splice(index, 1)
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl font-semibold text-gray-900">商品管理</h1>
      <p class="text-sm text-gray-500">在这里调整各类商品名称、价格与服务期。</p>
    </div>

    <div v-if="error" class="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
      {{ error }}
    </div>

    <Card class="border border-gray-100 shadow-sm">
      <CardHeader class="border-b border-gray-100 bg-gray-50/60">
        <CardTitle class="text-lg font-semibold text-gray-900">基础设置</CardTitle>
      </CardHeader>
      <CardContent class="p-6 space-y-4">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="space-y-2">
            <Label>订单过期时间（分钟）</Label>
            <Input v-model.number="formData.expireMinutes" type="number" min="5" />
          </div>
        </div>
      </CardContent>
    </Card>

    <Card class="border border-gray-100 shadow-sm">
      <CardHeader class="border-b border-gray-100 bg-gray-50/60 flex flex-row items-center justify-between">
        <CardTitle class="text-lg font-semibold text-gray-900">商品列表</CardTitle>
        <Button size="sm" variant="outline" class="rounded-lg text-xs h-8 border-gray-200" @click="addProduct">
          新增商品
        </Button>
      </CardHeader>
      <CardContent class="p-6 space-y-6">
        <div v-if="formData.products.length === 0" class="text-sm text-gray-500">暂无商品，请添加商品。</div>
        <div v-for="(product, index) in formData.products" :key="index" class="border border-gray-100 rounded-2xl p-4 space-y-4">
          <div class="flex items-center justify-between">
            <h4 class="text-sm font-semibold text-gray-900">商品 #{{ index + 1 }}</h4>
            <Button size="sm" variant="ghost" class="text-red-500 hover:text-red-600" @click="removeProduct(index)">
              删除
            </Button>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <div class="space-y-2">
              <Label>商品标识（key）</Label>
              <Input v-model="product.key" placeholder="warranty" />
            </div>
            <div class="space-y-2">
              <Label>商品名称</Label>
              <Input v-model="product.productName" placeholder="通用渠道激活码" />
            </div>
            <div class="space-y-2">
              <Label>价格（元）</Label>
              <Input v-model="product.amount" placeholder="1.00" />
            </div>
            <div class="space-y-2">
              <Label>服务期（天）</Label>
              <Input v-model.number="product.serviceDays" type="number" min="1" />
            </div>
            <div class="space-y-2">
              <Label>排序</Label>
              <Input v-model.number="product.sortOrder" type="number" min="0" />
            </div>
            <div class="space-y-2 md:col-span-2">
              <Label>购买须知</Label>
              <textarea
                v-model="product.notice"
                rows="3"
                class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="每行一条购买须知"
              ></textarea>
            </div>
          </div>
          <div class="grid gap-4 md:grid-cols-3">
            <label class="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" v-model="product.isActive" class="h-4 w-4 rounded border-gray-300" />
              上架
            </label>
            <label class="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" v-model="product.isNoWarranty" class="h-4 w-4 rounded border-gray-300" />
              无质保
            </label>
            <label class="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" v-model="product.isAntiBan" class="h-4 w-4 rounded border-gray-300" />
              防封禁
            </label>
          </div>
        </div>
      </CardContent>
    </Card>

    <div class="flex items-center justify-end gap-3">
      <Button variant="outline" class="rounded-xl" :disabled="loading || saving" @click="loadSettings">
        重新加载
      </Button>
      <Button class="rounded-xl bg-blue-600 hover:bg-blue-700 text-white" :disabled="loading || saving" @click="handleSave">
        {{ saving ? '保存中...' : '保存配置' }}
      </Button>
    </div>

    <div v-if="loading" class="text-sm text-gray-500">正在加载商品配置...</div>
  </div>
</template>
