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

export const STAGE_PILL = {
  New: pill('#E9F0EF', '#2F6E5E'),
  'Reached out': pill('#FBEAD9', '#C28A2A'),
  Oriented: pill('#F6E8D8', '#C2691F'),
  Active: pill('#EAF2E5', '#4E7C3F'),
  'Core Group': pill('#F3E3D2', '#9C4A14'),
}

export const relPill = (r) =>
  r >= 85 ? pill('#EAF2E5', '#4E7C3F') : r >= 70 ? pill('#F6E8D8', '#C2691F') : pill('#FBE6E0', '#B5532F')

export const healthPill = (h) =>
  h === 'Strong'
    ? pill('#EAF2E5', '#4E7C3F')
    : h === 'Steady'
      ? pill('#F6E8D8', '#C2691F')
      : pill('#FBE6E0', '#B5532F')

export const staffPill = (s) =>
  s === 'Fully staffed' ? pill('#EAF2E5', '#4E7C3F') : pill('#FBEAD9', '#C28A2A')
