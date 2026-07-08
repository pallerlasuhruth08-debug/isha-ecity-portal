// Role model ported from the Volunteer Care Portal design (ROLES + tabs).
// Each role controls which nav tabs are visible and the header scope label.
export const ALL_TABS = [
  'dashboard',
  'volunteers',
  'events',
  'hub',
  'nurturing',
  'meditators',
  'advance',
  'interest',
  'campaigns',
  'unresolved',
]

export const ROLES = {
  centre: {
    key: 'centre',
    label: 'Centre Coordinator',
    who: 'Meera M.',
    scope: 'All sectors',
    tabs: ALL_TABS,
    full: true,
  },
  sector: {
    key: 'sector',
    label: 'Sector Coordinator',
    who: 'Arvind R.',
    scope: 'Sector 4 only',
    tabs: ALL_TABS,
    full: true,
  },
  nurturing: {
    key: 'nurturing',
    label: 'Nurturing Coordinator',
    who: 'Ananya Rao',
    scope: 'All sectors',
    tabs: ALL_TABS,
    full: true,
  },
  volunteer: {
    key: 'volunteer',
    label: 'Volunteer Coordinator',
    who: 'Divya Menon',
    scope: 'Sector 4',
    tabs: ['dashboard', 'volunteers', 'planning', 'events', 'nurturing', 'interest', 'campaigns', 'unresolved'],
  },
  meditator: {
    key: 'meditator',
    label: 'Meditator Coordinator',
    who: 'Karthik V.',
    scope: 'All meditators',
    tabs: ['dashboard', 'meditators', 'interest', 'campaigns'],
  },
  advance: {
    key: 'advance',
    label: 'Advance Program Coordinator',
    who: 'Shankar P.',
    scope: 'Advance cohorts',
    tabs: ['dashboard', 'advance', 'nurturing', 'interest', 'campaigns'],
  },
  caller: {
    key: 'caller',
    label: 'Caller',
    who: 'Meena K',
    scope: 'Assigned call lists',
    tabs: ['campaigns'],
  },
}

// Human labels for the REAL profiles.role values (distinct from the cosmetic
// persona ROLES above). Used to show the actual signed-in user's role.
export const REAL_ROLE_LABEL = {
  admin: 'RCO / Admin',
  sector_nurturer: 'Sector Nurturer',
  center_coordinator: 'Centre Coordinator',
  nurturer: 'Nurturer',
  volunteer: 'Volunteer',
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

export const ROLE_ORDER = [
  'centre',
  'sector',
  'nurturing',
  'volunteer',
  'meditator',
  'advance',
  'caller',
]

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
