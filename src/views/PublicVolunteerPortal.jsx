import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { waHref, smsHref, telHref, hasDialable, fillTemplate } from '../lib/phone'
import { LOG_OUTCOMES, DEFAULT_OUTCOME, pillForOutcome, fmtWhen } from '../lib/calllog'

// No-login volunteer calling portal, reached via a per-split share link (#volunteer=<token>).
// The 32-char token is the ONLY access control: anyone who opens it enters their name +
// phone and immediately gets the split's call list — no approval, no phone-match. The
// entered name+phone is stored on this device (keyed to the token) and recorded on every
// call log as the caller identity; a "Sign out" link clears it.
const box = { maxWidth: 480, margin: '0 auto', width: '100%' }
const inputStyle = { padding: '13px 14px', border: '1px solid var(--border)', borderRadius: 10, fontSize: 15, fontFamily: 'inherit', background: '#fff', color: 'var(--ink)', outline: 'none', width: '100%', boxSizing: 'border-box' }
const credKey = (token) => `portal_caller_${token}`
const callerLabel = (c) => `${c.name} · ${c.phone}`

export default function PublicVolunteerPortal({ token }) {
  const [info, setInfo] = useState(undefined) // undefined=loading, null=invalid token, {} = valid
  const [caller, setCaller] = useState(null) // { name, phone } once identified
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [err, setErr] = useState(null)
  const [rows, setRows] = useState(null)

  // Validate the token + restore any saved identity for this device.
  useEffect(() => {
    let alive = true
    supabase.rpc('portal_info', { p_token: token }).then(({ data, error }) => {
      if (!alive) return
      if (error || !data?.ok) { setInfo(null); return }
      setInfo(data)
      try {
        const saved = JSON.parse(localStorage.getItem(credKey(token)) || 'null')
        if (saved?.name && saved?.phone) setCaller(saved)
      } catch { /* ignore */ }
    })
    return () => { alive = false }
  }, [token])

  // Load the split's call list once identified.
  useEffect(() => {
    if (!caller) return
    let alive = true
    setRows(null)
    supabase.rpc('portal_list', { p_token: token }).then(({ data }) => { if (alive) setRows(data || []) })
    return () => { alive = false }
  }, [caller, token])

  function submit() {
    setErr(null)
    if (!name.trim()) return setErr('Please enter your name.')
    if (!phone.trim()) return setErr('Please enter your phone number.')
    const c = { name: name.trim(), phone: phone.trim(), email: email.trim() || null }
    localStorage.setItem(credKey(token), JSON.stringify(c))
    setCaller(c)
  }
  function signOut() {
    localStorage.removeItem(credKey(token))
    setCaller(null); setRows(null); setName(''); setPhone(''); setEmail(''); setErr(null)
  }

  const called = (rows || []).filter((r) => r.called).length

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ ...box, textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontFamily: "'Newsreader',serif", fontSize: 20, fontWeight: 600, color: 'var(--orange)' }}>Electronic City · Volunteer Care</div>
      </div>

      {info === undefined && <div style={{ ...box, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>}

      {info === null && (
        <div className="card" style={{ ...box, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>This link isn't valid</div>
          <div style={{ fontSize: 13.5, color: 'var(--muted)' }}>Please ask your coordinator for a fresh calling link.</div>
        </div>
      )}

      {info && !caller && (
        <div className="card" style={{ ...box, padding: 22 }}>
          <div style={{ fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700 }}>Volunteer calling</div>
          <h2 style={{ fontSize: 19, fontWeight: 600, margin: '4px 0 3px' }}>{info.campaign_name}</h2>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Enter your details to see the call list.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" style={inputStyle} />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Your phone number" inputMode="tel" style={inputStyle} />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" inputMode="email" style={inputStyle} />
          </div>
          {err && <div style={{ fontSize: 13, color: '#B5532F', marginBottom: 12 }}>{err}</div>}
          <button className="btn btn-primary" onClick={submit} style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: 15, minHeight: 48 }}>See the call list</button>
        </div>
      )}

      {info && caller && (
        <div style={{ ...box }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, gap: 8 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Namaskaram, {caller.name.split(' ')[0]}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{called}/{(rows || []).length} called</div>
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>{info.campaign_name}</div>

          {rows === null && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>Loading…</div>}
          {rows && rows.length === 0 && (
            <div className="card" style={{ padding: 22, textAlign: 'center', color: 'var(--muted)', fontSize: 13.5 }}>No one to call in this list yet.</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(rows || []).map((r) => (
              <RecipientRow key={r.journey_id} r={r} token={token} myName={caller.name} label={callerLabel(caller)} messaging={info.campaign_type === 'messaging'}
                onLogged={(outcome) => setRows((prev) => prev.map((x) => (x.journey_id === r.journey_id ? { ...x, called: true, last_outcome: outcome, last_logged_at: new Date().toISOString() } : x)))} />
            ))}
          </div>

          <div style={{ textAlign: 'center', marginTop: 22 }}>
            <button onClick={signOut} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Sign out</button>
          </div>
        </div>
      )}
    </div>
  )
}

function RecipientRow({ r, token, myName, label, messaging = false, onLogged }) {
  const [logging, setLogging] = useState(false)
  const [outcome, setOutcome] = useState(DEFAULT_OUTCOME)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const waText = fillTemplate(r.whatsapp_template, { name: r.person_name, myName })
  const smsText = fillTemplate(r.sms_template, { name: r.person_name, myName })
  const dialable = hasDialable(r.phone)

  async function save() {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('portal_log_call', { p_token: token, p_journey_id: r.journey_id, p_outcome: outcome, p_note: note || null, p_caller_label: label })
      if (error) throw error
      if (data.status !== 'ok') throw new Error(data.status)
      onLogged(outcome)
      setLogging(false); setNote('')
    } catch { /* stays open on failure so they can retry */ } finally { setBusy(false) }
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: r.called ? 4 : 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.person_name}</div>
          <div style={{ fontSize: 12.5, color: dialable ? 'var(--muted)' : '#B5532F' }}>{r.phone || 'no phone on record'}</div>
        </div>
        {r.called && r.last_outcome && (
          <span className="pill" style={pillForOutcome(r.last_outcome)}>{r.last_outcome}</span>
        )}
      </div>
      {r.called && r.last_logged_at && (
        <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginBottom: 10 }}>Last logged {fmtWhen(r.last_logged_at)}</div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!messaging && <a href={telHref(r.phone)} style={{ ...rowBtn, opacity: dialable ? 1 : 0.45, pointerEvents: dialable ? 'auto' : 'none' }}>Call</a>}
        <a href={smsHref(r.phone, smsText)} style={{ ...rowBtn, opacity: dialable ? 1 : 0.45, pointerEvents: dialable ? 'auto' : 'none' }}>SMS</a>
        <a href={waHref(r.phone, waText)} target="_blank" rel="noopener noreferrer" style={{ ...rowBtn, opacity: dialable ? 1 : 0.45, pointerEvents: dialable ? 'auto' : 'none' }}>WhatsApp</a>
        {!messaging && <button onClick={() => setLogging((v) => !v)} style={{ ...rowBtn, background: logging ? '#241B14' : '#fff', color: logging ? '#F6ECDC' : 'var(--ink-soft)' }}>Log</button>}
      </div>
      {logging && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #F2EBDD' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {LOG_OUTCOMES.map((o) => (
              <button key={o} onClick={() => setOutcome(o)} style={{ fontSize: 12, fontWeight: 600, padding: '8px 12px', minHeight: 44, borderRadius: 8, cursor: 'pointer', border: 'none', background: outcome === o ? '#241B14' : '#F6EFE2', color: outcome === o ? '#F6ECDC' : 'var(--ink-soft)' }}>{o}</button>
            ))}
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Note (optional)…"
            style={{ width: '100%', padding: '10px 11px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical', marginBottom: 10, boxSizing: 'border-box' }} />
          <button className="btn btn-primary" disabled={busy} onClick={save} style={{ width: '100%', justifyContent: 'center', minHeight: 44 }}>{busy ? 'Saving…' : 'Save log'}</button>
        </div>
      )}
    </div>
  )
}

const rowBtn = { padding: '10px 14px', minHeight: 44, display: 'inline-flex', alignItems: 'center', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid var(--border)', textDecoration: 'none', color: 'var(--ink-soft)', background: '#fff', cursor: 'pointer' }
