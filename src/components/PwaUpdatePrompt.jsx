import { useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

// Mounted once at the top of App (covers both the logged-in Portal and the public,
// no-login pages) so the service worker registers everywhere and a newer build
// never gets stuck waiting silently. registerType: 'prompt' means updates don't
// apply themselves -- someone could be mid-form when a new version ships, so we
// wait for an explicit tap here instead of yanking the page out from under them.
//
// ── Why dismissing has to be a SNOOZE ───────────────────────────────────────
// It used to be a cancel: tapping ✕ set needRefresh to false and nothing ever set
// it back. The waiting service worker then sat there indefinitely, so the person
// kept using the OLD build — through hard reloads, which do not help, because a
// waiting worker only activates when it is asked to. I hit this myself while
// verifying a deploy and spent several minutes convinced the release had failed.
//
// For a coordinator the consequence is worse and silent: one stray tap and every
// fix shipped afterwards never reaches them, with no symptom except that the app
// quietly stops changing. An update prompt you can permanently lose is a bug
// multiplier — it disables every other improvement at once.
//
// So dismissing now means "not right now" and the prompt returns. The original
// intent is preserved (nobody is interrupted mid-form) without the trap, and the
// button says "Later" instead of a bare ✕ so it reads as what it actually does.
const SNOOZE_MS = 10 * 60 * 1000

export default function PwaUpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true })

  // Remembers that an update is genuinely waiting, independent of whether the
  // prompt is on screen — the library's flag doubles as our visibility flag, so
  // snoozing has to track the real state separately.
  const pending = useRef(false)
  const [snoozed, setSnoozed] = useState(false)

  useEffect(() => { if (needRefresh) pending.current = true }, [needRefresh])

  useEffect(() => {
    if (!snoozed) return
    const t = setTimeout(() => {
      setSnoozed(false)
      if (pending.current) setNeedRefresh(true)
    }, SNOOZE_MS)
    return () => clearTimeout(t)
  }, [snoozed, setNeedRefresh])

  if (snoozed) return null
  if (!offlineReady && !needRefresh) return null

  const dismiss = () => {
    if (needRefresh) { setNeedRefresh(false); setSnoozed(true); return }
    setOfflineReady(false)
  }

  return (
    <div style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 300, background: '#241B14', color: '#F6ECDC', padding: '11px 12px 11px 16px', borderRadius: 11, fontSize: 13.5, fontWeight: 500, boxShadow: '0 18px 44px rgba(60,40,20,0.28)', display: 'flex', alignItems: 'center', gap: 12, maxWidth: 'calc(100vw - 32px)' }}>
      <span>{needRefresh ? 'A new version is available.' : 'Ready to work offline.'}</span>
      {needRefresh ? (
        <button onClick={() => updateServiceWorker(true)} style={{ background: 'var(--orange, #C2691F)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 13px', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>Reload</button>
      ) : null}
      <button onClick={dismiss} aria-label={needRefresh ? 'Remind me later' : 'Dismiss'}
        style={{ background: 'none', border: 'none', color: '#B4A78C', fontSize: needRefresh ? 12.5 : 15, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', padding: '0 2px', lineHeight: 1, whiteSpace: 'nowrap' }}>
        {needRefresh ? 'Later' : '✕'}
      </button>
    </div>
  )
}
