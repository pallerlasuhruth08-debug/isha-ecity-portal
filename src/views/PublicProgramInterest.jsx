import { useEffect, useState } from 'react'
import { SUPABASE_URL, SUPABASE_KEY } from '../lib/supabase'
import { PROGRAMS } from '../lib/programCatalog'
import { checkMobile } from '../lib/phone'
import Field, { PublicShell, PublicDone } from '../components/Field'

// Standalone, no-login page reached from the shared interest link (#programmes).
// Captures BOTH halves of "I'm interested": which programmes, and whether they'd
// like to volunteer — because the two questions reach the same person on the same
// noticeboard, and asking them separately loses the cross-signal.
//
// Everything lands in tables the Interest Inbox already unions
// (advanced_interest / volunteer_profiles), so the Inbox needs no change at all.
const FN = `${SUPABASE_URL}/functions/v1/program-interest`

const LABEL_BY_KEY = Object.fromEntries(PROGRAMS.map((p) => [p.key, p.label]))

export default function PublicProgramInterest() {
  const [cfg, setCfg] = useState(undefined) // { programs: [key], areas: [label] } | null
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [pincode, setPincode] = useState('')
  const [note, setNote] = useState('')
  const [picked, setPicked] = useState([]) // programme keys
  const [volunteer, setVolunteer] = useState(false)
  const [areas, setAreas] = useState([]) // volunteer area labels
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [err, setErr] = useState(null)
  const [fieldErr, setFieldErr] = useState({})

  // The server owns both vocabularies. Fetching them means this page can never
  // offer a programme the database would reject, or a volunteer area outside
  // settings.volunteer_interest_areas — and either list can be changed without
  // touching this file.
  useEffect(() => {
    fetch(FN, { headers: { apikey: SUPABASE_KEY } })
      .then((r) => r.json())
      .then((d) => setCfg(d && d.programs ? d : null))
      .catch(() => setCfg(null))
  }, [])

  const toggle = (list, set, v) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  async function submit() {
    const nm = name.trim()
    const p = checkMobile(phone)
    const pin = pincode.replace(/\D/g, '')
    const fe = {}
    if (!nm) fe.name = 'Please tell us your name.'
    if (!p.ok) fe.phone = p.reason
    if (pin && pin.length !== 6) fe.pincode = 'A pincode is 6 digits.'
    if (!picked.length && !volunteer) fe.choice = 'Choose at least one programme, or tick that you would like to volunteer.'
    setFieldErr(fe)
    if (Object.keys(fe).length) return

    setErr(null); setBusy(true)
    try {
      const r = await fetch(FN, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ name: nm, phone: p.digits, pincode: pin, note: note.trim(), programs: picked, volunteer, areas }),
      })
      const d = await r.json()
      if (d.error) { setErr(d.error); return }
      setDone(d)
    } catch {
      setErr('Something went wrong. Please try again.')
    } finally { setBusy(false) }
  }

  if (done) {
    const list = (keys) => keys.map((k) => LABEL_BY_KEY[k] || k).join(', ')
    return (
      <PublicShell>
        <PublicDone
          title={`Namaskaram${done.name ? `, ${done.name.split(' ')[0]}` : ''}!`}
          next="A volunteer from Isha Electronic City will call you on this number. If you don't hear from us in a few days, call the centre on 8095963111."
        >
          {done.added?.length > 0 && <div>Your interest in <strong>{list(done.added)}</strong> is noted.</div>}
          {/* Said plainly rather than hidden: someone who fills the form twice
              should be told we already had them, not silently given the same
              confirmation as a first-time submission. */}
          {done.already?.length > 0 && (
            <div style={{ marginTop: 6 }}>We already had you down for <strong>{list(done.already)}</strong> — nothing was changed there.</div>
          )}
          {done.volunteer === 'new' && <div style={{ marginTop: 6 }}>You're on the volunteering list too.</div>}
          {done.volunteer === 'existing' && <div style={{ marginTop: 6 }}>You were already on the volunteering list.</div>}
        </PublicDone>
      </PublicShell>
    )
  }

  const programmes = cfg ? PROGRAMS.filter((p) => cfg.programs.includes(p.key)) : []

  return (
    <PublicShell>
      {cfg === undefined && <div style={{ color: 'var(--muted)' }}>Loading…</div>}
      {cfg === null && (
        <div className="card public-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>This form isn't available right now</div>
          <div style={{ fontSize: 13.5, color: 'var(--muted)' }}>Please try again in a little while, or call the centre on 8095963111.</div>
        </div>
      )}
      {cfg && (
        <div className="card public-card">
          <h1 style={{ fontSize: 19, fontWeight: 600, margin: '0 0 4px' }}>Register your interest</h1>
          <div style={{ fontSize: 13.5, color: 'var(--muted)', marginBottom: 18 }}>
            Tell us which programmes you'd like to know about, and whether you'd like to volunteer. A volunteer will call you.
          </div>

          <Field label="Your name" required value={name} error={fieldErr.name}
            onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Full name" />

          <Field label="Mobile number" required value={phone} error={fieldErr.phone}
            hint="We use this to recognise you and to call you back."
            onChange={(e) => setPhone(e.target.value)} inputMode="numeric" autoComplete="tel" placeholder="10-digit mobile" />

          <Field label="Pincode" value={pincode} error={fieldErr.pincode}
            hint="So we can put you with your nearest centre."
            onChange={(e) => setPincode(e.target.value)} inputMode="numeric" autoComplete="postal-code" placeholder="e.g. 560100" />

          <fieldset style={{ border: 'none', padding: 0, margin: '18px 0 0' }}>
            <legend className="field-label" style={{ padding: 0 }}>Programmes you're interested in</legend>
            <div className="field-hint" style={{ marginBottom: 8 }}>Tick as many as you like.</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 2 }}>
              {programmes.map((p) => (
                <label key={p.key} style={rowStyle}>
                  <input type="checkbox" checked={picked.includes(p.key)} onChange={() => toggle(picked, setPicked, p.key)} style={boxStyle} />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset style={{ border: 'none', padding: 0, margin: '18px 0 0' }}>
            <legend className="field-label" style={{ padding: 0 }}>Volunteering</legend>
            <label style={rowStyle}>
              <input type="checkbox" checked={volunteer} onChange={(e) => setVolunteer(e.target.checked)} style={boxStyle} />
              <span>I'd like to volunteer at the centre</span>
            </label>
            {volunteer && cfg.areas.length > 0 && (
              <div style={{ marginTop: 8, paddingLeft: 4 }}>
                <div className="field-hint" style={{ marginBottom: 6 }}>Anything you'd particularly like to help with? (optional)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 2 }}>
                  {cfg.areas.map((a) => (
                    <label key={a} style={rowStyle}>
                      <input type="checkbox" checked={areas.includes(a)} onChange={() => toggle(areas, setAreas, a)} style={boxStyle} />
                      {/* No textTransform: these labels come from settings and are
                          already written the way the centre words them. Capitalising
                          turned "Emedia / social media" into "Emedia / Social Media". */}
                      <span>{a}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </fieldset>

          {fieldErr.choice && <div className="field-error" role="alert" style={{ marginTop: 10 }}>{fieldErr.choice}</div>}

          <div style={{ marginTop: 18 }}>
            <Field label="Anything else we should know?" value={note} onChange={(e) => setNote(e.target.value)}>
              {({ id, describedBy }) => (
                <textarea id={id} className="field-input" aria-describedby={describedBy} rows={3}
                  value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional — e.g. when you're usually free" style={{ resize: 'vertical' }} />
              )}
            </Field>
          </div>

          {err && <div className="field-error" role="alert" style={{ marginTop: 12 }}>{err}</div>}

          <button className="btn btn-primary" disabled={busy} onClick={submit}
            style={{ width: '100%', minHeight: 48, marginTop: 18, justifyContent: 'center', fontSize: 15 }}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      )}
    </PublicShell>
  )
}

// 44px rows: a thumb target, not a mouse target — same rule as Field.jsx.
const rowStyle = { display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, fontSize: 14.5, cursor: 'pointer' }
const boxStyle = { width: 20, height: 20, flexShrink: 0, cursor: 'pointer' }
