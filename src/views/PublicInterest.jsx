import { useEffect, useState } from 'react'
import { SUPABASE_URL, SUPABASE_KEY } from '../lib/supabase'
import { fmtDay } from '../lib/planning'
import { checkMobile } from '../lib/phone'
import Field, { PublicShell, PublicDone } from '../components/Field'
import { allDayIcs, downloadIcs, safeFilename } from '../lib/calendarFile'

// Standalone, no-login page reached from an event's interest link (#interest=<eventId>).
// Registers interest in that specific occurrence (event_interest), person resolved by phone.
const FN = `${SUPABASE_URL}/functions/v1/event-interest`

export default function PublicInterest({ eventId }) {
  const [info, setInfo] = useState(undefined)
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [err, setErr] = useState(null)
  const [phoneErr, setPhoneErr] = useState(null)
  const [nameErr, setNameErr] = useState(null)

  useEffect(() => {
    fetch(`${FN}?event=${encodeURIComponent(eventId)}`, { headers: { apikey: SUPABASE_KEY } })
      .then((r) => r.json()).then((d) => setInfo(d.error ? null : d)).catch(() => setInfo(null))
  }, [eventId])

  async function submit() {
    // Name is asked for UP FRONT now. It used to be hidden until the server
    // replied "name-required", which surfaced a newcomer's first visit as an
    // ERROR and cost them a second submit — exactly the people we least want to
    // put a red message in front of.
    const nm = name.trim()
    const p = checkMobile(phone)
    setPhoneErr(p.ok ? null : p.reason)
    setNameErr(nm ? null : 'Please tell us your name.')
    if (!p.ok || !nm) return

    setErr(null); setBusy(true)
    try {
      const r = await fetch(FN, { method: 'POST', headers: { apikey: SUPABASE_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ event_id: eventId, phone: p.digits, name: nm }) })
      const d = await r.json()
      if (d.error) { setErr(d.error === 'name-required' ? 'Please tell us your name.' : d.error); return }
      setDone(d)
    } catch { setErr('Something went wrong. Please try again.') } finally { setBusy(false) }
  }

  return (
    <PublicShell>
      {info === undefined && <div style={{ color: 'var(--muted)' }}>Loading…</div>}
      {info === null && (
        <div className="card public-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>This link isn't valid</div>
          <div style={{ fontSize: 13.5, color: 'var(--muted)' }}>The event may have been removed. Please ask your coordinator for a fresh link.</div>
        </div>
      )}
      {done && (
        <PublicDone title={`Namaskaram${done.name ? `, ${done.name.split(' ')[0]}` : ''}!`} next="A coordinator from Isha Electronic City will call you on this number before the event with the timing and venue. If you don't hear from us in a few days, call the centre on 8095963111.">
          <div>Your interest in <strong>{info.eventName}</strong> is noted.</div>
          {/* Save the date — the date is all we hold. `activities` has no start time
              and no venue column, so this is an all-day entry and says so, rather
              than putting a made-up 9am in someone's calendar. */}
          {info.date && (
            <button
              className="btn btn-ghost"
              style={{ marginTop: 14 }}
              onClick={() => downloadIcs(
                allDayIcs({
                  title: info.eventName,
                  dateISO: info.date,
                  uid: `interest-${eventId}@isha-ecity`,
                  description: 'Isha Electronic City. A coordinator will call you before the event with the timing and venue.',
                }),
                `${safeFilename(info.eventName)}.ics`,
              )}
            >
              Save the date to my calendar
            </button>
          )}
        </PublicDone>
      )}
      {info && !done && (
        <div className="card public-card">
          <div style={{ fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700 }}>Register interest</div>
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: '4px 0 3px' }}>{info.eventName}</h2>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>{info.date ? fmtDay(info.date) : ''} · leave your details and we'll reach out.</div>

          <Field label="Your name" required value={name} error={nameErr}
            onChange={(e) => { setName(e.target.value); if (nameErr) setNameErr(null) }}
            placeholder="Full name" autoComplete="name" enterKeyHint="next" />

          <Field label="Mobile number" required value={phone} error={phoneErr}
            hint="10 digits. We'll use this to call you about the event."
            onChange={(e) => { setPhone(e.target.value); if (phoneErr) setPhoneErr(null) }}
            placeholder="9XXXXXXXXX" inputMode="numeric" autoComplete="tel" maxLength={15}
            enterKeyHint="send" onKeyDown={(e) => e.key === 'Enter' && submit()} />

          {err && <div className="field-error" role="alert" style={{ marginBottom: 12 }}>{err}</div>}
          <button className="btn btn-primary" disabled={busy} onClick={submit} style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: 15 }}>{busy ? 'Sending…' : "I'm interested"}</button>
        </div>
      )}
    </PublicShell>
  )
}
