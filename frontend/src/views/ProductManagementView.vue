<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { authService, purchaseService, type PurchaseAdminProductItem, type PurchaseFeatureItem, type PurchaseOrderType } from '@/services/api'
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'

const router = useRouter()
const { success: showSuccessToast, error: showErrorToast } = useToast()

const loading = ref(false)
const items = ref<PurchaseAdminProductItem[]>([])
const search = ref('')
const statusFilter = ref<'all' | 'enabled' | 'disabled'>('all')
const pagination = ref({ page: 1, pageSize: 20, total: 0 })

const showDialog = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)

const form = ref({
  orderType: 'warranty' as PurchaseOrderType,
  title: '',
  price: '1.00',
  durationDays: 30,
  badge: '质保',
  description: '',
  status: 'enabled' as 'enabled' | 'disabled',
  sortOrder: 0,
  featuresText: '支持退款 / 补号\n支付成功后系统自动处理'
})

const parseFeatures = (value: string): PurchaseFeatureItem[] => {
  return String(value || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.startsWith('!')) {
        return { type: 'warn' as const, text: line.slice(1).trim() }
      }
      return { type: 'normal' as const, text: line }
    })
    .filter(item => item.text)
}

const stringifyFeatures = (features?: PurchaseFeatureItem[]) => {
  return (features || []).map(item => item.type === 'warn' ? `!${item.text}` : item.text).join('\n')
}

const resetForm = () => {
  editingId.value = null
  form.value = {
    orderType: 'warranty',
    title: '',
    price: '1.00',
    durationDays: 30,
    badge: '质保',
    description: '',
    status: 'enabled',
    sortOrder: 0,
    featuresText: '支持退款 / 补号\n支付成功后系统自动处理'
  }
}

const loadProducts = async () => {
  loading.value = true
  try {
    const res = await purchaseService.adminListProducts({
      page: pagination.value.page,
      pageSize: pagination.value.pageSize,
      search: search.value.trim() || undefined,
      status: statusFilter.value
    })
    items.value = res.items || []
    pagination.value = res.pagination || pagination.value
  } catch (err: any) {
    showErrorToast(err?.response?.data?.error || '加载商品失败')
    if (err?.response?.status === 401 || err?.response?.status === 403) {
      authService.logout()
      router.push('/login')
    }
  } finally {
    loading.value = false
  }
}

const openCreate = () => {
  resetForm()
  showDialog.value = true
}

const openEdit = (item: PurchaseAdminProductItem) => {
  editingId.value = item.id
  form.value = {
    orderType: item.orderType,
    title: item.title,
    price: item.price,
    durationDays: item.durationDays,
    badge: item.badge,
    description: item.description || '',
    status: item.status,
    sortOrder: item.sortOrder,
    featuresText: stringifyFeatures(item.features)
  }
  showDialog.value = true
}

const saveProduct = async () => {
  const payload = {
    orderType: form.value.orderType,
    title: form.value.title.trim(),
    price: form.value.price,
    durationDays: Number(form.value.durationDays),
    badge: form.value.badge.trim(),
    description: form.value.description.trim(),
    status: form.value.status,
    sortOrder: Number(form.value.sortOrder || 0),
    features: parseFeatures(form.value.featuresText)
  }

  if (!payload.title) return showErrorToast('商品名称不能为空')
  if (!Number.isFinite(Number(payload.price)) || Number(payload.price) < 0) return showErrorToast('价格必须为非负数')
  if (!Number.isInteger(payload.durationDays) || payload.durationDays <= 0) return showErrorToast('服务期必须为正整数天')

  saving.value = true
  try {
    if (editingId.value) {
      await purchaseService.adminUpdateProduct(editingId.value, payload)
      showSuccessToast('商品更新成功')
    } else {
      await purchaseService.adminCreateProduct(payload)
      showSuccessToast('商品创建成功')
    }
    showDialog.value = false
    await loadProducts()
  } catch (err: any) {
    showErrorToast(err?.response?.data?.error || '保存失败')
  } finally {
    saving.value = false
  }
}

const toggleStatus = async (item: PurchaseAdminProductItem) => {
  try {
    await purchaseService.adminToggleProductStatus(item.id, item.status === 'enabled' ? 'disabled' : 'enabled')
    showSuccessToast('状态已更新')
    await loadProducts()
  } catch (err: any) {
    showErrorToast(err?.response?.data?.error || '状态更新失败')
  }
}

const deleteProduct = async (item: PurchaseAdminProductItem) => {
  if (!confirm(`确认删除商品「${item.title}」吗？`)) return
  try {
    const res = await purchaseService.adminDeleteProduct(item.id)
    showSuccessToast(res.message || '删除成功')
    await loadProducts()
  } catch (err: any) {
    showErrorToast(err?.response?.data?.error || '删除失败')
  }
}

const move = async (item: PurchaseAdminProductItem, direction: 'up' | 'down') => {
  const idx = items.value.findIndex(i => i.id === item.id)
  const target = direction === 'up' ? idx - 1 : idx + 1
  if (idx < 0 || target < 0 || target >= items.value.length) return
  const next = [...items.value]
  const current = next[idx]
  const targetItem = next[target]
  if (!current || !targetItem) return
  next[idx] = targetItem
  next[target] = current
  items.value = next
  try {
    await purchaseService.adminReorderProducts(next.map(i => i.id))
  } catch {
    await loadProducts()
  }
}

const totalPages = computed(() => Math.max(1, Math.ceil(pagination.value.total / pagination.value.pageSize)))

onMounted(() => {
  loadProducts()
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <Input v-model="search" placeholder="搜索商品名称" class="w-64" @keyup.enter="loadProducts" />
        <Select v-model="statusFilter" @update:model-value="loadProducts">
          <SelectTrigger class="w-40"><SelectValue placeholder="状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="enabled">已上架</SelectItem>
            <SelectItem value="disabled">已下架</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" @click="loadProducts">查询</Button>
      </div>
      <Button @click="openCreate">新增商品</Button>
    </div>

    <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 text-gray-500">
          <tr>
            <th class="px-4 py-3 text-left">排序</th>
            <th class="px-4 py-3 text-left">名称</th>
            <th class="px-4 py-3 text-left">价格</th>
            <th class="px-4 py-3 text-left">服务期</th>
            <th class="px-4 py-3 text-left">标签</th>
            <th class="px-4 py-3 text-left">状态</th>
            <th class="px-4 py-3 text-left">更新时间</th>
            <th class="px-4 py-3 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="8" class="px-4 py-8 text-center text-gray-400">加载中...</td></tr>
          <tr v-else-if="items.length===0"><td colspan="8" class="px-4 py-8 text-center text-gray-400">暂无商品</td></tr>
          <tr v-for="item in items" :key="item.id" class="border-t">
            <td class="px-4 py-3">
              <div class="flex gap-1">
                <Button size="sm" variant="ghost" @click="move(item,'up')">↑</Button>
                <Button size="sm" variant="ghost" @click="move(item,'down')">↓</Button>
              </div>
            </td>
            <td class="px-4 py-3 font-medium">{{ item.title }}</td>
            <td class="px-4 py-3">¥{{ item.price }}</td>
            <td class="px-4 py-3">{{ item.durationDays }} 天</td>
            <td class="px-4 py-3">{{ item.badge }}</td>
            <td class="px-4 py-3">{{ item.status === 'enabled' ? '上架' : '下架' }}</td>
            <td class="px-4 py-3">{{ item.updatedAt }}</td>
            <td class="px-4 py-3 text-right space-x-2">
              <Button size="sm" variant="outline" @click="openEdit(item)">编辑</Button>
              <Button size="sm" variant="outline" @click="toggleStatus(item)">{{ item.status === 'enabled' ? '下架' : '上架' }}</Button>
              <Button size="sm" variant="outline" class="text-red-600" @click="deleteProduct(item)">删除</Button>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="px-4 py-3 border-t text-sm text-gray-500 flex items-center justify-between">
        <span>第 {{ pagination.page }} / {{ totalPages }} 页，共 {{ pagination.total }} 条</span>
        <div class="space-x-2">
          <Button size="sm" variant="outline" :disabled="pagination.page<=1" @click="pagination.page-=1;loadProducts()">上一页</Button>
          <Button size="sm" variant="outline" :disabled="pagination.page>=totalPages" @click="pagination.page+=1;loadProducts()">下一页</Button>
        </div>
      </div>
    </div>

    <Dialog v-model:open="showDialog">
      <DialogContent class="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>{{ editingId ? '编辑商品' : '新增商品' }}</DialogTitle>
        </DialogHeader>
        <div class="grid grid-cols-2 gap-4 py-2">
          <div>
            <div class="text-sm mb-1">商品类型</div>
            <Select v-model="form.orderType">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="warranty">质保</SelectItem>
                <SelectItem value="anti_ban">防封禁</SelectItem>
                <SelectItem value="no_warranty">无质保</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <div class="text-sm mb-1">标签</div>
            <Input v-model="form.badge" />
          </div>
          <div class="col-span-2">
            <div class="text-sm mb-1">商品名称</div>
            <Input v-model="form.title" />
          </div>
          <div>
            <div class="text-sm mb-1">价格</div>
            <Input v-model="form.price" />
          </div>
          <div>
            <div class="text-sm mb-1">服务期（天）</div>
            <Input v-model.number="form.durationDays" type="number" min="1" />
          </div>
          <div>
            <div class="text-sm mb-1">状态</div>
            <Select v-model="form.status">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="enabled">上架</SelectItem>
                <SelectItem value="disabled">下架</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <div class="text-sm mb-1">排序</div>
            <Input v-model.number="form.sortOrder" type="number" min="0" />
          </div>
          <div class="col-span-2">
            <div class="text-sm mb-1">卖点（每行一条，红点请以 ! 开头）</div>
            <textarea v-model="form.featuresText" class="w-full min-h-28 border rounded-md px-3 py-2 text-sm"></textarea>
          </div>
          <div class="col-span-2">
            <div class="text-sm mb-1">备注</div>
            <Input v-model="form.description" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showDialog=false">取消</Button>
          <Button :disabled="saving" @click="saveProduct">保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
