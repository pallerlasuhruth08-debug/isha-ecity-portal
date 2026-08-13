import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
// Dashboard is the landing view and Login/Placeholder are tiny — keep those eager.
// Every other screen is code-split: the entry bundle was ~1.3 MB because all 18
// views were statically imported, so a coordinator opening the Dashboard also paid
// for Admin, Campaigns, Hub and every public portal.
import Dashboard from './views/Dashboard'
import Placeholder from './views/Placeholder'
import Login from './views/Login'
const Volunteers = lazy(() => import('./views/Volunteers'))
const Campaigns = lazy(() => import('./views/Campaigns'))
const Meditators = lazy(() => import('./views/Meditators'))
const Interest = lazy(() => import('./views/Interest'))
const Advance = lazy(() => import('./views/Advance'))
const Nurturing = lazy(() => import('./views/Nurturing'))
const Events = lazy(() => import('./views/Events'))
const Planning = lazy(() => import('./views/Planning'))
const Hub = lazy(() => import('./views/Hub'))
const Unresolved = lazy(() => import('./views/Unresolved'))
const Admin = lazy(() => import('./views/Admin'))
const PublicAccept = lazy(() => import('./views/PublicAccept'))
const PublicInterest = lazy(() => import('./views/PublicInterest'))
const PublicProgramInterest = lazy(() => import('./views/PublicProgramInterest'))
const PublicVolunteerPortal = lazy(() => import('./views/PublicVolunteerPortal'))
const AttendancePortal = lazy(() => import('./views/AttendancePortal'))
const VolunteerPortalClaim = lazy(() => import('./views/VolunteerPortalClaim'))
const Poojas = lazy(() => import('./views/Poojas'))
const PublicPoojas = lazy(() => import('./views/PublicPoojas'))

// Neutral hold while a split chunk arrives. Deliberately quiet — a spinner that
// flashes for 80ms is worse than a calm blank.
function ViewFallback() {
  return <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-body)' }}>Loading…</div>
}
import UtilityDrawer from './components/UtilityDrawer'
import CreateEventModal from './components/CreateEventModal'
import PwaUpdatePrompt from './components/PwaUpdatePrompt'
import { TAB_TITLES, TAB_LABELS, tabsForSections } from './lib/roles'
import { useSession } from './lib/useSession'
import { useBreakpoint } from './lib/useBreakpoint'
import { supabase } from './lib/supabase'

// Public volunteer tap-to-accept lands here (no login) via #accept=<blockId>.
function readHashId(key) {
  const m = (typeof window !== 'undefined' ? window.location.hash || '' : '').match(new RegExp(`${key}=([0-9a-f-]{36})`, 'i'))
  return m ? m[1] : null
}
// Volunteer-portal share tokens are 32-char hex (no dashes) — a distinct shape from
// the UUID-based public links above.
function readHashToken(key) {
  const m = (typeof window !== 'undefined' ? window.location.hash || '' : '').match(new RegExp(`${key}=([0-9a-f]{32})`, 'i'))
  return m ? m[1] : null
}
// New claim-based portal route: #volunteer-portal/<32-hex campaign token>[/batch/<uuid>].
// Path-shaped (not a=b) since it carries an optional second segment; hash-based (not a
// real path) because this is a static GH Pages deploy with no server-side SPA fallback,
// and these links get opened directly from WhatsApp. A volunteer never types the
// /batch/<id> part themselves — it's only ever set by the app after auto-assignment.
function readVolunteerPortalRoute() {
  const h = typeof window !== 'undefined' ? window.location.hash || '' : ''
  const m = h.match(/volunteer-portal\/([0-9a-f]{32})(?:\/batch\/([0-9a-f-]{36}))?/i)
  return m ? { token: m[1], splitId: m[2] || null } : null
}
// Public pooja listing: #poojas. One link for every open pooja — unlike the
// routes above it carries no id, because the guest browses rather than arriving
// at one specific thing. The guest's own request is held by a token in
// localStorage, not in the URL, so the link is safe to forward to anyone.
function isPoojasRoute() {
  const h = typeof window !== 'undefined' ? window.location.hash || '' : ''
  return /^#poojas\/?$/i.test(h)
}

// Public per-day attendance capture: #attend/<32-hex session token>.
function readAttendRoute() {
  const h = typeof window !== 'undefined' ? window.location.hash || '' : ''
  const m = h.match(/attend\/([0-9a-f]{32})/i)
  return m ? m[1] : null
}

// Resolves the public (no-login) hash routes. A plain function, NOT a component:
// App must reach its own return without calling a hook conditionally, so the
// route decision has to happen outside any hook's scope.
function publicRoute() {
  // Standing link, no id in it: one form for programme + volunteering interest,
  // shareable as a QR on a noticeboard rather than minted per event.
  if (/(^|#|&|\/)programmes?\b/i.test(typeof window !== 'undefined' ? window.location.hash || '' : '')) return <PublicProgramInterest />
  const acceptId = readHashId('accept')
  if (acceptId) return <PublicAccept blockId={acceptId} />
  const interestId = readHashId('interest')
  if (interestId) return <PublicInterest eventId={interestId} />
  const volunteerToken = readHashToken('volunteer')
  if (volunteerToken) return <PublicVolunteerPortal token={volunteerToken} />
  const vpRoute = readVolunteerPortalRoute()
  if (vpRoute) return <VolunteerPortalClaim token={vpRoute.token} splitId={vpRoute.splitId} />
  const attendToken = readAttendRoute()
  if (attendToken) return <AttendancePortal token={attendToken} />
  if (isPoojasRoute()) return <PublicPoojas />
  return null
}

export default function App() {
  // No hooks here at all. Public pages bypass the auth gate entirely; the authed
  // half lives in its own component so useSession() is always the first hook of
  // the first render, in every branch. Previously useSession() sat *below* these
  // early returns, so arriving at a public link and then clearing the hash changed
  // the hook count between renders — a crash waiting on a route change.
  const pub = publicRoute()
  if (pub) return <Suspense fallback={<ViewFallback />}>{pub}<PwaUpdatePrompt /></Suspense>
  return <AuthedApp />
}

function AuthedApp() {
  const { session, profile, sections } = useSession()

  if (session === undefined) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
        Loading…
      </div>
    )
  }
  if (session === null) return <><Login /><PwaUpdatePrompt /></>

  return <Portal profile={profile} email={session.user.email} sections={sections} />
}

function Portal({ profile, email, sections }) {
  const [view, setView] = useState('dashboard')
  const [toast, setToast] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [pendingEventId, setPendingEventId] = useState(null)
  const [createReq, setCreateReq] = useState(null) // { presetDate, dest } | null
  const [pendingInterestEventId, setPendingInterestEventId] = useState(null)
  const [pendingCampaignId, setPendingCampaignId] = useState(null)
  // A worklist row on the Dashboard navigates WITH its filter, so the number you
  // clicked is the list you land on. Same shape as the other pending* handoffs:
  // set on navigate, consumed once by the destination.
  const [pendingPreset, setPendingPreset] = useState(null) // { view, preset } | null
  const [pendingHubEventId, setPendingHubEventId] = useState(null) // open this event IN the hub
  const [campaignDraft, setCampaignDraft] = useState(null) // { eventId, eventName } — call-list build in progress
  const [recipientDraft, setRecipientDraft] = useState(null) // { campaignId, campaignName } — adding to an existing campaign
  const [hubListMode, setHubListMode] = useState(true) // Hub reports list-vs-event-detail so the Topbar knows when to show "+ Create event"
  const toastTimer = useRef(null)
  const { isPhone } = useBreakpoint()

  // Edge-swipe (mobile): a swipe starting at the right screen edge opens the drawer.
  // An ACCELERATOR, not the way in — the Topbar button is the discoverable path.
  useEffect(() => {
    let startX = null
    const onStart = (e) => { const x = e.touches?.[0]?.clientX; startX = x != null && x > window.innerWidth - 26 ? x : null }
    const onMove = (e) => { if (startX == null) return; const x = e.touches?.[0]?.clientX; if (x != null && startX - x > 45) { setToolsOpen(true); startX = null } }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    return () => { document.removeEventListener('touchstart', onStart); document.removeEventListener('touchmove', onMove) }
  }, [])

  // AUTHORITATIVE permission gate — derived from the real logged-in profile.role.
  // (The cosmetic persona switcher was removed; RLS is the true backstop server-side,
  // this only decides which controls to render.)
  const isCoordinator = ['admin', 'sector_nurturer', 'center_coordinator'].includes(profile?.role)
  const isAdmin = profile?.role === 'admin'

  // Tabs come from the role's granted sections (admin sees all + Admin). Data
  // scope is separately enforced by RLS (centre) + can_see_section — this is the
  // nav-visibility layer on top.
  const tabs = tabsForSections(sections, isAdmin)
  // 'planning' is routable per-event (from the hub) but no longer a sidebar tab.
  const routable = [...tabs, 'planning']
  const activeView = routable.includes(view) ? view : tabs[0]

  const showToast = useCallback((msg) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 3200)
  }, [])

  // Shared create-event trigger for the three in-context entry points (Planning,
  // Attendance, calendar). `dest` is the view to open the new event on afterwards.
  // Coordinator-gated here; RLS (act_insert) is the real backstop.
  const requestCreate = useCallback((presetDate = null, dest = 'events') => {
    if (!isCoordinator) return
    setCreateReq({ presetDate, dest })
  }, [isCoordinator])

  // Open an event inside the hub (calendar click, new event, returning sub-flow).
  const openEventHub = useCallback((eventId) => { setPendingHubEventId(eventId); setView('hub') }, [])
  const openCampaign = useCallback((campaignId) => { setPendingCampaignId(campaignId); setView('campaigns') }, [])
  const openList = useCallback((v, preset) => { setPendingPreset(preset ? { view: v, preset } : null); setView(v) }, [])
  const presetFor = useCallback((v) => (pendingPreset && pendingPreset.view === v ? pendingPreset.preset : null), [pendingPreset])
  const clearPreset = useCallback(() => setPendingPreset(null), [])

  // Call-list build: from the hub, pick an audience, go select recipients on that
  // list (event context held), then Create Campaign attaches them + the event_id.
  const startCampaignForEvent = useCallback((eventId, eventName, audience) => {
    if (!isCoordinator) return
    setCampaignDraft({ eventId, eventName })
    setView(audience === 'meditator' ? 'meditators' : 'volunteers')
  }, [isCoordinator])
  // Cancelling / finishing a call-list build returns to the event's hub.
  const endCampaignDraft = useCallback(() => {
    setCampaignDraft((d) => { if (d) { setPendingHubEventId(d.eventId); setView('hub') } return null })
  }, [])

  // Add-recipients-to-existing-campaign: from a campaign's detail, pick a source, go
  // select people on that full page (campaign context held), then Add appends them.
  const startAddRecipients = useCallback((campaignId, campaignName, source) => {
    if (!isCoordinator) return
    setRecipientDraft({ campaignId, campaignName })
    setView(source === 'meditators' ? 'meditators' : source === 'interest' ? 'interest' : 'volunteers')
  }, [isCoordinator])
  // Cancelling / finishing returns to the campaign we came from.
  const endRecipientDraft = useCallback(() => {
    setRecipientDraft((d) => { if (d) { setPendingCampaignId(d.campaignId); setView('campaigns') } return null })
  }, [])

  const [title, subtitle] = TAB_TITLES[activeView] || [TAB_LABELS[activeView], '']

  const content = useMemo(() => {
    switch (activeView) {
      case 'dashboard':
        return <Dashboard me={profile} onNavigate={setView} onOpenList={openList} onOpenEvent={openEventHub} />
      case 'volunteers':
        return <Volunteers me={profile} onToast={showToast} onNavigate={setView} preset={presetFor('volunteers')} onPresetConsumed={clearPreset} campaignDraft={campaignDraft} onClearCampaignDraft={endCampaignDraft} onDone={endCampaignDraft} recipientDraft={recipientDraft} onRecipientsDone={endRecipientDraft} />
      case 'campaigns':
        return <Campaigns me={profile} isCoordinator={isCoordinator} onToast={showToast} onNavigate={setView} openCampaignId={pendingCampaignId} onCampaignConsumed={() => setPendingCampaignId(null)} onAddRecipients={startAddRecipients} />
      case 'meditators':
        return <Meditators me={profile} onToast={showToast} preset={presetFor('meditators')} onPresetConsumed={clearPreset} campaignDraft={campaignDraft} onClearCampaignDraft={endCampaignDraft} onDone={endCampaignDraft} recipientDraft={recipientDraft} onRecipientsDone={endRecipientDraft} />
      case 'interest':
        return <Interest onToast={showToast} eventScopeId={pendingInterestEventId} onScopeConsumed={() => setPendingInterestEventId(null)} recipientDraft={recipientDraft} onRecipientsDone={endRecipientDraft} />
      case 'advance':
        return <Advance me={profile} onToast={showToast} />
      case 'nurturing':
        return <Nurturing me={profile} isCoordinator={isCoordinator} onToast={showToast} onOpenList={openList} />
      case 'events':
        return <Events me={profile} isCoordinator={isCoordinator} onToast={showToast} openEventId={pendingEventId} onEventConsumed={() => setPendingEventId(null)} />
      case 'planning':
        return <Planning me={profile} isCoordinator={isCoordinator} onToast={showToast} openEventId={pendingEventId} onEventConsumed={() => setPendingEventId(null)} />
      case 'hub':
        return <Hub me={profile} isCoordinator={isCoordinator} onToast={showToast} openEventId={pendingHubEventId} onEventConsumed={() => setPendingHubEventId(null)} onOpenCampaign={openCampaign} onStartCampaign={startCampaignForEvent} onOpenInterestInbox={(id) => { setPendingInterestEventId(id); setView('interest') }} onListModeChange={setHubListMode} onCreateEvent={isCoordinator ? () => requestCreate(null, 'hub') : undefined} />
      case 'poojas':
        return <Poojas me={profile} isCoordinator={isCoordinator} onToast={showToast} />
      case 'unresolved':
        return <Unresolved me={profile} isCoordinator={isCoordinator} onToast={showToast} />
      case 'admin':
        // Hard gate: even if the view is somehow selected, non-admins get nothing
        // (RLS also blocks every write these pages make).
        return isAdmin ? <Admin me={profile} onToast={showToast} /> : <Placeholder view="admin" title="Administration" />
      default:
        return <Placeholder view={activeView} title={TAB_LABELS[activeView]} />
    }
  }, [activeView, showToast, isCoordinator, isAdmin, profile, pendingEventId, requestCreate, openEventHub, openCampaign, startCampaignForEvent, endCampaignDraft, campaignDraft, recipientDraft, startAddRecipients, endRecipientDraft, pendingInterestEventId, pendingCampaignId, pendingHubEventId, openList, presetFor, clearPreset])

  // Event Hub's "+ Create event" lives in the Topbar on desktop (right side, same
  // row as the title) — only shown while Hub is showing the event LIST (not a
  // specific event's detail). On phone it moves to Hub's own full-width sticky
  // bottom CTA instead (same pattern as "Create campaign" elsewhere), since the
  // Topbar row is too cramped there.
  const topbarActions = activeView === 'hub' && hubListMode && isCoordinator && !isPhone ? (
    <button className="btn btn-primary" style={{ height: 36, padding: '0 14px', fontSize: 12 }} onClick={() => requestCreate(null, 'hub')}>＋ Create event</button>
  ) : null

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* Below the phone breakpoint the sidebar becomes an off-canvas drawer
          (opened by the Topbar hamburger); at tablet/desktop it stays in-flow. */}
      {isPhone ? (
        <Sidebar me={profile} view={activeView} tabs={tabs} onNavigate={setView} variant="drawer" open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      ) : (
        <Sidebar me={profile} view={activeView} tabs={tabs} onNavigate={setView} />
      )}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Topbar
          title={title}
          subtitle={subtitle}
          actions={topbarActions}
          me={profile}
          email={email}
          onSignOut={() => supabase.auth.signOut()}
          onMenu={isPhone ? () => setDrawerOpen(true) : undefined}
          onOpenTools={() => setToolsOpen(true)}
        />
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Suspense fallback={<ViewFallback />}>{content}</Suspense>
        </div>
      </main>

      {/* Utility drawer (calendar + notes), separate from the left nav. Opened from
          the labelled Topbar button; the right-edge swipe below stays as a shortcut
          for people who already know it. */}
      <UtilityDrawer
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
        me={profile}
        onOpenEvent={(id) => { setToolsOpen(false); openEventHub(id) }}
        onCreateEvent={isCoordinator ? (date) => { setToolsOpen(false); requestCreate(date, 'events') } : undefined}
      />

      {createReq && isCoordinator && (
        <CreateEventModal
          me={profile}
          presetDate={createReq.presetDate}
          onClose={() => setCreateReq(null)}
          onToast={showToast}
          onCreated={(id) => { setCreateReq(null); if (id) openEventHub(id) }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
      <PwaUpdatePrompt />
    </div>
  )
}
