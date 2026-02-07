import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import nodemailer from 'nodemailer'
import { initDatabase } from '../src/database/init.js'

const tempDbPath = path.join(os.tmpdir(), `smtp-alert-${Date.now()}.sqlite`)
process.env.DATABASE_PATH = tempDbPath
process.env.SMTP_HOST = 'smtp.example.com'
process.env.SMTP_PORT = '465'
process.env.SMTP_SECURE = 'false'
process.env.SMTP_USER = 'sender@example.com'
process.env.SMTP_PASS = 'app-password'
process.env.ADMIN_ALERT_EMAIL = 'admin@example.com'

await initDatabase()

const sendMailCalls = []
nodemailer.createTransport = (config) => ({
  async sendMail(message) {
    sendMailCalls.push({ config, message })
    return { messageId: 'test-message-id' }
  }
})

const { sendAdminAlertEmail } = await import('../src/services/email-service.js')

const result = await sendAdminAlertEmail({
  subject: '测试告警',
  text: '告警内容'
})

assert.equal(result.ok, true)
assert.equal(sendMailCalls.length, 1)
assert.equal(sendMailCalls[0].config.secure, true)
assert.equal(sendMailCalls[0].message.to, 'admin@example.com')

console.log('admin-alert-email tests passed')
