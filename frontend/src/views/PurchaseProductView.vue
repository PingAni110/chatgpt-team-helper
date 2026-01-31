<template>
  <RedeemShell :maxWidth="'max-w-[560px]'" showUserStatusBar>
    <div class="flex items-center justify-between">
      <RouterLink
        to="/purchase"
        class="inline-flex items-center gap-2 rounded-full bg-white/60 dark:bg-white/10 backdrop-blur-xl border border-white/40 dark:border-white/10 px-4 py-2 text-[13px] font-medium text-[#007AFF] hover:text-[#005FCC] transition-colors"
      >
        <ArrowLeft class="h-4 w-4" />
        返回商品
      </RouterLink>

      <div
        class="inline-flex items-center gap-2.5 rounded-full bg-white/60 dark:bg-white/10 backdrop-blur-xl border border-white/40 dark:border-white/10 px-4 py-1.5 shadow-sm"
      >
        <span class="relative flex h-2.5 w-2.5">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#007AFF]"></span>
        </span>
        <span class="text-[13px] font-medium text-gray-600 dark:text-gray-300 tracking-wide">
          今日库存 · {{ plan?.availableCount ?? meta?.availableCount ?? '...' }} 个
        </span>
      </div>
    </div>

    <div class="text-center space-y-3">
      <h1
        class="text-[34px] leading-tight font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 dark:from-blue-400 dark:via-purple-400 dark:to-pink-400 drop-shadow-sm animate-gradient-x"
      >
        {{ plan?.productName || '商品详情' }}
      </h1>
      <p class="text-[15px] text-[#86868b]">
        {{ tagline }}
      </p>
    </div>

    <div v-if="errorMessage" class="rounded-2xl border border-red-200/70 bg-red-50/60 p-4 text-sm text-red-700">
      {{ errorMessage }}
    </div>

    <div class="relative group perspective-1000">
      <div
        class="absolute -inset-1 bg-gradient-to-r from-blue-600 to-purple-600 rounded-[2rem] blur opacity-25 group-hover:opacity-40 transition duration-700"
      ></div>
      <AppleCard
        variant="glass"
        className="relative overflow-hidden shadow-2xl shadow-black/10 border border-white/40 dark:border-white/10 ring-1 ring-black/5 backdrop-blur-3xl transition-all duration-500 hover:shadow-3xl hover:scale-[1.01]"
      >
        <div class="p-8 sm:p-10 space-y-8">
          <div class="rounded-2xl bg-white/50 dark:bg-black/20 border border-black/5 dark:border-white/10 p-5">
            <div class="flex items-end justify-between gap-6">
              <div>
                <p class="text-[13px] text-[#86868b]">价格</p>
                <p class="text-[38px] leading-none font-extrabold tabular-nums text-[#1d1d1f] dark:text-white">
                  ¥ {{ plan?.amount ?? meta?.amount ?? '...' }}
                </p>
              </div>
              <div class="text-right">
                <p class="text-[13px] text-[#86868b]">服务期</p>
                <p class="text-[15px] font-semibold text-[#1d1d1f] dark:text-white">
                  {{ plan?.serviceDays ?? meta?.serviceDays ?? '...' }} 天
                </p>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <AppleButton type="button" variant="secondary" size="lg" class="h-[44px]" @click="goBack">
              返回列表
            </AppleButton>
            <AppleButton
              type="button"
              variant="primary"
              size="lg"
              class="h-[44px]"
              :disabled="!planKey || isSoldOut"
              @click="openCheckout"
            >
              立即购买
            </AppleButton>
          </div>

          <p v-if="isSoldOut" class="text-[13px] text-[#FF3B30] text-center">
            今日库存不足，请稍后再试。
          </p>

          <div class="pt-6 border-t border-gray-200/60 dark:border-white/10">
            <h4 class="text-[13px] font-semibold text-[#86868b] uppercase tracking-wider mb-4">购买须知</h4>
            <ul class="space-y-3 text-[14px] text-[#1d1d1f]/70 dark:text-white/70">
              <li v-for="(item, idx) in notes" :key="idx" class="flex items-start gap-3">
                <span
                  class="h-1.5 w-1.5 rounded-full mt-2 flex-shrink-0"
                  :class="item.highlight ? 'bg-[#FF3B30]' : 'bg-[#007AFF]'"
                ></span>
                <span :class="item.highlight ? 'text-[#FF3B30] font-medium' : ''">{{ item.text }}</span>
              </li>
            </ul>
          </div>
        </div>
      </AppleCard>
    </div>

    <PurchaseCheckoutDrawer
      v-if="planKey"
      :open="isCheckoutOpen"
      :order-type="planKey"
      :plan="plan"
      :available-count="availableCount"
      @close="isCheckoutOpen = false"
      @refresh-meta="loadMeta"
    />
  </RedeemShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import RedeemShell from '@/components/RedeemShell.vue'
import AppleCard from '@/components/ui/apple/Card.vue'
import AppleButton from '@/components/ui/apple/Button.vue'
import PurchaseCheckoutDrawer from '@/components/purchase/PurchaseCheckoutDrawer.vue'
import { purchaseService, type PurchaseMeta, type PurchasePlan, type PurchaseOrderType } from '@/services/api'
import { ArrowLeft } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()

const meta = ref<PurchaseMeta | null>(null)
const errorMessage = ref('')
const loading = ref(false)
const isCheckoutOpen = ref(false)

const normalizeOrderType = (value: unknown): PurchaseOrderType | null => {
  const raw = Array.isArray(value) ? value[0] : value
  const normalized = String(raw ?? '').trim().toLowerCase()
  return normalized || null
}

const planKey = computed<PurchaseOrderType | null>(() => normalizeOrderType(route.params.productKey))

const plans = computed<PurchasePlan[]>(() => meta.value?.plans || [])

const plan = computed<PurchasePlan | null>(() => {
  if (!planKey.value) return null
  return plans.value.find(item => item.key === planKey.value) || null
})

const availableCount = computed(() => plan.value?.availableCount ?? meta.value?.availableCount ?? 0)
const isSoldOut = computed(() => Number(availableCount.value || 0) <= 0)

const tagline = computed(() => {
  if (plan.value?.isAntiBan) return '防封禁方案，系统将自动使用专用通道完成开通。'
  if (plan.value?.isNoWarranty) return '无质保商品，请确认购买说明后再下单。'
  return '支持质保服务，适合长期使用。'
})

interface NoteItem {
  text: string
  highlight?: boolean
}

const notes = computed<NoteItem[]>(() => {
  const noticeItems = (plan.value?.notice || [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
  if (noticeItems.length) {
    return noticeItems.map(text => ({ text }))
  }
  return [
    { text: '订单信息将发送至填写的邮箱，请确认邮箱可正常收信。' },
    { text: '支付成功后系统自动处理，无需手动兑换。' },
    { text: '如未收到邮件请检查垃圾箱，或使用"查询订单"页进行订单查询。' }
  ]
})

const loadMeta = async () => {
  if (loading.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    meta.value = await purchaseService.getMeta()
  } catch (error: any) {
    errorMessage.value = error?.response?.data?.error || '加载商品信息失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

const goBack = () => {
  router.push('/purchase')
}

const openCheckout = () => {
  if (!planKey.value) return
  if (isSoldOut.value) return
  isCheckoutOpen.value = true
}

onMounted(() => {
  void loadMeta()
})

watch(planKey, () => {
  isCheckoutOpen.value = false
  if (meta.value) return
  void loadMeta()
})
</script>
