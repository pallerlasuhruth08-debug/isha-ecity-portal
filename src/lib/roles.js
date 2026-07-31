// Role model. Roles are DATA (roles + role_sections tables); a role grants a set
// of SECTIONS and each section maps to one nav tab.
// Exact sidebar order. Standalone 'events' (Attendance) is intentionally not here —
// attendance now lives per-event inside the Event Hub. Admin is appended for admins.
export const ALL_TABS = [
  'dashboard',
  'hub',
  'volunteers',
  'meditators',
  'advance',
  'campaigns',
  'nurturing',
  'interest',
  'unresolved',
]

// Navigation grouped the way a coordinator's day is shaped, not as one flat list
// of ten. A flat list makes every destination look equally likely and forces the
// reader to scan all ten every time; grouping lets them jump to a region first.
//
// The groups are deliberately verbs-and-nouns from their world — "who am I
// looking after", "how am I reaching them" — rather than system categories.
// A group with no visible tabs (because the role doesn't grant them) disappears
// entirely, so a nurturer never sees an empty "Housekeeping" heading.
export const NAV_GROUPS = [
  { label: 'Today', tabs: ['dashboard'] },
  { label: 'People', tabs: ['volunteers', 'meditators', 'advance'] },
  { label: 'Reaching out', tabs: ['campaigns', 'nurturing', 'interest'] },
  { label: 'Events', tabs: ['hub'] },
  { label: 'Housekeeping', tabs: ['unresolved', 'admin'] },
]

// Display labels for the SEEDED profiles.role values. Roles are DATA — an admin
// can create new ones in Administration — so this map is only a nicety for the
// built-ins; any other role is humanised by roleLabel() rather than shown raw.
export const REAL_ROLE_LABEL = {
  admin: 'RCO / Admin',
  sector_nurturer: 'Sector Nurturer',
  center_coordinator: 'Centre Coordinator',
  nurturer: 'Nurturer',
  volunteer: 'Volunteer',
}

// Never render a raw role key. An admin-created role like `communication_team`
// shows as "Communication Team" instead of leaking the database key into the UI.
export function roleLabel(key) {
  if (!key) return ''
  if (REAL_ROLE_LABEL[key]) return REAL_ROLE_LABEL[key]
  return String(key)
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// Roles are DATA (roles + role_sections tables). A role grants a set of SECTIONS;
// each section maps to one nav tab. Center scope (which centre's data) is a
// separate dimension carried by profiles.center_id.
export const SECTION_TO_TAB = {
  dashboard: 'dashboard',
  volunteers: 'volunteers',
  meditators: 'meditators',
  advance: 'advance',
  event_hub: 'hub',
  attendance: 'events',
  nurturing: 'nurturing',
  interest: 'interest',
  campaigns: 'campaigns',
  unresolved: 'unresolved',
}
export const ALL_SECTIONS = Object.keys(SECTION_TO_TAB)
// Tabs the signed-in user may see: admin gets everything + Admin; everyone else
// gets exactly the tabs their role's granted sections map to.
export function tabsForSections(sections, isAdmin) {
  if (isAdmin) return [...ALL_TABS, 'admin']
  const allowed = new Set((sections || []).map((s) => SECTION_TO_TAB[s]).filter(Boolean))
  return ALL_TABS.filter((t) => allowed.has(t))
}

export const TAB_TITLES = {
  dashboard: ['Dashboard', 'Volunteer & meditator care at a glance'],
  volunteers: ['Volunteers', 'Organised by journey stage'],
  planning: ['Planning', 'Calendar & the things that need to get done'],
  events: ['Attendance', 'Mark show / no-show and capture walk-ins'],
  hub: ['Event Hub', 'Everything linked to one event — a read-through view'],
  nurturing: ['Nurturing & Care', 'Volunteer core groups & nurturers'],
  meditators: ['Meditators', 'Nurturing those who have completed programmes'],
  advance: ['Advance Programmes', 'Bhava Spandana, Shoonya, Samyama & Guru Puja'],
  interest: ['Interest Inbox', 'Post-programme & verbal interest — triage and route'],
  campaigns: ['Campaigns', 'Insight-led outreach for volunteers & meditators'],
  unresolved: ['Unresolved', 'Walk-in attendance awaiting a match'],
  admin: ['Administration', 'Users & roles, centres, and the pincode map'],
}

export const TAB_LABELS = {
  dashboard: 'Dashboard',
  volunteers: 'Volunteers',
  planning: 'Planning',
  events: 'Attendance',
  hub: 'Event Hub',
  nurturing: 'Nurturing & Care',
  meditators: 'Meditators',
  advance: 'Advance Programmes',
  interest: 'Interest Inbox',
  campaigns: 'Campaigns',
  unresolved: 'Unresolved',
  admin: 'Administration',
}
