<script setup lang="ts">
import { RouterView } from 'vue-router'
import { ToastContainer } from '@/components/ui/toast'
import SiteNoticeBar from '@/components/SiteNoticeBar.vue'
</script>

<template>
  <SiteNoticeBar />
  <ToastContainer />
  <RouterView />
</template>
