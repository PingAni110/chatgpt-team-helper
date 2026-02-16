<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { adminService } from '@/services/api'
import { useAppConfigStore } from '@/stores/appConfig'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { renderSiteNoticeRichText } from '@/lib/siteNotice'

const appConfigStore = useAppConfigStore()

const siteNoticeEnabled = ref(false)
const siteNoticeText = ref('')
const siteNoticeError = ref('')
const siteNoticeSuccess = ref('')
const siteNoticeLoading = ref(false)
const editorRef = ref<HTMLTextAreaElement | null>(null)

const surroundSelection = (prefix: string, suffix: string = prefix) => {
  const input = editorRef.value
  if (!input) return
  const start = input.selectionStart ?? 0
  const end = input.selectionEnd ?? 0
  const source = siteNoticeText.value
  const selected = source.slice(start, end) || '文本'
  const nextText = `${source.slice(0, start)}${prefix}${selected}${suffix}${source.slice(end)}`
  siteNoticeText.value = nextText

  requestAnimationFrame(() => {
    input.focus()
    const cursorStart = start + prefix.length
    const cursorEnd = cursorStart + selected.length
    input.setSelectionRange(cursorStart, cursorEnd)
  })
}

const insertBold = () => surroundSelection('**')
const insertRed = () => surroundSelection('[red]', '[/red]')

const loadSiteNoticeSettings = async () => {
  siteNoticeError.value = ''
  siteNoticeSuccess.value = ''
  try {
    const response = await adminService.getSiteNoticeSettings()
    const next = response.siteNotice || { enabled: false, text: '' }
    siteNoticeEnabled.value = Boolean(next.enabled)
    siteNoticeText.value = String(next.text || '')
  } catch (err: any) {
    siteNoticeError.value = err.response?.data?.error || '加载公告设置失败'
  }
}

const saveSiteNoticeSettings = async () => {
  siteNoticeError.value = ''
  siteNoticeSuccess.value = ''
  siteNoticeLoading.value = true
  try {
    const response = await adminService.updateSiteNoticeSettings({
      siteNotice: {
        enabled: siteNoticeEnabled.value,
        text: String(siteNoticeText.value || '').trim(),
      }
    })
    const next = response.siteNotice || { enabled: false, text: '' }
    siteNoticeEnabled.value = Boolean(next.enabled)
    siteNoticeText.value = String(next.text || '')
    appConfigStore.siteNotice = {
      enabled: siteNoticeEnabled.value,
      text: siteNoticeText.value,
      link: ''
    }
    siteNoticeSuccess.value = '公告设置已保存'
    setTimeout(() => (siteNoticeSuccess.value = ''), 3000)
  } catch (err: any) {
    siteNoticeError.value = err.response?.data?.error || '保存公告设置失败'
  } finally {
    siteNoticeLoading.value = false
  }
}

onMounted(() => {
  void loadSiteNoticeSettings()
})
</script>

<template>
  <div class="space-y-8">
    <div class="space-y-2">
      <h1 class="text-4xl font-bold tracking-tight text-gray-900">公告设置</h1>
      <p class="text-gray-500">仅在商品购买页展示公告，支持加粗与标红格式。</p>
    </div>

    <Card class="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden">
      <CardHeader class="border-b border-gray-50 bg-gray-50/30 px-6 py-5 sm:px-8 sm:py-6">
        <CardTitle class="text-xl font-bold text-gray-900">站点公告</CardTitle>
        <CardDescription class="text-gray-500">点击“查看详情”将在购买页面内弹窗展示完整公告内容。</CardDescription>
      </CardHeader>
      <CardContent class="p-6 sm:p-8 space-y-5">
        <div class="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
          <div class="space-y-1">
            <p class="font-medium text-gray-900">启用公告条</p>
            <p class="text-xs text-gray-500">关闭后购买页不展示公告</p>
          </div>
          <input
            v-model="siteNoticeEnabled"
            type="checkbox"
            class="w-6 h-6 rounded-md border-gray-300 text-blue-600 focus:ring-blue-500"
          />
        </div>

        <div class="space-y-2">
          <Label for="siteNoticeText" class="text-xs font-semibold text-gray-500 uppercase tracking-wider">公告内容</Label>
          <div class="flex flex-wrap gap-2">
            <Button type="button" variant="outline" class="h-9 px-3" :disabled="siteNoticeLoading" @click="insertBold">
              插入加粗
            </Button>
            <Button type="button" variant="outline" class="h-9 px-3 text-red-600" :disabled="siteNoticeLoading" @click="insertRed">
              插入标红
            </Button>
          </div>
          <textarea
            id="siteNoticeText"
            ref="editorRef"
            v-model="siteNoticeText"
            rows="7"
            :disabled="siteNoticeLoading"
            placeholder="例如：**节假日公告**\n[red]高峰期响应可能延迟，请耐心等待[/red]"
            class="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm leading-6 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <p class="text-xs text-gray-400">支持格式：**加粗文字**、[red]标红文字[/red]，支持换行。</p>
        </div>

        <div class="space-y-2">
          <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">预览</p>
          <div class="rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-sm leading-7" v-html="renderSiteNoticeRichText(siteNoticeText)" />
        </div>

        <div v-if="siteNoticeError" class="rounded-xl bg-red-50 p-4 text-red-600 border border-red-100 text-sm font-medium">
          {{ siteNoticeError }}
        </div>

        <div v-if="siteNoticeSuccess" class="rounded-xl bg-green-50 p-4 text-green-600 border border-green-100 text-sm font-medium">
          {{ siteNoticeSuccess }}
        </div>

        <div class="flex flex-col sm:flex-row gap-3">
          <Button
            type="button"
            variant="outline"
            class="w-full sm:w-auto h-11 px-4 border-gray-200 rounded-xl"
            @click="loadSiteNoticeSettings"
          >
            刷新
          </Button>
          <Button
            type="button"
            :disabled="siteNoticeLoading"
            class="w-full h-11 rounded-xl bg-black hover:bg-gray-800 text-white shadow-lg shadow-black/5"
            @click="saveSiteNoticeSettings"
          >
            {{ siteNoticeLoading ? '保存中...' : '保存公告配置' }}
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
