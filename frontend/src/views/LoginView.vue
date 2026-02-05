<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authService } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const router = useRouter()
const route = useRoute()
const username = ref('')
const password = ref('')
const errorMsg = ref('')
const loading = ref(false)

watch([username, password], () => {
  if (errorMsg.value) {
    errorMsg.value = ''
  }
})

const resolveLoginError = (err: any): string => {
  const status = Number(err?.response?.status || 0)
  const backendMessage = String(err?.response?.data?.error || err?.response?.data?.message || '').trim()

  if (backendMessage) {
    if (status === 401) return `账号或密码错误：${backendMessage}`
    if (status === 403) return `登录被拒绝：${backendMessage}`
    return backendMessage
  }

  if (status === 401) return '账号或密码错误，请检查后重试'
  if (status === 403) return '当前账号无登录权限（403）'
  if (status >= 500) return '服务器暂时不可用，请稍后再试'
  return err?.message || '登录失败，请重试'
}

const handleLogin = async () => {
  const identifier = username.value.trim()
  if (!identifier || !password.value) {
    errorMsg.value = '请输入账号和密码'
    return
  }

  errorMsg.value = ''
  loading.value = true

  try {
    // 后端接口约定：POST /auth/login，payload 字段名为 { username, password }
    await authService.login(identifier, password.value)

    // 登录后 token/user 已由 authService 写入 localStorage。
    // 支持登录后回跳：/login?redirect=/admin/accounts
    const redirectTarget = String(route.query.redirect || '').trim()
    await router.replace(redirectTarget || '/admin')
  } catch (err: any) {
    errorMsg.value = resolveLoginError(err)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="relative min-h-screen w-full overflow-hidden bg-white flex items-center justify-center font-sans">
    
    <!-- 液态流体背景 -->
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
      <!-- 动态光球 1 -->
      <div class="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-300 rounded-full mix-blend-multiply filter blur-[80px] opacity-70 animate-blob"></div>
      <!-- 动态光球 2 -->
      <div class="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-yellow-200 rounded-full mix-blend-multiply filter blur-[80px] opacity-70 animate-blob animation-delay-2000"></div>
      <!-- 动态光球 3 -->
      <div class="absolute bottom-[-20%] left-[20%] w-[500px] h-[500px] bg-pink-300 rounded-full mix-blend-multiply filter blur-[80px] opacity-70 animate-blob animation-delay-4000"></div>
      <!-- 动态光球 4 -->
      <div class="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-blue-300 rounded-full mix-blend-multiply filter blur-[80px] opacity-70 animate-blob animation-delay-6000"></div>
    </div>

    <!-- 登录卡片 -->
    <div class="relative z-10 w-full max-w-[400px] mx-4">
      <div class="relative overflow-hidden rounded-3xl bg-white/40 backdrop-blur-xl border border-white/50 shadow-[0_8px_32px_rgba(0,0,0,0.05)] p-8 md:p-10 transition-all duration-500 hover:shadow-[0_8px_40px_rgba(0,0,0,0.08)]">
        
        <!-- 标题区域 -->
        <div class="mb-10 text-center">
          <h1 class="text-3xl font-semibold text-gray-900 tracking-tight mb-2">欢迎回来</h1>
          <p class="text-sm text-gray-500 font-medium">请登录以继续管理</p>
        </div>

        <form @submit.prevent="handleLogin" class="space-y-6">
          <div class="space-y-2">
            <Label for="username" class="text-xs font-medium text-gray-500 ml-1 uppercase tracking-wider">账号</Label>
            <Input
              id="username"
              v-model="username"
              type="text"
              placeholder="请输入用户名或邮箱"
              required
              class="h-12 rounded-2xl bg-white/50 border-transparent hover:bg-white/80 focus:bg-white focus:border-blue-400/30 focus:ring-4 focus:ring-blue-100 transition-all duration-300 placeholder:text-gray-400 font-medium text-gray-700"
            />
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <Label for="password" class="text-xs font-medium text-gray-500 ml-1 uppercase tracking-wider">密码</Label>
            </div>
            <Input
              id="password"
              v-model="password"
              type="password"
              placeholder="请输入密码"
              required
              class="h-12 rounded-2xl bg-white/50 border-transparent hover:bg-white/80 focus:bg-white focus:border-blue-400/30 focus:ring-4 focus:ring-blue-100 transition-all duration-300 placeholder:text-gray-400 font-medium text-gray-700"
            />
          </div>

          <div v-if="errorMsg" class="text-sm text-red-500 bg-red-50/80 border border-red-100 rounded-xl px-4 py-3 animate-in fade-in slide-in-from-bottom-2">
            {{ errorMsg }}
          </div>

          <Button 
            type="submit" 
            class="w-full h-12 rounded-2xl bg-gray-900 hover:bg-black text-white font-medium text-[15px] shadow-lg shadow-gray-200/50 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 mt-2"
            :disabled="loading"
          >
            <span v-if="loading" class="mr-2 w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
            {{ loading ? '正在登录...' : '登 录' }}
          </Button>

          <div class="text-center text-sm text-gray-500 font-medium">
            没有账号？
            <router-link to="/register" class="text-gray-900 hover:underline">去注册</router-link>
          </div>
        </form>
      </div>
      
      <!-- 底部版权或其他信息 -->
      <div class="mt-8 text-center">
        <p class="text-xs text-gray-400 font-medium">© 2026 Boarding System</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes blob {
  0% { transform: translate(0px, 0px) scale(1); }
  33% { transform: translate(30px, -50px) scale(1.1); }
  66% { transform: translate(-20px, 20px) scale(0.9); }
  100% { transform: translate(0px, 0px) scale(1); }
}

.animate-blob {
  animation: blob 7s infinite;
}

.animation-delay-2000 {
  animation-delay: 2s;
}

.animation-delay-4000 {
  animation-delay: 4s;
}

.animation-delay-6000 {
  animation-delay: 6s;
}
</style>
