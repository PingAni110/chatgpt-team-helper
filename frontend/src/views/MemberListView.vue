<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { gptAccountService, type GptAccount, type SyncUserCountResponse } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'

const accounts = ref<GptAccount[]>([])
const selectedAccountId = ref<string>('')
const loadingAccounts = ref(true)
const loadingMembers = ref(false)
const error = ref('')
const memberSearch = ref('')
const memberResult = ref<SyncUserCountResponse | null>(null)
const { success: showSuccessToast, error: showErrorToast } = useToast()

const loadAccounts = async () => {
  loadingAccounts.value = true
  error.value = ''
  try {
    const response = await gptAccountService.getAll({ page: 1, pageSize: 100 })
    accounts.value = response.accounts || []
    if (accounts.value.length > 0 && !selectedAccountId.value) {
      selectedAccountId.value = String(accounts.value[0]!.id)
    }
  } catch (err: any) {
    error.value = err.response?.data?.error || '加载账号列表失败'
  } finally {
    loadingAccounts.value = false
  }
}

const handleLoadMembers = async () => {
  if (!selectedAccountId.value) {
    showErrorToast('请选择账号')
    return
  }
  const accountId = Number(selectedAccountId.value)
  if (!Number.isFinite(accountId)) {
    showErrorToast('账号ID无效')
    return
  }
  loadingMembers.value = true
  error.value = ''
  try {
    const result = await gptAccountService.syncUserCount(accountId)
    memberResult.value = result
    showSuccessToast('成员列表已更新')
  } catch (err: any) {
    const message = err.response?.data?.error || '加载成员失败'
    error.value = message
    showErrorToast(message)
  } finally {
    loadingMembers.value = false
  }
}

const filteredMembers = computed(() => {
  const items = memberResult.value?.users?.items || []
  const query = memberSearch.value.trim().toLowerCase()
  if (!query) return items
  return items.filter(item => {
    const name = String(item.name || '').toLowerCase()
    const email = String(item.email || '').toLowerCase()
    return name.includes(query) || email.includes(query)
  })
})

onMounted(() => {
  loadAccounts()
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl font-semibold text-gray-900">成员列表</h1>
      <p class="text-sm text-gray-500">选择账号后同步并查看当前成员情况。</p>
    </div>

    <div v-if="error" class="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
      {{ error }}
    </div>

    <Card class="border border-gray-100 shadow-sm">
      <CardHeader class="border-b border-gray-100 bg-gray-50/60">
        <CardTitle class="text-lg font-semibold text-gray-900">筛选</CardTitle>
      </CardHeader>
      <CardContent class="p-6 space-y-4">
        <div class="grid gap-4 md:grid-cols-[1fr_auto]">
          <div class="space-y-2">
            <Label>选择账号</Label>
            <Select v-model="selectedAccountId">
              <SelectTrigger class="h-11">
                <SelectValue placeholder="选择账号" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="account in accounts" :key="account.id" :value="String(account.id)">
                  {{ account.email }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex items-end">
            <Button class="h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white" :disabled="loadingMembers || loadingAccounts" @click="handleLoadMembers">
              {{ loadingMembers ? '同步中...' : '同步成员' }}
            </Button>
          </div>
        </div>

        <div class="space-y-2">
          <Label>搜索成员</Label>
          <Input v-model="memberSearch" placeholder="搜索成员姓名或邮箱..." />
        </div>
      </CardContent>
    </Card>

    <Card class="border border-gray-100 shadow-sm">
      <CardHeader class="border-b border-gray-100 bg-gray-50/60">
        <CardTitle class="text-lg font-semibold text-gray-900">成员详情</CardTitle>
      </CardHeader>
      <CardContent class="p-0">
        <div v-if="loadingAccounts" class="p-6 text-sm text-gray-500">正在加载账号列表...</div>
        <div v-else-if="!memberResult" class="p-6 text-sm text-gray-500">请先同步成员列表。</div>
        <div v-else class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th class="px-6 py-3 text-left font-medium">成员</th>
                <th class="px-6 py-3 text-left font-medium">邮箱</th>
                <th class="px-6 py-3 text-left font-medium">角色</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr v-for="member in filteredMembers" :key="member.id">
                <td class="px-6 py-3 text-gray-900">{{ member.name || '-' }}</td>
                <td class="px-6 py-3 text-gray-600">{{ member.email || '-' }}</td>
                <td class="px-6 py-3 text-gray-600 capitalize">{{ member.role || '-' }}</td>
              </tr>
              <tr v-if="filteredMembers.length === 0">
                <td colspan="3" class="px-6 py-6 text-center text-gray-400">暂无成员数据</td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
