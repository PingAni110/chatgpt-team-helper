import nodemailer from 'nodemailer'
import { randomUUID } from 'node:crypto'
import { getSmtpSettings } from '../utils/smtp-settings.js'

const parseRecipients = (value) => {
  const raw = String(value || '')
  return raw
    .split(',')
    .map(email => String(email || '').trim())
    .filter(Boolean)
}

const buildSmtpConfig = (settings) => {
  const host = String(settings?.smtp?.host || '').trim()
  const port = Number(settings?.smtp?.port || 0)
  const secure = Boolean(settings?.smtp?.secure)
  const user = String(settings?.smtp?.user || '').trim()
  const pass = String(settings?.smtp?.pass || '')

  if (!host || !user || !pass) {
    return null
  }

  const normalizedPort = Number.isFinite(port) && port > 0 ? port : 465
  let normalizedSecure = secure
  if (normalizedPort === 465 && !normalizedSecure) {
    normalizedSecure = true
    console.warn('[Email] smtp secure=false with port=465 detected, fallback to implicit TLS')
  }

  return {
    host,
    port: normalizedPort,
    secure: normalizedSecure,
    auth: {
      user,
      pass
    }
  }
}

const buildLogContext = ({ smtpConfig, to, subject, traceId }) => ({
  traceId,
  smtp: {
    host: smtpConfig?.host,
    port: smtpConfig?.port,
    secure: smtpConfig?.secure
  },
  to,
  subject
})

export async function sendAdminAlertEmail({ subject, text, html } = {}) {
  const settings = await getSmtpSettings()
  const smtpConfig = buildSmtpConfig(settings)
  if (!smtpConfig) {
    console.warn('[AdminAlert] SMTP 配置不完整，跳过发送告警邮件')
    return { ok: false, error: 'SMTP 配置不完整', code: 'SMTP_CONFIG_INCOMPLETE' }
  }

  const recipients = parseRecipients(settings?.adminAlertEmail)
  if (recipients.length === 0) {
    console.warn('[AdminAlert] ADMIN_ALERT_EMAIL 未配置，跳过发送告警邮件')
    return { ok: false, error: 'ADMIN_ALERT_EMAIL 未配置', code: 'SMTP_RECIPIENTS_EMPTY' }
  }

  const resolvedSubject = String(subject || '').trim() || '系统告警'
  const from = String(settings?.smtp?.from || '').trim() || smtpConfig.auth.user
  const resolvedText = typeof text === 'string' ? text : (text != null ? String(text) : '')
  const resolvedHtml = typeof html === 'string' ? html : ''

  const transporter = nodemailer.createTransport(smtpConfig)
  const traceId = randomUUID()

  try {
    const info = await transporter.sendMail({
      from,
      to: recipients.join(','),
      subject: resolvedSubject,
      text: resolvedText || undefined,
      html: resolvedHtml || undefined
    })
    console.log('[AdminAlert] 告警邮件已发送', {
      ...buildLogContext({ smtpConfig, to: recipients, subject: resolvedSubject, traceId }),
      messageId: info?.messageId
    })
    return { ok: true, messageId: info?.messageId, traceId }
  } catch (error) {
    console.warn('[AdminAlert] 发送告警邮件失败', {
      ...buildLogContext({ smtpConfig, to: recipients, subject: resolvedSubject, traceId }),
      messageId: error?.messageId,
      error: error?.message || String(error),
      stack: error?.stack
    })
    return {
      ok: false,
      error: error?.message || String(error),
      code: error?.code,
      traceId
    }
  }
}

const resolveSystemName = () => {
  const raw = String(process.env.APP_NAME || process.env.SYSTEM_NAME || '系统').trim()
  return raw || '系统'
}

const resolveRuntimeEnv = () => {
  const raw = String(process.env.APP_ENV || process.env.NODE_ENV || '').trim().toLowerCase()
  return raw || 'unknown'
}

export async function sendSmtpTestEmail({ traceId } = {}) {
  const resolvedTraceId = traceId || randomUUID()
  const startedAt = Date.now()
  const settings = await getSmtpSettings()
  const smtpSnapshot = settings?.smtp || {}
  const smtpConfig = buildSmtpConfig(settings)
  if (!smtpConfig) {
    const error = new Error('SMTP 配置不完整')
    error.code = 'SMTP_CONFIG_INCOMPLETE'
    error.traceId = resolvedTraceId
    error.durationMs = Date.now() - startedAt
    console.warn('[SmtpTest] SMTP 配置不完整，跳过测试', {
      traceId: resolvedTraceId,
      smtp: {
        host: smtpSnapshot.host,
        port: smtpSnapshot.port,
        secure: smtpSnapshot.secure
      },
      durationMs: error.durationMs,
      error: error.message,
      code: error.code
    })
    throw error
  }

  const recipients = parseRecipients(settings?.adminAlertEmail)
  if (recipients.length === 0) {
    const error = new Error('未配置告警收件人，无法测试')
    error.code = 'SMTP_RECIPIENTS_EMPTY'
    error.traceId = resolvedTraceId
    error.durationMs = Date.now() - startedAt
    console.warn('[SmtpTest] 告警收件人为空，跳过测试', {
      traceId: resolvedTraceId,
      smtp: {
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure
      },
      durationMs: error.durationMs,
      error: error.message,
      code: error.code
    })
    throw error
  }

  const resolvedSubject = `[${resolveSystemName()}] SMTP 测试邮件 ${new Date().toISOString()}`
  const from = String(settings?.smtp?.from || '').trim() || smtpConfig.auth.user
  const to = recipients[0]
  const environment = resolveRuntimeEnv()
  const resolvedText = [
    'SMTP 测试邮件',
    `host=${smtpConfig.host}`,
    `port=${smtpConfig.port}`,
    `secure=${smtpConfig.secure ? 'true' : 'false'}`,
    `from=${from}`,
    `to=${to}`,
    `env=${environment}`,
    `traceId=${resolvedTraceId}`
  ].join('\n')

  const transporter = nodemailer.createTransport(smtpConfig)

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject: resolvedSubject,
      text: resolvedText
    })
    console.log('[SmtpTest] 测试邮件已发送', {
      ...buildLogContext({ smtpConfig, to, subject: resolvedSubject, traceId: resolvedTraceId }),
      from,
      durationMs: Date.now() - startedAt,
      messageId: info?.messageId
    })
    return {
      ok: true,
      messageId: info?.messageId,
      traceId: resolvedTraceId,
      to,
      from,
      subject: resolvedSubject,
      durationMs: Date.now() - startedAt,
      smtp: {
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure
      },
      environment
    }
  } catch (error) {
    console.warn('[SmtpTest] 测试邮件发送失败', {
      ...buildLogContext({ smtpConfig, to, subject: resolvedSubject, traceId: resolvedTraceId }),
      from,
      durationMs: Date.now() - startedAt,
      error: error?.message || String(error),
      code: error?.code,
      stack: error?.stack
    })
    error.traceId = resolvedTraceId
    error.durationMs = Date.now() - startedAt
    throw error
  }
}

function buildOpenAccountsSweeperBody(summary) {
  const {
    startedAt,
    finishedAt,
    maxJoined,
    scanCreatedWithinDays,
    scannedCount,
    totalKicked,
    abnormalSpaceCount,
    results = [],
    failures = []
  } = summary || {}

  const derivedAbnormalSpaceCount =
    Number.isFinite(Number(abnormalSpaceCount)) && Number(abnormalSpaceCount) >= 0
      ? Number(abnormalSpaceCount)
      : (() => {
          const abnormalSpaceSet = new Set()
          for (const item of results || []) {
            if (!Array.isArray(item?.failedUsers) || item.failedUsers.length === 0) continue
            abnormalSpaceSet.add(item.accountId || item.emailPrefix || `result-${abnormalSpaceSet.size}`)
          }
          for (const item of failures || []) {
            abnormalSpaceSet.add(item.accountId || item.emailPrefix || `failure-${abnormalSpaceSet.size}`)
          }
          return abnormalSpaceSet.size
        })()

  const humanStart = startedAt ? startedAt.toLocaleString() : ''
  const humanEnd = finishedAt ? finishedAt.toLocaleString() : ''

  const rows = (results || [])
    .map(item => {
      const emailPrefix = String(item.emailPrefix || '')
      const beforeJoined = item.beforeJoined ?? '未知'
      const joined = item.joined ?? '未知'
      const kicked = Number(item.kicked || 0)
      const didKick = Boolean(item.didKick) || kicked > 0
      const kickedUsers = Array.isArray(item.kickedUsers) ? item.kickedUsers : []
      const failedUsers = Array.isArray(item.failedUsers) ? item.failedUsers : []
      const skippedUsers = Array.isArray(item.skippedUsers) ? item.skippedUsers : []
      const kickedDetail = kickedUsers.length
        ? kickedUsers
            .map(user => {
              const label = user.email || user.id || 'unknown'
              const time = user.joinedAt ? `@${user.joinedAt}` : ''
              return `${label}${time}`
            })
            .join('<br/>')
        : '—'
      const failureDetail = failedUsers.length
        ? failedUsers.map(user => `${user.email || user.id || 'unknown'}(${user.message || '失败'})`).join('<br/>')
        : ''
      const skippedDetail = skippedUsers.length
        ? skippedUsers.map(user => `${user.email || user.id || 'unknown'}(已移除)`).join('<br/>')
        : ''
      const detailParts = [kickedDetail]
      if (failureDetail) detailParts.push(`<span style="color:#d00">失败：${failureDetail}</span>`)
      if (skippedDetail) detailParts.push(`<span style="color:#888">跳过：${skippedDetail}</span>`)
      const details = detailParts.join('<br/>')
      return `<tr><td>${emailPrefix}</td><td style="text-align:right;">${beforeJoined}</td><td style="text-align:right;">${joined}</td><td style="text-align:center;">${didKick ? '是' : '否'}</td><td style="text-align:right;">${kicked}</td><td>${details}</td></tr>`
    })
    .join('')

  const failureRows = (failures || [])
    .map(item => {
      const label = item.emailPrefix ? `${item.emailPrefix} (ID=${item.accountId})` : `ID=${item.accountId}`
      return `<li>账号 ${label}：${item.error || '执行失败'}</li>`
    })
    .join('')

  const htmlParts = [
    `<p>开放账号超员扫描已完成。</p>`,
    `<p>扫描数：${scannedCount ?? 0}，异常：${derivedAbnormalSpaceCount}，本次踢出：${totalKicked ?? 0}，阈值：joined &gt; ${maxJoined ?? ''}</p>`,
    ...(Number(scanCreatedWithinDays) > 0 ? [`<p>扫描范围：最近 ${scanCreatedWithinDays} 天创建的开放账号</p>`] : []),
  ]

  if ((failures || []).length > 0) {
    htmlParts.push('<p>以下账号处理失败：</p>')
    htmlParts.push(`<ul>${failureRows}</ul>`)
  }

  htmlParts.push('<table style="border-collapse:collapse;width:100%;">')
  htmlParts.push(
    '<thead><tr><th style="text-align:left;border-bottom:1px solid #ccc;">邮箱前缀</th><th style="text-align:right;border-bottom:1px solid #ccc;">触发前人数</th><th style="text-align:right;border-bottom:1px solid #ccc;">踢出后人数</th><th style="text-align:center;border-bottom:1px solid #ccc;">是否踢出</th><th style="text-align:right;border-bottom:1px solid #ccc;">踢出人数</th><th style="text-align:left;border-bottom:1px solid #ccc;">踢出明细</th></tr></thead>'
  )
  htmlParts.push(`<tbody>${rows || '<tr><td colspan="6">无</td></tr>'}</tbody>`)
  htmlParts.push('</table>')

  if (humanStart || humanEnd) {
    htmlParts.push('<p>')
    if (humanStart) htmlParts.push(`开始时间：${humanStart}<br/>`)
    if (humanEnd) htmlParts.push(`结束时间：${humanEnd}`)
    htmlParts.push('</p>')
  }

  const textRows =
    results && results.length
      ? results
          .map(item => {
            const emailPrefix = String(item.emailPrefix || '')
            const beforeJoined = item.beforeJoined ?? '未知'
            const joined = item.joined ?? '未知'
            const kicked = Number(item.kicked || 0)
            const didKick = Boolean(item.didKick) || kicked > 0
            const kickedUsers = Array.isArray(item.kickedUsers) ? item.kickedUsers : []
            const failedUsers = Array.isArray(item.failedUsers) ? item.failedUsers : []
            const skippedUsers = Array.isArray(item.skippedUsers) ? item.skippedUsers : []
            const kickedDetail = kickedUsers.length
              ? kickedUsers.map(user => `${user.email || user.id || 'unknown'}${user.joinedAt ? `@${user.joinedAt}` : ''}`).join(', ')
              : '—'
            const failedDetail = failedUsers.length
              ? `  失败: ${failedUsers.map(user => `${user.email || user.id || 'unknown'}(${user.message || '失败'})`).join(', ')}`
              : ''
            const skippedDetail = skippedUsers.length
              ? `  跳过: ${skippedUsers.map(user => `${user.email || user.id || 'unknown'}(已移除)`).join(', ')}`
              : ''
            return `- ${emailPrefix}: 触发前=${beforeJoined} 踢出后=${joined} 是否踢出=${didKick ? '是' : '否'} 踢出人数=${kicked} 踢出明细=${kickedDetail}${failedDetail}${skippedDetail}`
          })
          .join('\n')
      : '无'

  const textFailures =
    failures && failures.length
      ? '\n\n失败：\n' +
        failures
          .map(item => {
            const label = item.emailPrefix ? `${item.emailPrefix} (ID=${item.accountId})` : `ID=${item.accountId}`
            return `- ${label}: ${item.error || '执行失败'}`
          })
          .join('\n')
      : ''

  const textTime = humanStart || humanEnd ? `\n\n开始时间：${humanStart}\n结束时间：${humanEnd}` : ''

  return {
    html: htmlParts.join('\n'),
    text: `开放账号超员扫描已完成。\n扫描数：${scannedCount ?? 0}，异常：${derivedAbnormalSpaceCount}，本次踢出：${totalKicked ?? 0}，阈值：${maxJoined ?? ''}${Number(scanCreatedWithinDays) > 0 ? `\n扫描范围：最近 ${scanCreatedWithinDays} 天创建的开放账号` : ''}${textFailures}\n\n${textRows}${textTime}`
  }
}

export async function sendOpenAccountsSweeperReportEmail(summary) {
  const settings = await getSmtpSettings()
  const smtpConfig = buildSmtpConfig(settings)
  if (!smtpConfig) {
    console.warn('[OpenAccountsSweeper] SMTP 配置不完整，跳过发送扫描报告')
    return false
  }

  const recipients = parseRecipients(settings?.adminAlertEmail)
  if (recipients.length === 0) {
    console.warn('[OpenAccountsSweeper] ADMIN_ALERT_EMAIL 未配置，跳过发送扫描报告')
    return false
  }

  const transporter = nodemailer.createTransport(smtpConfig)
  const { html, text } = buildOpenAccountsSweeperBody(summary)
  const traceId = randomUUID()

  const subject = process.env.OPEN_ACCOUNTS_SWEEPER_REPORT_SUBJECT || '开放账号超员扫描报告'
  const from = String(settings?.smtp?.from || '').trim() || smtpConfig.auth.user

  try {
    const info = await transporter.sendMail({
      from,
      to: recipients.join(','),
      subject,
      text,
      html
    })

    console.log('[OpenAccountsSweeper] 扫描报告邮件已发送', {
      ...buildLogContext({ smtpConfig, to: recipients, subject, traceId }),
      messageId: info?.messageId
    })
    return true
  } catch (error) {
    console.warn('[OpenAccountsSweeper] 发送扫描报告邮件失败', {
      ...buildLogContext({ smtpConfig, to: recipients, subject, traceId }),
      messageId: error?.messageId,
      error: error?.message || String(error),
      stack: error?.stack
    })
    throw error
  }
}

export async function sendPurchaseOrderEmail(order) {
  const settings = await getSmtpSettings()
  const smtpConfig = buildSmtpConfig(settings)
  if (!smtpConfig) {
    console.warn('[Purchase] SMTP 配置不完整，跳过发送订单邮件')
    return false
  }

  const to = String(order?.email || '').trim()
  if (!to) {
    console.warn('[Purchase] 缺少收件邮箱，跳过发送订单邮件')
    return false
  }

  const transporter = nodemailer.createTransport(smtpConfig)
  const from = String(settings?.smtp?.from || '').trim() || smtpConfig.auth.user
  const subject = process.env.PURCHASE_EMAIL_SUBJECT || '订单信息'
  const traceId = randomUUID()

  const orderNo = String(order?.orderNo || '')
  const serviceDays = Number(order?.serviceDays || 30)

  const text = [
    `订单号：${orderNo}`,
    `邮箱：${to}`,
    `有效期：${serviceDays} 天（下单日起算）`,
  ].join('\n')

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif; line-height: 1.6;">
      <h2 style="margin: 0 0 12px;">订单信息</h2>
      <p style="margin: 0 0 6px;">订单号：<strong>${orderNo}</strong></p>
      <p style="margin: 0 0 6px;">邮箱：${to}</p>
      <p style="margin: 0 0 6px;">有效期：${serviceDays} 天（下单日起算）</p>
    </div>
  `

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    })
    console.log('[Purchase] order email sent', {
      ...buildLogContext({ smtpConfig, to, subject, traceId }),
      orderNo,
      messageId: info?.messageId
    })
    return true
  } catch (error) {
    console.warn('[Purchase] send order email failed', {
      ...buildLogContext({ smtpConfig, to, subject, traceId }),
      orderNo,
      messageId: error?.messageId,
      error: error?.message || String(error),
      stack: error?.stack
    })
    return false
  }
}

export async function sendVerificationCodeEmail(email, code, options = {}) {
  const settings = await getSmtpSettings()
  const smtpConfig = buildSmtpConfig(settings)
  if (!smtpConfig) {
    console.warn('[VerifyCode] SMTP 配置不完整，跳过发送验证码邮件')
    return false
  }

  const to = String(email || '').trim()
  if (!to) {
    console.warn('[VerifyCode] 缺少收件邮箱，跳过发送验证码邮件')
    return false
  }

  const resolvedCode = String(code || '').trim()
  if (!resolvedCode) {
    console.warn('[VerifyCode] 缺少验证码，跳过发送验证码邮件')
    return false
  }

  const minutes = Number(options?.expiresMinutes || 10)
  const subject = options?.subject || process.env.EMAIL_VERIFICATION_SUBJECT || '邮箱验证码'
  const from = String(settings?.smtp?.from || '').trim() || smtpConfig.auth.user
  const transporter = nodemailer.createTransport(smtpConfig)
  const traceId = randomUUID()

  const text = `您的验证码为：${resolvedCode}\n有效期：${minutes} 分钟\n如非本人操作请忽略本邮件。`
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif; line-height: 1.6;">
      <h2 style="margin: 0 0 12px;">邮箱验证码</h2>
      <p style="margin: 0 0 8px;">您的验证码为：</p>
      <p style="margin: 0 0 12px; font-size: 20px; font-weight: 700; letter-spacing: 2px;">${resolvedCode}</p>
      <p style="margin: 0 0 6px;">有效期：${minutes} 分钟</p>
      <p style="margin: 0; color: #666;">如非本人操作请忽略本邮件。</p>
    </div>
  `

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    })
    console.log('[VerifyCode] 验证码邮件已发送', {
      ...buildLogContext({ smtpConfig, to, subject, traceId }),
      messageId: info?.messageId
    })
    return true
  } catch (error) {
    console.warn('[VerifyCode] 发送验证码邮件失败', {
      ...buildLogContext({ smtpConfig, to, subject, traceId }),
      messageId: error?.messageId,
      error: error?.message || String(error),
      stack: error?.stack
    })
    return false
  }
}
