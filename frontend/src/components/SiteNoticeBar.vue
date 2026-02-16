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

const isPurchaseRoute = computed(() => {
  const path = String(route.path || '')
  return path === '/buy' || path === '/order' || path.startsWith('/purchase')
})

const visible = computed(() => {
  const notice = appConfigStore.siteNotice
  return isPurchaseRoute.value && Boolean(notice?.enabled) && Boolean(String(notice?.text || '').trim())
})

const noticeText = computed(() => String(appConfigStore.siteNotice?.text || '').trim())
const noticePreview = computed(() => extractSiteNoticePlainText(noticeText.value, 64))
const noticeHtml = computed(() => renderSiteNoticeRichText(noticeText.value))
</script>

<template>
  <div
    v-if="visible"
    class="sticky top-0 z-30 w-full border-b border-amber-200/70 bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-300 text-amber-950 shadow-md"
  >
    <div class="mx-auto flex min-h-12 max-w-7xl items-center justify-between gap-3 px-3 py-2 text-sm sm:px-6">
      <p class="line-clamp-1 leading-6 font-semibold">
        {{ noticePreview }}
      </p>
      <button
        type="button"
        class="whitespace-nowrap rounded-md bg-amber-900 px-3 py-1.5 text-xs font-bold text-amber-100 transition hover:bg-amber-950"
        @click="dialogOpen = true"
      >
        查看详情
      </button>
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
