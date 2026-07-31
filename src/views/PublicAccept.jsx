import { useEffect, useState } from 'react'
import { SUPABASE_URL, SUPABASE_KEY } from '../lib/supabase'
import { fmtDay } from '../lib/planning'
import { checkMobile } from '../lib/phone'
import Field, { PublicShell, PublicDone } from '../components/Field'

// Standalone, no-login page reached from a broadcast/form link (#accept=<blockId>).
// A volunteer identifies by phone and picks days; the event-accept edge function
// resolves them to a canonical person and records a TYPED block_acceptance.
const FN = `${SUPABASE_URL}/functions/v1/event-accept`

export default function PublicAccept({ blockId }) {
  const [info, setInfo] = useState(undefined) // undefined=loading, null=invalid
  const [days, setDays] = useState([])
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [err, setErr] = useState(null)
  const [phoneErr, setPhoneErr] = useState(null)
  const [nameErr, setNameErr] = useState(null)

  useEffect(() => {
    fetch(`${FN}?block=${encodeURIComponent(blockId)}`, { headers: { apikey: SUPABASE_KEY } })
      .then((r) => r.json())
      .then((d) => setInfo(d.error ? null : d))
      .catch(() => setInfo(null))
  }, [blockId])

  const toggle = (d) => setDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d]))

  async function submit() {
    // Name up front, not surfaced as an error on the second attempt: a newcomer's
    // first contact with the centre should not be a red message.
    const nm = name.trim()
    const p = checkMobile(phone)
    setPhoneErr(p.ok ? null : p.reason)
    setNameErr(nm ? null : 'Please tell us your name.')
    if (!days.length) { setErr('Pick at least one day.'); return }
    if (!p.ok || !nm) return
    setErr(null); setBusy(true)
    try {
      const r = await fetch(FN, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ block_id: blockId, phone: p.digits, name: nm, day_dates: days }),
      })
      const d = await r.json()
      if (d.error) { setErr(d.error === 'name-required' ? 'Please tell us your name.' : d.error); return }
      setDone(d)
    } catch {
      setErr('Something went wrong. Please try again.')
    } finally { setBusy(false) }
  }

  return (
    <PublicShell>
      {info === undefined && <div style={{ color: 'var(--muted)' }}>Loading…</div>}
      {info === null && (
        <div className="card public-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>This link isn't valid</div>
          <div style={{ fontSize: 13.5, color: 'var(--muted)' }}>The activity may have been removed. Please ask your coordinator for a fresh link.</div>
        </div>
      )}

      {done && (
        <PublicDone title={`Namaskaram${done.name ? `, ${done.name.split(' ')[0]}` : ''}!`} next="Your coordinator confirms the roster a few days before and will message you on this number with the reporting time and place. Nothing more is needed from you now.">
          You're on the list for <strong>{info.heading}</strong> on {done.days.map(fmtDay).join(', ')}.
        </PublicDone>
      )}

      {info && !done && (
        <div className="card public-card">
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

          <Field label="Your name" required value={name} error={nameErr}
            onChange={(e) => { setName(e.target.value); if (nameErr) setNameErr(null) }}
            placeholder="Full name" autoComplete="name" enterKeyHint="next" />

          <Field label="Mobile number" required value={phone} error={phoneErr}
            hint="10 digits. Your coordinator will confirm on this number."
            onChange={(e) => { setPhone(e.target.value); if (phoneErr) setPhoneErr(null) }}
            placeholder="9XXXXXXXXX" inputMode="numeric" autoComplete="tel" maxLength={15}
            enterKeyHint="send" onKeyDown={(e) => e.key === 'Enter' && submit()} />

          {err && <div className="field-error" role="alert" style={{ marginBottom: 12 }}>{err}</div>}
          <button className="btn btn-primary" disabled={busy} onClick={submit} style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: 15 }}>
            {busy ? 'Sending…' : "Count me in"}
          </button>
        </div>
      )}
    </PublicShell>
  )
}
