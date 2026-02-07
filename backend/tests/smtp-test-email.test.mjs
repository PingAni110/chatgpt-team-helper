import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import nodemailer from 'nodemailer'
import { initDatabase } from '../src/database/init.js'
import { invalidateSmtpSettingsCache } from '../src/utils/smtp-settings.js'

const tempDbPath = path.join(os.tmpdir(), `smtp-test-${Date.now()}.sqlite`)
process.env.DATABASE_PATH = tempDbPath
process.env.SMTP_HOST = 'smtp.example.com'
process.env.SMTP_PORT = '465'
process.env.SMTP_SECURE = 'false'
process.env.SMTP_USER = 'sender@example.com'
process.env.SMTP_PASS = 'app-password'
process.env.SMTP_FROM = 'alerts@example.com'
process.env.ADMIN_ALERT_EMAIL = 'admin@example.com,ops@example.com'
process.env.APP_NAME = 'TestApp'
process.env.APP_ENV = 'stage'

await initDatabase()

const { sendSmtpTestEmail } = await import('../src/services/email-service.js')

const sendMailCalls = []
nodemailer.createTransport = (config) => ({
  async sendMail(message) {
    sendMailCalls.push({ config, message })
    return { messageId: 'smtp-test-message-id' }
  }
})

invalidateSmtpSettingsCache()
const success = await sendSmtpTestEmail()
assert.equal(success.ok, true)
assert.equal(success.to, 'admin@example.com')
assert.ok(success.subject.includes('[TestApp] SMTP 测试邮件'))
assert.equal(sendMailCalls.length, 1)
assert.equal(sendMailCalls[0].config.secure, true)
assert.ok(sendMailCalls[0].message.text.includes('env=stage'))

invalidateSmtpSettingsCache()
process.env.ADMIN_ALERT_EMAIL = ''
try {
  await sendSmtpTestEmail()
  assert.fail('expected missing recipient error')
} catch (error) {
  assert.equal(error.code, 'SMTP_RECIPIENTS_EMPTY')
}

invalidateSmtpSettingsCache()
process.env.ADMIN_ALERT_EMAIL = 'admin@example.com'
nodemailer.createTransport = () => ({
  async sendMail() {
    const error = new Error('Invalid login')
    error.code = 'EAUTH'
    throw error
  }
})
try {
  await sendSmtpTestEmail()
  assert.fail('expected auth failure')
} catch (error) {
  assert.equal(error.code, 'EAUTH')
}

invalidateSmtpSettingsCache()
nodemailer.createTransport = () => ({
  async sendMail() {
    const error = new Error('Connection timeout')
    error.code = 'ETIMEDOUT'
    throw error
  }
})
try {
  await sendSmtpTestEmail()
  assert.fail('expected connection timeout')
} catch (error) {
  assert.equal(error.code, 'ETIMEDOUT')
}

console.log('smtp-test-email tests passed')
