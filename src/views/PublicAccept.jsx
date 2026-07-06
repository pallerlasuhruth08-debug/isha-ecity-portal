import { useEffect, useState } from 'react'
import { SUPABASE_URL, SUPABASE_KEY } from '../lib/supabase'
import { fmtDay } from '../lib/planning'

// Standalone, no-login page reached from a broadcast/form link (#accept=<blockId>).
// A volunteer identifies by phone and picks days; the event-accept edge function
// resolves them to a canonical person and records a TYPED block_acceptance.
const FN = `${SUPABASE_URL}/functions/v1/event-accept`
const box = { maxWidth: 440, margin: '0 auto', width: '100%' }
const inputStyle = { padding: '12px 13px', border: '1px solid var(--border)', borderRadius: 10, fontSize: 15, fontFamily: 'inherit', background: '#fff', color: 'var(--ink)', outline: 'none', width: '100%', boxSizing: 'border-box' }

export default function PublicAccept({ blockId }) {
  const [info, setInfo] = useState(undefined) // undefined=loading, null=invalid
  const [days, setDays] = useState([])
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [needName, setNeedName] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    fetch(`${FN}?block=${encodeURIComponent(blockId)}`, { headers: { apikey: SUPABASE_KEY } })
      .then((r) => r.json())
      .then((d) => setInfo(d.error ? null : d))
      .catch(() => setInfo(null))
  }, [blockId])

  const toggle = (d) => setDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d]))

  async function submit() {
    if (!days.length) return setErr('Pick at least one day.')
    setErr(null); setBusy(true)
    try {
      const r = await fetch(FN, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ block_id: blockId, phone, name, day_dates: days }),
      })
      const d = await r.json()
      if (d.error === 'name-required') { setNeedName(true); setErr("You're new to us — please add your name."); return }
      if (d.error) { setErr(d.error); return }
      setDone(d)
    } catch (e) {
      setErr('Something went wrong. Please try again.')
    } finally { setBusy(false) }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '40px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ ...box, textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontFamily: "'Newsreader',serif", fontSize: 22, fontWeight: 600, color: 'var(--orange)' }}>Isha E-City · Volunteer Care</div>
      </div>

      {info === undefined && <div style={{ ...box, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>}
      {info === null && (
        <div className="card" style={{ ...box, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>This link isn't valid</div>
          <div style={{ fontSize: 13.5, color: 'var(--muted)' }}>The activity may have been removed. Please ask your coordinator for a fresh link.</div>
        </div>
      )}

      {done && (
        <div className="card" style={{ ...box, padding: 26, textAlign: 'center' }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🙏</div>
          <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>Namaskaram{done.name ? `, ${done.name.split(' ')[0]}` : ''}!</div>
          <div style={{ fontSize: 14, color: 'var(--ink-soft)' }}>
            You're on the list for <strong>{info.heading}</strong> on {done.days.map(fmtDay).join(', ')}. Your coordinator will confirm.
          </div>
        </div>
      )}

      {info && !done && (
        <div className="card" style={{ ...box, padding: 22 }}>
          <div style={{ fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700 }}>{info.eventName}</div>
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: '4px 0 3px' }}>{info.heading}</h2>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>{info.needed} volunteer{info.needed !== 1 ? 's' : ''} needed each day. Pick the day(s) you can help.</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
            {info.days.map((d) => (
              <label key={d} style={{ display: 'flex', alignItems: 'center', gap: 11, border: `1px solid ${days.includes(d) ? 'var(--orange)' : 'var(--border)'}`, background: days.includes(d) ? '#FBF1E6' : '#fff', borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}>
                <input type="checkbox" checked={days.includes(d)} onChange={() => toggle(d)} style={{ width: 18, height: 18 }} />
                <span style={{ fontSize: 15, fontWeight: 600 }}>{fmtDay(d)}</span>
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Your phone number" inputMode="tel" style={inputStyle} />
            {needName && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" style={inputStyle} autoFocus />}
          </div>

          {err && <div style={{ fontSize: 13, color: '#B5532F', marginBottom: 12 }}>{err}</div>}
          <button className="btn btn-primary" disabled={busy} onClick={submit} style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: 15 }}>
            {busy ? 'Sending…' : "Count me in"}
          </button>
        </div>
      )}
    </div>
  )
}
