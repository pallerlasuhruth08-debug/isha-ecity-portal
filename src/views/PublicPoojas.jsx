import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { checkMobile } from '../lib/phone'
import Field, { PublicShell, PublicDone } from '../components/Field'

// Public, no-login pooja listing (#poojas). A guest — meditator or not — browses
// upcoming poojas, requests seats, and comes back later to see whether a
// volunteer approved them.
//
// Nobody reading this page is ever called a coordinator. The people running it
// are volunteers, and that is the word guests and hosts see.
//
// THE RULE (POOJA_INTEGRATION.md): a host's address and phone number reach a
// guest through pooja_my_request ONLY, and only once that request is approved.
// So this file calls exactly four RPCs and never touches a table. If you are
// about to add a select on pooja_listings here — stop. The anon key cannot read
// it, and this page is where a leak would surface.
//
// The token returned by pooja_request_seat is the guest's ONLY handle on their
// request. It lives in localStorage; clearing site data loses the request (by
// design — there are no guest accounts in v1).

const TOKENS_KEY = 'pooja_tokens'
const PIN_KEY = 'pooja_pincode'

// An array, not a single token: a guest may hold seats at two different poojas,
// and storing one string would silently drop the first one's address.
function readTokens() {
  try {
    const v = JSON.parse(localStorage.getItem(TOKENS_KEY) || '[]')
    return Array.isArray(v) ? v.filter((t) => typeof t === 'string') : []
  } catch { return [] }
}
function addToken(t) {
  const next = [...new Set([t, ...readTokens()])]
  try { localStorage.setItem(TOKENS_KEY, JSON.stringify(next)) } catch { /* private mode — the session still works, just not the return visit */ }
  return next
}

const fmtWhen = (ts) => (ts
  ? new Date(ts).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  : '')
const fmtDay = (ts) => (ts
  ? new Date(ts).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })
  : '')

// Guest-facing wording, not the database's. "declined" is a host's judgement
// call about one evening, and should not read like a verdict on the person.
const STATUS = {
  requested: { label: 'Awaiting approval', bg: 'var(--warning-bg)', fg: 'var(--warning-fg)' },
  approved: { label: 'Approved', bg: 'var(--success-bg)', fg: 'var(--success-fg)' },
  declined: { label: 'Not this time', bg: 'var(--neutral-bg)', fg: 'var(--neutral-fg)' },
  cancelled: { label: 'Cancelled', bg: 'var(--neutral-bg)', fg: 'var(--neutral-fg)' },
}

const stack = { width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 14 }
const metaRow = { fontSize: 13, color: 'var(--muted)', lineHeight: 1.55 }
const sectionLabel = { fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700 }

// "Nearest" without a map. A pincode is all a guest is asked for and all a
// listing carries, so closeness is |difference| between the two numbers — crude,
// but in Bangalore adjacent pincodes really are adjacent places, and it is
// enough to float the poojas up the page that are worth the guest's attention.
// Same pincode always wins outright.
function distanceScore(listingPin, guestPin) {
  const a = Number(String(listingPin || '').replace(/\D/g, ''))
  const b = Number(String(guestPin || '').replace(/\D/g, ''))
  if (!a || !b || String(b).length !== 6) return null
  if (a === b) return 0
  return Math.abs(a - b)
}

export default function PublicPoojas() {
  const [list, setList] = useState(undefined)  // undefined = loading, null = failed, [] = none open
  const [mine, setMine] = useState([])         // [{ token, status, title, ... }]
  const [sel, setSel] = useState(null)         // the pooja being requested
  const [done, setDone] = useState(null)       // { name, title } after a successful request
  const [pin, setPin] = useState(() => { try { return localStorage.getItem(PIN_KEY) || '' } catch { return '' } })

  const loadList = useCallback(async () => {
    const { data, error } = await supabase.rpc('pooja_public_list')
    setList(error ? null : (data || []))
  }, [])

  // One call per stored token. There is no batch form — the token IS the
  // authorisation, so each is checked on its own.
  const loadMine = useCallback(async () => {
    const tokens = readTokens()
    if (!tokens.length) { setMine([]); return }
    const rows = await Promise.all(tokens.map(async (token) => {
      const { data, error } = await supabase.rpc('pooja_my_request', { p_token: token })
      const row = Array.isArray(data) ? data[0] : data
      return error || !row ? null : { token, ...row }
    }))
    setMine(rows.filter(Boolean))
  }, [])

  useEffect(() => { loadList(); loadMine() }, [loadList, loadMine])

  const setPincode = (v) => {
    const clean = v.replace(/\D/g, '').slice(0, 6)
    setPin(clean)
    try {
      if (clean) localStorage.setItem(PIN_KEY, clean)
      else localStorage.removeItem(PIN_KEY)
    } catch { /* private mode */ }
  }

  // Sorted, then grouped by area in that order — so the nearest area heads the
  // page and each area's poojas sit together under one heading.
  const groups = useMemo(() => {
    if (!list?.length) return []
    const scored = list.map((p) => ({ ...p, score: distanceScore(p.pincode, pin) }))
    const usable = pin.length === 6 && scored.some((p) => p.score != null)
    scored.sort((a, b) => {
      if (usable) {
        const as = a.score == null ? Number.MAX_SAFE_INTEGER : a.score
        const bs = b.score == null ? Number.MAX_SAFE_INTEGER : b.score
        if (as !== bs) return as - bs
      }
      return String(a.starts_at).localeCompare(String(b.starts_at))
    })
    const out = []
    for (const p of scored) {
      const key = p.area || 'Nearby'
      let g = out.find((x) => x.area === key)
      if (!g) { g = { area: key, items: [], nearest: p.score }; out.push(g) }
      g.items.push(p)
    }
    return out
  }, [list, pin])

  if (done) {
    return (
      <PublicShell>
        <PublicDone
          title={`Namaskaram, ${done.name.split(' ')[0]}!`}
          next="A volunteer will confirm your seat with the host. Come back to this page to see the address and the host's number — they appear here once your seat is approved. Nothing is sent to you by message."
        >
          <div>Your seat request for <strong>{done.title}</strong> has been sent.</div>
        </PublicDone>
        <div style={{ ...stack, marginTop: 16 }}>
          <button className="btn btn-ghost" style={{ justifyContent: 'center' }} onClick={() => setDone(null)}>
            See my requests
          </button>
        </div>
      </PublicShell>
    )
  }

  if (sel) {
    return (
      <PublicShell>
        <div style={stack}>
          <RequestForm
            pooja={sel}
            onBack={() => setSel(null)}
            onRequested={async (name) => {
              await Promise.all([loadList(), loadMine()])
              setSel(null)
              setDone({ name, title: sel.title })
            }}
          />
        </div>
      </PublicShell>
    )
  }

  return (
    <PublicShell>
      <div style={stack}>
        {mine.length > 0 && (
          <>
            <div style={sectionLabel}>My requests</div>
            {mine.map((r) => (
              <MyRequestCard key={r.token} req={r} onChanged={() => { loadMine(); loadList() }} />
            ))}
            <div style={{ height: 6 }} />
          </>
        )}

        <div style={sectionLabel}>Consecrated spaces near you</div>

        {list === undefined && <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading…</div>}

        {list === null && (
          <div className="card public-card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>We couldn&apos;t load the poojas</div>
            <div style={{ fontSize: 13.5, color: 'var(--muted)' }}>Please check your connection and refresh. If it keeps happening, call the centre on 8095963111.</div>
          </div>
        )}

        {list && list.length === 0 && (
          <div className="card public-card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No poojas are open right now</div>
            <div style={{ fontSize: 13.5, color: 'var(--muted)' }}>New ones are posted through the week. Do check back.</div>
          </div>
        )}

        {list && list.length > 1 && (
          <div className="card public-card" style={{ padding: 14 }}>
            <Field
              label="Your pincode"
              hint="Optional. We'll put the closest poojas first. Nothing is saved to the centre — it stays on your phone."
              value={pin}
              onChange={(e) => setPincode(e.target.value)}
              placeholder="560100"
              inputMode="numeric"
              maxLength={6}
            />
          </div>
        )}

        {groups.map((g) => (
          <div key={g.area} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ ...sectionLabel, color: 'var(--orange)' }}>
              {g.area}{g.nearest === 0 ? ' · your pincode' : ''}
            </div>
            {g.items.map((p) => (
              <PoojaCard key={p.activity_id} pooja={p} onRequest={() => setSel(p)} />
            ))}
          </div>
        ))}
      </div>
    </PublicShell>
  )
}

// One open pooja. Area, landmark and pincode only — the street address is not in
// this payload at all, so it cannot be leaked by a rendering mistake here.
function PoojaCard({ pooja, onRequest }) {
  const left = Number(pooja.seats_left ?? 0)
  const full = left <= 0
  return (
    <div className="card public-card">
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 4px' }}>{pooja.title}</h2>
      <div style={{ ...metaRow, color: 'var(--ink-soft)', fontWeight: 600 }}>{fmtDay(pooja.starts_at)}</div>
      <div style={metaRow}>{fmtWhen(pooja.starts_at)}</div>
      <div style={metaRow}>
        {pooja.area}{pooja.landmark ? ` · near ${pooja.landmark}` : ''}{pooja.pincode ? ` · ${pooja.pincode}` : ''}
      </div>
      {pooja.bring_note && (
        <div style={{ ...metaRow, marginTop: 8, color: 'var(--ink-soft)' }}>{pooja.bring_note}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
        <span className="pill" style={full
          ? { background: 'var(--neutral-bg)', color: 'var(--neutral-fg)' }
          : { background: 'var(--success-bg)', color: 'var(--success-fg)' }}>
          {full ? 'Full' : `${left} of ${pooja.seats} seats left`}
        </span>
      </div>
      {/* Full means closed. There is deliberately no waitlist. */}
      <button
        className="btn btn-primary"
        disabled={full}
        onClick={onRequest}
        style={{ width: '100%', justifyContent: 'center', padding: 13, fontSize: 15, marginTop: 14 }}
      >
        {full ? 'No seats left' : 'Request a seat'}
      </button>
    </div>
  )
}

function RequestForm({ pooja, onBack, onRequested }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [party, setParty] = useState('1')
  const [nameErr, setNameErr] = useState(null)
  const [phoneErr, setPhoneErr] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  // Seats left ARE the cap — a family of six is fine if six are free. Typed
  // rather than picked from a list, because a list long enough for a family is
  // worse to use than a number box.
  const maxParty = Math.max(1, Number(pooja.seats_left ?? 1))
  const partyNum = Number(party)
  const partyErr = !party ? null
    : !Number.isInteger(partyNum) || partyNum < 1 ? 'Enter a number, 1 or more.'
      : partyNum > maxParty ? `Only ${maxParty} seat${maxParty === 1 ? '' : 's'} left.` : null

  async function submit() {
    const nm = name.trim()
    const p = checkMobile(phone)
    setNameErr(nm ? null : 'Please tell us your name.')
    setPhoneErr(p.ok ? null : p.reason)
    if (!nm || !p.ok || partyErr || !partyNum) return

    setErr(null); setBusy(true)
    try {
      const { data: token, error } = await supabase.rpc('pooja_request_seat', {
        p_activity_id: pooja.activity_id, p_name: nm, p_phone: p.digits, p_party: partyNum,
      })
      // The function's exception messages are written for the guest (full, already
      // requested, closed). Show them as-is rather than flattening to "failed".
      if (error) { setErr(error.message); return }
      addToken(token)
      onRequested(nm)
    } catch {
      setErr('Something went wrong. Please try again.')
    } finally { setBusy(false) }
  }

  return (
    <div className="card public-card">
      <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 14, padding: '8px 12px', fontSize: 13 }}>← All poojas</button>
      <div style={sectionLabel}>Request a seat</div>
      <h2 style={{ fontSize: 19, fontWeight: 600, margin: '4px 0 3px' }}>{pooja.title}</h2>
      <div style={{ ...metaRow, marginBottom: 18 }}>
        {fmtWhen(pooja.starts_at)} · {pooja.area}{pooja.landmark ? ` · near ${pooja.landmark}` : ''}
      </div>

      <Field label="Your name" required value={name} error={nameErr}
        onChange={(e) => { setName(e.target.value); if (nameErr) setNameErr(null) }}
        placeholder="Full name" autoComplete="name" enterKeyHint="next" />

      <Field label="Mobile number" required value={phone} error={phoneErr}
        hint="10 digits. A volunteer will call you on this number."
        onChange={(e) => { setPhone(e.target.value); if (phoneErr) setPhoneErr(null) }}
        placeholder="9XXXXXXXXX" inputMode="numeric" autoComplete="tel" maxLength={15} />

      <Field label="How many of you are coming?" required error={partyErr}
        hint={`Including yourself. ${maxParty} seat${maxParty === 1 ? '' : 's'} left.`}
        value={party} inputMode="numeric" maxLength={3} placeholder="1"
        onChange={(e) => setParty(e.target.value.replace(/\D/g, '').slice(0, 3))} />

      {err && <div className="field-error" role="alert" style={{ marginBottom: 12 }}>{err}</div>}

      <button className="btn btn-primary" disabled={busy} onClick={submit}
        style={{ width: '100%', justifyContent: 'center', padding: 13, fontSize: 15 }}>
        {busy ? 'Sending…' : partyNum > 1 ? `Request ${partyNum} seats` : 'Request a seat'}
      </button>
      <div style={{ ...metaRow, marginTop: 12, fontSize: 12.5 }}>
        The host approves each guest. You&apos;ll see the address here once your seat is approved.
      </div>
    </div>
  )
}

// The guest's own request. This is the ONLY place an address or a host's phone
// number is ever rendered, and both arrive already NULLed by pooja_my_request
// unless the status is approved — the check below is presentation, not security.
function MyRequestCard({ req, onChanged }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const s = STATUS[req.status] || STATUS.requested
  const live = req.status === 'requested' || req.status === 'approved'

  async function cancel() {
    setBusy(true)
    try {
      await supabase.rpc('pooja_cancel_request', { p_token: req.token })
      onChanged()
    } finally { setBusy(false); setConfirming(false) }
  }

  return (
    <div className="card public-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 10 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 4px' }}>{req.title}</h2>
        <span className="pill" style={{ background: s.bg, color: s.fg }}>{s.label}</span>
      </div>
      <div style={metaRow}>{fmtWhen(req.starts_at)}</div>
      <div style={metaRow}>
        {req.area}{req.landmark ? ` · near ${req.landmark}` : ''} · {req.party_size === 1 ? 'just you' : `${req.party_size} of you`}
      </div>

      {req.status === 'approved' && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={sectionLabel}>Where to go</div>
          <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.6, marginTop: 6, whiteSpace: 'pre-wrap' }}>{req.address}</div>
          {req.host_phone && (
            <a className="btn btn-ghost" href={`tel:+91${req.host_phone}`}
              style={{ marginTop: 12, justifyContent: 'center', width: '100%', textDecoration: 'none' }}>
              Call the host · {req.host_phone}
            </a>
          )}
          {req.bring_note && (
            <div style={{ ...metaRow, marginTop: 12, color: 'var(--ink-soft)' }}>{req.bring_note}</div>
          )}
        </div>
      )}

      {req.status === 'requested' && (
        <div style={{ ...metaRow, marginTop: 12 }}>
          The address appears here once the host approves your seat.
        </div>
      )}

      {live && (
        // Two taps to cancel: a stray tap here returns a seat to the pool and
        // there is no way for the guest to take it back if it is claimed.
        <div style={{ marginTop: 14 }}>
          {confirming ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" disabled={busy} onClick={cancel} style={{ flex: 1, justifyContent: 'center', color: 'var(--danger-fg)' }}>
                {busy ? 'Cancelling…' : 'Yes, give up my seat'}
              </button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(false)} style={{ flex: 1, justifyContent: 'center' }}>Keep it</button>
            </div>
          ) : (
            <button className="btn btn-ghost" onClick={() => setConfirming(true)} style={{ width: '100%', justifyContent: 'center' }}>
              I can&apos;t come
            </button>
          )}
        </div>
      )}
    </div>
  )
}
