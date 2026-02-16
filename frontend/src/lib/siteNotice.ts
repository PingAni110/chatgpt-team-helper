const escapeHtml = (input: string) => {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export const NOTICE_BOLD_PREFIX = '**'
export const NOTICE_RED_PREFIX = '[red]'
export const NOTICE_RED_SUFFIX = '[/red]'

export const renderSiteNoticeRichText = (value: string) => {
  const source = String(value || '')
  const escaped = escapeHtml(source)

  const withBold = escaped.replace(/\*\*([\s\S]+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
  const withRed = withBold.replace(/\[red\]([\s\S]+?)\[\/red\]/gi, '<span class="font-semibold text-red-600">$1</span>')

  return withRed.replace(/\r?\n/g, '<br />')
}

export const extractSiteNoticePlainText = (value: string, maxLength = 56) => {
  const source = String(value || '')
    .replace(/\*\*/g, '')
    .replace(/\[red\]/gi, '')
    .replace(/\[\/red\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!source) return ''
  return source.length > maxLength ? `${source.slice(0, maxLength)}...` : source
}
