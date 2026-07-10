// Phone normalization + deep-link builders, shared by the caller workspace and the
// coordinator campaign view. Verified against the data: every stored number is a bare
// 10-digit Indian mobile, none carry a country code — so 10-digit -> prefix 91.
export const onlyDigits = (p) => String(p || '').replace(/\D/g, '')

// intl digits WITHOUT the leading '+': bare 10-digit -> prefix 91; 11–13 digits ->
// assume already country-coded; anything else is not dialable (buttons disable).
export function intlDigits(phone) {
  const d = onlyDigits(phone)
  if (d.length === 10) return '91' + d
  if (d.length >= 11 && d.length <= 13) return d
  return null
}
export const hasDialable = (phone) => !!intlDigits(phone)

export const telHref = (p) => {
  const i = intlDigits(p)
  return i ? `tel:+${i}` : null
}
export function smsHref(p, body) {
  const i = intlDigits(p)
  if (!i) return null
  return `sms:+${i}` + (body ? `?body=${encodeURIComponent(body)}` : '')
}
// api.whatsapp.com (not wa.me) deliberately -- wa.me redirects through an extra
// hop to web.whatsapp.com on desktop/WhatsApp Web, and that redirect is known to
// mangle multi-byte UTF-8 (emoji) in the prefilled text. api.whatsapp.com is
// WhatsApp's own "Click to Chat" endpoint and doesn't have that redirect.
export function waHref(p, text) {
  const i = intlDigits(p)
  if (!i) return null
  return `https://api.whatsapp.com/send?phone=${i}` + (text ? `&text=${encodeURIComponent(text)}` : '')
}

// Campaign templates support two variable syntaxes, both live at once:
//  - Legacy single-brace, unchanged since day one: {name} -> recipient's FULL
//    name, {my_name} -> the caller/coordinator's name. Existing saved templates
//    (e.g. "Namaskaram {name}... Pranam {my_name}") keep working exactly as before.
//  - New double-brace, distinct meanings: {{name}} -> recipient's FIRST name only,
//    {{full_name}} -> recipient's full name, {{my_name}} -> caller's name (same
//    value as {my_name}, just offered in the newer syntax for consistency).
export function fillTemplate(tpl, { name, myName } = {}) {
  if (!tpl) return ''
  const firstName = (name || '').trim().split(/\s+/)[0] || ''
  return String(tpl)
    .replace(/\{\{\s*name\s*\}\}/gi, firstName)
    .replace(/\{\{\s*full_name\s*\}\}/gi, name || '')
    .replace(/\{\{\s*my_name\s*\}\}/gi, myName || '')
    .replace(/\{name\}/gi, name || '')
    .replace(/\{my_name\}/gi, myName || '')
}
