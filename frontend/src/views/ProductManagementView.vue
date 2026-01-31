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
  productName: '',
  amount: '',
  serviceDays: 30,
  expireMinutes: 15,
  noWarrantyProductName: '',
  noWarrantyAmount: '',
  noWarrantyServiceDays: 30,
  antiBanProductName: '',
  antiBanAmount: '',
  antiBanServiceDays: 30
})

const loadSettings = async () => {
  loading.value = true
  error.value = ''
  try {
    const response = await adminService.getPurchaseSettings()
    const plans = response.purchase.plans
    formData.value = {
      productName: plans.warranty.productName,
      amount: plans.warranty.amount,
      serviceDays: plans.warranty.serviceDays,
      expireMinutes: response.purchase.expireMinutes,
      noWarrantyProductName: plans.noWarranty.productName,
      noWarrantyAmount: plans.noWarranty.amount,
      noWarrantyServiceDays: plans.noWarranty.serviceDays,
      antiBanProductName: plans.antiBan.productName,
      antiBanAmount: plans.antiBan.amount,
      antiBanServiceDays: plans.antiBan.serviceDays
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
      ...formData.value
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
            <Label>商品名称</Label>
            <Input v-model="formData.productName" placeholder="通用渠道激活码" />
          </div>
          <div class="space-y-2">
            <Label>价格（元）</Label>
            <Input v-model="formData.amount" placeholder="1.00" />
          </div>
          <div class="space-y-2">
            <Label>服务期（天）</Label>
            <Input v-model.number="formData.serviceDays" type="number" min="1" />
          </div>
          <div class="space-y-2">
            <Label>订单过期时间（分钟）</Label>
            <Input v-model.number="formData.expireMinutes" type="number" min="5" />
          </div>
        </div>
      </CardContent>
    </Card>

    <Card class="border border-gray-100 shadow-sm">
      <CardHeader class="border-b border-gray-100 bg-gray-50/60">
        <CardTitle class="text-lg font-semibold text-gray-900">无质保商品</CardTitle>
      </CardHeader>
      <CardContent class="p-6 space-y-4">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="space-y-2">
            <Label>商品名称</Label>
            <Input v-model="formData.noWarrantyProductName" placeholder="通用渠道激活码（无质保）" />
          </div>
          <div class="space-y-2">
            <Label>价格（元）</Label>
            <Input v-model="formData.noWarrantyAmount" placeholder="5.00" />
          </div>
          <div class="space-y-2">
            <Label>服务期（天）</Label>
            <Input v-model.number="formData.noWarrantyServiceDays" type="number" min="1" />
          </div>
        </div>
      </CardContent>
    </Card>

    <Card class="border border-gray-100 shadow-sm">
      <CardHeader class="border-b border-gray-100 bg-gray-50/60">
        <CardTitle class="text-lg font-semibold text-gray-900">防封禁商品</CardTitle>
      </CardHeader>
      <CardContent class="p-6 space-y-4">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="space-y-2">
            <Label>商品名称</Label>
            <Input v-model="formData.antiBanProductName" placeholder="通用渠道激活码(防封禁)" />
          </div>
          <div class="space-y-2">
            <Label>价格（元）</Label>
            <Input v-model="formData.antiBanAmount" placeholder="10.00" />
          </div>
          <div class="space-y-2">
            <Label>服务期（天）</Label>
            <Input v-model.number="formData.antiBanServiceDays" type="number" min="1" />
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
