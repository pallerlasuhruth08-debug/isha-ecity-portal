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
export function waHref(p, text) {
  const i = intlDigits(p)
  if (!i) return null
  return `https://wa.me/${i}` + (text ? `?text=${encodeURIComponent(text)}` : '')
}

// Campaign templates use {name} (recipient) and {my_name} (the caller/coordinator).
export function fillTemplate(tpl, { name, myName } = {}) {
  if (!tpl) return ''
  return String(tpl)
    .replace(/\{name\}/gi, name || '')
    .replace(/\{my_name\}/gi, myName || '')
}
