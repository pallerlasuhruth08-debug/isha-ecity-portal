import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import Dashboard from './views/Dashboard'
import Volunteers from './views/Volunteers'
import Campaigns from './views/Campaigns'
import Meditators from './views/Meditators'
import Interest from './views/Interest'
import Advance from './views/Advance'
import Nurturing from './views/Nurturing'
import Events from './views/Events'
import Planning from './views/Planning'
import Hub from './views/Hub'
import Unresolved from './views/Unresolved'
import Admin from './views/Admin'
import Placeholder from './views/Placeholder'
import Login from './views/Login'
import PublicAccept from './views/PublicAccept'
import PublicInterest from './views/PublicInterest'
import UtilityDrawer from './components/UtilityDrawer'
import CreateEventModal from './components/CreateEventModal'
import { ALL_TABS, TAB_TITLES, TAB_LABELS } from './lib/roles'
import { useSession } from './lib/useSession'
import { useBreakpoint } from './lib/useBreakpoint'
import { supabase } from './lib/supabase'

// Public volunteer tap-to-accept lands here (no login) via #accept=<blockId>.
function readHashId(key) {
  const m = (typeof window !== 'undefined' ? window.location.hash || '' : '').match(new RegExp(`${key}=([0-9a-f-]{36})`, 'i'))
  return m ? m[1] : null
}

export default function App() {
  // Checked BEFORE any hook so the public pages bypass the auth gate entirely.
  const acceptId = readHashId('accept')
  if (acceptId) return <PublicAccept blockId={acceptId} />
  const interestId = readHashId('interest')
  if (interestId) return <PublicInterest eventId={interestId} />

  const { session, profile } = useSession()

  if (session === undefined) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
        Loading…
      </div>
    )
  }
  if (session === null) return <Login />

  return <Portal profile={profile} email={session.user.email} />
}

function Portal({ profile, email }) {
  const [view, setView] = useState('dashboard')
  const [toast, setToast] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [pendingEventId, setPendingEventId] = useState(null)
  const [createReq, setCreateReq] = useState(null) // { presetDate, dest } | null
  const [pendingInterestEventId, setPendingInterestEventId] = useState(null)
  const [pendingCampaignId, setPendingCampaignId] = useState(null)
  const [pendingHubEventId, setPendingHubEventId] = useState(null) // open this event IN the hub
  const [campaignDraft, setCampaignDraft] = useState(null) // { eventId, eventName } — call-list build in progress
  const toastTimer = useRef(null)
  const { isPhone } = useBreakpoint()

  // Edge-swipe (mobile): a swipe starting at the right screen edge opens the tools drawer.
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

  // Everyone sees the full tab set (Admin appended only for real admins). Data scope
  // is enforced by RLS per the real role, not by hiding tabs.
  const tabs = isAdmin ? [...ALL_TABS, 'admin'] : ALL_TABS
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

  const [title, subtitle] = TAB_TITLES[activeView] || [TAB_LABELS[activeView], '']

  const content = useMemo(() => {
    switch (activeView) {
      case 'dashboard':
        return <Dashboard me={profile} onToast={showToast} onNavigate={setView} />
      case 'volunteers':
        return <Volunteers me={profile} onToast={showToast} onNavigate={setView} campaignDraft={campaignDraft} onClearCampaignDraft={endCampaignDraft} onDone={endCampaignDraft} />
      case 'campaigns':
        return <Campaigns me={profile} isCoordinator={isCoordinator} onToast={showToast} onNavigate={setView} openCampaignId={pendingCampaignId} onCampaignConsumed={() => setPendingCampaignId(null)} />
      case 'meditators':
        return <Meditators me={profile} onToast={showToast} campaignDraft={campaignDraft} onClearCampaignDraft={endCampaignDraft} onDone={endCampaignDraft} />
      case 'interest':
        return <Interest onToast={showToast} eventScopeId={pendingInterestEventId} onScopeConsumed={() => setPendingInterestEventId(null)} />
      case 'advance':
        return <Advance me={profile} onToast={showToast} />
      case 'nurturing':
        return <Nurturing me={profile} isCoordinator={isCoordinator} onToast={showToast} />
      case 'events':
        return <Events me={profile} isCoordinator={isCoordinator} onToast={showToast} openEventId={pendingEventId} onEventConsumed={() => setPendingEventId(null)} />
      case 'planning':
        return <Planning me={profile} isCoordinator={isCoordinator} onToast={showToast} openEventId={pendingEventId} onEventConsumed={() => setPendingEventId(null)} />
      case 'hub':
        return <Hub me={profile} isCoordinator={isCoordinator} onToast={showToast} openEventId={pendingHubEventId} onEventConsumed={() => setPendingHubEventId(null)} onOpenCampaign={openCampaign} onStartCampaign={startCampaignForEvent} onOpenInterestInbox={(id) => { setPendingInterestEventId(id); setView('interest') }} onCreateEvent={isCoordinator ? () => requestCreate(null, 'hub') : undefined} />
      case 'unresolved':
        return <Unresolved me={profile} isCoordinator={isCoordinator} onToast={showToast} />
      case 'admin':
        // Hard gate: even if the view is somehow selected, non-admins get nothing
        // (RLS also blocks every write these pages make).
        return isAdmin ? <Admin me={profile} onToast={showToast} /> : <Placeholder view="admin" title="Administration" />
      default:
        return <Placeholder view={activeView} title={TAB_LABELS[activeView]} />
    }
  }, [activeView, showToast, isCoordinator, isAdmin, profile, pendingEventId, requestCreate, openEventHub, openCampaign, startCampaignForEvent, endCampaignDraft, campaignDraft, pendingInterestEventId, pendingCampaignId, pendingHubEventId])

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
          me={profile}
          email={email}
          onSignOut={() => supabase.auth.signOut()}
          onMenu={isPhone ? () => setDrawerOpen(true) : undefined}
        />
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{content}</div>
      </main>

      {/* Utility drawer (calendar + notes), separate from the left nav — a fixed
          edge tab opens it (swipe from the right edge also works on mobile). */}
      {!toolsOpen && (
        <button
          onClick={() => setToolsOpen(true)}
          aria-label="Open tools"
          style={{ position: 'fixed', right: 0, top: '50%', transform: 'translateY(-50%)', zIndex: 130, background: '#241B14', color: '#F6ECDC', border: 'none', borderRadius: '10px 0 0 10px', padding: '14px 7px', cursor: 'pointer', writingMode: 'vertical-rl', fontSize: 11.5, fontWeight: 700, letterSpacing: '.08em', boxShadow: '-2px 2px 10px rgba(0,0,0,0.18)' }}
        >
          ✦ TOOLS
        </button>
      )}
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
    </div>
  )
}
