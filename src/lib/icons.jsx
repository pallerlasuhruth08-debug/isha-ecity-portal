// SVG icon set ported 1:1 from the Volunteer Care Portal design.
// Each icon inherits `currentColor` for stroke; size via the `s` prop.
const base = (s = 18) => ({
  width: s,
  height: s,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
})

export const Icon = {
  dashboard: (s) => (
    <svg {...base(s)}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  volunteers: (s) => (
    <svg {...base(s)}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" />
    </svg>
  ),
  planning: (s) => (
    <svg {...base(s)}>
      <rect x="3" y="4" width="18" height="17" rx="2.5" />
      <path d="M3 9h18M8 2v4M16 2v4" />
      <path d="m9 15 2 2 4-4" />
    </svg>
  ),
  events: (s) => (
    <svg {...base(s)}>
      <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z" />
      <path d="M9 5v14" />
    </svg>
  ),
  nurturing: (s) => (
    <svg {...base(s)}>
      <path d="M19 14c1.5-1.5 2.5-3.3 2.5-5.2A4.3 4.3 0 0 0 12 6.3 4.3 4.3 0 0 0 2.5 8.8C2.5 13 7 16.5 12 20c2.2-1.5 4.3-3.2 6-5" />
      <path d="M16 11l-2 2-1.5-1.5" />
    </svg>
  ),
  meditators: (s) => (
    <svg {...base(s)}>
      <circle cx="12" cy="5" r="2.3" />
      <path d="M12 8.5c-1.4 1.6-3.7 2.6-6 2.9M12 8.5c1.4 1.6 3.7 2.6 6 2.9M12 8.5v6" />
      <path d="M5 19c1.8-2.5 4.2-3.5 7-3.5s5.2 1 7 3.5" />
    </svg>
  ),
  advance: (s) => (
    <svg {...base(s)}>
      <path d="M12 3l2.2 5.3 5.8.5-4.4 3.8 1.3 5.6L12 21l-4.9 2.7" />
      <path d="M12 3 9.8 8.3 4 8.8l4.4 3.8L7.1 18.2 12 15.5" />
    </svg>
  ),
  interest: (s) => (
    <svg {...base(s)}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  ),
  campaigns: (s) => (
    <svg {...base(s)}>
      <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" />
      <path d="M15.5 9a3.5 3.5 0 0 1 0 6M18 6.5a7 7 0 0 1 0 11" />
    </svg>
  ),
  search: (s = 16) => (
    <svg {...base(s)} strokeWidth={2}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  ),
  chevron: (s = 14) => (
    <svg {...base(s)} strokeWidth={2.2}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  bell: (s = 18) => (
    <svg {...base(s)}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  ),
  phone: (s = 18) => (
    <svg {...base(s)}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13 1 .37 1.96.72 2.88a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.2-1.29a2 2 0 0 1 2.11-.45c.92.35 1.88.59 2.88.72A2 2 0 0 1 22 16.92z" />
    </svg>
  ),
  leaf: (s = 22) => (
    <svg {...base(s)} strokeWidth={1.6}>
      <path d="M12 21c4-2.5 7-6 7-10a7 7 0 0 0-14 0c0 4 3 7.5 7 10Z" />
      <path d="M12 11.5c1.4-1 2.2-2.3 2.2-3.6M12 11.5c-1.4-1-2.2-2.3-2.2-3.6M12 11.5V21" />
    </svg>
  ),
  plus: (s = 16) => (
    <svg {...base(s)} strokeWidth={2.2}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
}
