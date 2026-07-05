import { useCallback, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import Dashboard from './views/Dashboard'
import Volunteers from './views/Volunteers'
import Campaigns from './views/Campaigns'
import CallerWorkspace from './views/CallerWorkspace'
import Meditators from './views/Meditators'
import Interest from './views/Interest'
import Advance from './views/Advance'
import Nurturing from './views/Nurturing'
import Events from './views/Events'
import Planning from './views/Planning'
import Unresolved from './views/Unresolved'
import Placeholder from './views/Placeholder'
import Login from './views/Login'
import { ROLES, TAB_TITLES, TAB_LABELS } from './lib/roles'
import { useSession } from './lib/useSession'
import { supabase } from './lib/supabase'

export default function App() {
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
  const [role, setRole] = useState('centre')
  const [view, setView] = useState('dashboard')
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  // AUTHORITATIVE permission gate — derived from the real logged-in profile.role,
  // NOT the (cosmetic, demo) persona switcher. Coordinator-capable roles get can_all()
  // server-side (RLS is the true backstop); this only decides which controls to render.
  const isCoordinator = ['admin', 'sector_nurturer', 'center_coordinator'].includes(profile?.role)

  const roleDef = ROLES[role]
  const tabs = roleDef.tabs
  // If the current view isn't allowed for this role, fall back to the first tab.
  const activeView = tabs.includes(view) ? view : tabs[0]

  const showToast = useCallback((msg) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 3200)
  }, [])

  const pickRole = useCallback((rk) => {
    setRole(rk)
    setView(ROLES[rk].tabs[0])
  }, [])

  const [title, subtitle] = TAB_TITLES[activeView] || [TAB_LABELS[activeView], '']

  const content = useMemo(() => {
    switch (activeView) {
      case 'dashboard':
        return <Dashboard onToast={showToast} onNavigate={setView} />
      case 'volunteers':
        return <Volunteers onToast={showToast} onNavigate={setView} />
      case 'campaigns':
        // Caller persona works through their own assigned call lists. The coordinator
        // view exposes dial/log/edit controls only when the REAL role is coordinator.
        return role === 'caller' ? (
          <CallerWorkspace me={profile} onToast={showToast} />
        ) : (
          <Campaigns me={profile} isCoordinator={isCoordinator} onToast={showToast} onNavigate={setView} />
        )
      case 'meditators':
        return <Meditators onToast={showToast} />
      case 'interest':
        return <Interest onToast={showToast} />
      case 'advance':
        return <Advance onToast={showToast} />
      case 'nurturing':
        return <Nurturing me={profile} isCoordinator={isCoordinator} onToast={showToast} />
      case 'events':
        return <Events me={profile} isCoordinator={isCoordinator} onToast={showToast} />
      case 'planning':
        return <Planning onToast={showToast} />
      case 'unresolved':
        return <Unresolved me={profile} isCoordinator={isCoordinator} onToast={showToast} />
      default:
        return <Placeholder view={activeView} title={TAB_LABELS[activeView]} />
    }
  }, [activeView, showToast, role, profile])

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden', background: 'var(--bg)' }}>
      <Sidebar role={role} view={activeView} tabs={tabs} onNavigate={setView} />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Topbar
          role={role}
          title={title}
          subtitle={subtitle}
          onPickRole={pickRole}
          user={profile?.full_name || email}
          onSignOut={() => supabase.auth.signOut()}
        />
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{content}</div>
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
