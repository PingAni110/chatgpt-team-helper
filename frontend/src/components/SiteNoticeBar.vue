<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAppConfigStore } from '@/stores/appConfig'
import { extractSiteNoticePlainText, renderSiteNoticeRichText } from '@/lib/siteNotice'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const appConfigStore = useAppConfigStore()
const route = useRoute()
const dialogOpen = ref(false)

const path = computed(() => String(route.path || ''))
const isPurchaseRoute = computed(() => {
  return path.value === '/buy' || path.value === '/order' || path.value.startsWith('/purchase')
})

// 购买页存在右上角悬浮用户状态区，为避免公告内容/按钮被覆盖，预留右侧安全间距。
const needsUserStatusSafeArea = computed(() => {
  return path.value === '/buy' || path.value.startsWith('/purchase')
})

const contentSafeAreaClass = computed(() => {
  return needsUserStatusSafeArea.value ? 'sm:pr-[18rem] lg:pr-[22rem]' : ''
})

const actionSafeAreaClass = computed(() => {
  return needsUserStatusSafeArea.value ? 'sm:mr-[18rem] lg:mr-[22rem]' : ''
})

const visible = computed(() => {
  const notice = appConfigStore.siteNotice
  return isPurchaseRoute.value && Boolean(notice?.enabled) && Boolean(String(notice?.text || '').trim())
})

const noticeText = computed(() => String(appConfigStore.siteNotice?.text || '').trim())
const noticePreview = computed(() => extractSiteNoticePlainText(noticeText.value, 72))
const noticeHtml = computed(() => renderSiteNoticeRichText(noticeText.value))
</script>

<template>
  <div
    v-if="visible"
    class="sticky top-0 z-20 w-full border-b border-amber-200/70 bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-300 text-amber-950 shadow-md"
  >
    <div class="mx-auto max-w-7xl px-3 py-2 sm:px-6">
      <div class="relative flex min-h-10 items-center justify-end">
        <div class="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center justify-center px-1 sm:px-4" :class="contentSafeAreaClass">
          <p class="w-full text-center text-sm font-semibold leading-6 text-amber-950/95 truncate">
            {{ noticePreview }}
          </p>
        </div>
        <button
          type="button"
          class="relative z-10 whitespace-nowrap rounded-md bg-amber-900 px-3 py-1.5 text-xs font-bold text-amber-100 transition hover:bg-amber-950"
          :class="actionSafeAreaClass"
          @click="dialogOpen = true"
        >
          查看详情
        </button>
      </div>
    </div>
  </div>

  <Dialog v-model:open="dialogOpen">
    <DialogContent class="max-w-xl">
      <DialogHeader>
        <DialogTitle>系统公告</DialogTitle>
        <DialogDescription>请仔细阅读以下公告内容。</DialogDescription>
      </DialogHeader>
      <div
        class="max-h-[60vh] overflow-y-auto rounded-lg border border-amber-100 bg-amber-50/40 p-4 text-sm leading-7 text-gray-800"
        v-html="noticeHtml"
      />
    </DialogContent>
  </Dialog>
</template>
