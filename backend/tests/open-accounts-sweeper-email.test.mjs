import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import nodemailer from 'nodemailer'
import { initDatabase } from '../src/database/init.js'
import { startOpenAccountsOvercapacitySweeper } from '../src/services/open-accounts-sweeper.js'

const tempDbPath = path.join(os.tmpdir(), `smtp-sweeper-${Date.now()}.sqlite`)
process.env.DATABASE_PATH = tempDbPath
process.env.SMTP_HOST = 'smtp.example.com'
process.env.SMTP_PORT = '465'
process.env.SMTP_SECURE = 'true'
process.env.SMTP_USER = 'sender@example.com'
process.env.SMTP_PASS = 'app-password'
process.env.ADMIN_ALERT_EMAIL = 'admin@example.com'
process.env.OPEN_ACCOUNTS_SWEEPER_RUN_ON_STARTUP = 'true'
process.env.OPEN_ACCOUNTS_SWEEPER_INTERVAL_HOURS = '24'
process.env.OPEN_ACCOUNTS_SWEEPER_ENABLED = 'true'

await initDatabase()

const sendMailCalls = []
nodemailer.createTransport = (config) => ({
  async sendMail(message) {
    sendMailCalls.push({ config, message })
    return { messageId: 'sweeper-message-id' }
  }
})

const stop = startOpenAccountsOvercapacitySweeper()
await new Promise(resolve => setTimeout(resolve, 50))
stop()

assert.equal(sendMailCalls.length, 1)
assert.equal(sendMailCalls[0].message.to, 'admin@example.com')

console.log('open-accounts-sweeper email tests passed')
