// Shared UI helpers ported from the design's palette/pill logic.
export const AVATARS = [
  '#C2691F',
  '#2F6E5E',
  '#9C4A14',
  '#3D6E60',
  '#B07A2A',
  '#7A5230',
  '#4E7C3F',
  '#A85A2A',
]

export const initials = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => w[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

export const avatarFor = (i) => AVATARS[i % AVATARS.length]

// pill(bg, color) -> style object
export const pill = (bg, color) => ({
  fontSize: '11.5px',
  fontWeight: 600,
  color,
  background: bg,
  padding: '4px 10px',
  borderRadius: '20px',
  whiteSpace: 'nowrap',
})

// All colours are tokens (var(--…)); values are identical to the prior hex, so
// pixels don't change — the raw palette just lives in :root now.
export const STAGE_PILL = {
  New: pill('var(--info-bg)', 'var(--info-fg)'),
  'Reached out': pill('var(--pill-warm-bg)', 'var(--pill-warm-fg)'),
  Oriented: pill('var(--pill-orange-bg)', 'var(--pill-orange-fg)'),
  Active: pill('var(--success-bg)', 'var(--success-fg)'),
  'Core Group': pill('var(--pill-rust-bg)', 'var(--pill-rust-fg)'),
}

export const relPill = (r) =>
  r >= 85 ? pill('var(--success-bg)', 'var(--success-fg)') : r >= 70 ? pill('var(--pill-orange-bg)', 'var(--pill-orange-fg)') : pill('var(--danger-bg)', 'var(--danger-fg)')

export const healthPill = (h) =>
  h === 'Strong'
    ? pill('var(--success-bg)', 'var(--success-fg)')
    : h === 'Steady'
      ? pill('var(--pill-orange-bg)', 'var(--pill-orange-fg)')
      : pill('var(--danger-bg)', 'var(--danger-fg)')

export const staffPill = (s) =>
  s === 'Fully staffed' ? pill('var(--success-bg)', 'var(--success-fg)') : pill('var(--pill-warm-bg)', 'var(--pill-warm-fg)')
