import { useRegisterSW } from 'virtual:pwa-register/react'

// Mounted once at the top of App (covers both the logged-in Portal and the public,
// no-login pages) so the service worker registers everywhere and a newer build
// never gets stuck waiting silently. registerType: 'prompt' means updates don't
// apply themselves -- someone could be mid-form when a new version ships, so we
// wait for an explicit tap here instead of yanking the page out from under them.
export default function PwaUpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true })

  if (!offlineReady && !needRefresh) return null

  const close = () => { setOfflineReady(false); setNeedRefresh(false) }

  return (
    <div style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 300, background: '#241B14', color: '#F6ECDC', padding: '11px 12px 11px 16px', borderRadius: 11, fontSize: 13.5, fontWeight: 500, boxShadow: '0 18px 44px rgba(60,40,20,0.28)', display: 'flex', alignItems: 'center', gap: 12, maxWidth: 'calc(100vw - 32px)' }}>
      <span>{needRefresh ? 'A new version is available.' : 'Ready to work offline.'}</span>
      {needRefresh ? (
        <button onClick={() => updateServiceWorker(true)} style={{ background: 'var(--orange, #C2691F)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 13px', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>Reload</button>
      ) : null}
      <button onClick={close} aria-label="Dismiss" style={{ background: 'none', border: 'none', color: '#B4A78C', fontSize: 15, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>✕</button>
    </div>
  )
}
