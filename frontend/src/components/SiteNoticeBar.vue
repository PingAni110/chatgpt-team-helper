<script setup lang="ts">
import { computed } from 'vue'
import { useAppConfigStore } from '@/stores/appConfig'

const appConfigStore = useAppConfigStore()

const visible = computed(() => {
  const notice = appConfigStore.siteNotice
  return Boolean(notice?.enabled) && Boolean(String(notice?.text || '').trim())
})

const noticeText = computed(() => String(appConfigStore.siteNotice?.text || '').trim())
const noticeLink = computed(() => String(appConfigStore.siteNotice?.link || '').trim())
const hasLink = computed(() => Boolean(noticeLink.value))
</script>

<template>
  <div
    v-if="visible"
    class="sticky top-0 z-50 w-full border-b border-amber-200/70 bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 text-amber-950 shadow-lg"
  >
    <div class="mx-auto flex min-h-12 max-w-7xl items-center justify-between gap-3 px-4 py-2 text-sm font-semibold sm:px-6">
      <p class="leading-6">
        {{ noticeText }}
      </p>
      <a
        v-if="hasLink"
        :href="noticeLink"
        target="_blank"
        rel="noopener noreferrer"
        class="whitespace-nowrap rounded-md bg-amber-900 px-3 py-1.5 text-xs font-bold text-amber-100 transition hover:bg-amber-950"
      >
        查看详情
      </a>
    </div>
  </div>
</template>
