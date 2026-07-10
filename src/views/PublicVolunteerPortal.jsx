import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { waHref, smsHref, telHref, hasDialable, fillTemplate } from '../lib/phone'
import { LOG_OUTCOMES, DEFAULT_OUTCOME, pillForOutcome, fmtWhen } from '../lib/calllog'

// No-login volunteer calling portal, reached via a per-split share link (#volunteer=<token>).
// The 32-char token is the ONLY access control: anyone who opens it enters their name +
// phone and immediately gets the split's call list — no approval, no phone-match. The
// entered name+phone is stored on this device (keyed to the token) and recorded on every
// call log as the caller identity; a "Sign out" link clears it.
//
// Type scale (6 sizes, replaces the prior ad-hoc set): 12 caption / 14 body / 16 ui
// (inputs + buttons, keeps mobile Safari from auto-zooming on focus) / 18 title / 22 h1.
// Spacing on a 4px ramp: 4·8·12·16·20·24. Card padding standardized to 16.
const box = { maxWidth: 480, margin: '0 auto', width: '100%' }
const fieldStyle = { padding: '13px 14px', border: '1px solid var(--border)', borderRadius: 10, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: 'var(--ink)', outline: 'none', width: '100%', boxSizing: 'border-box' }
const fieldLabel = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted-2)', marginBottom: 6 }
const rowBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '10px 16px', minHeight: 44, fontSize: 16, fontWeight: 600, borderRadius: 10, border: '1px solid var(--border)', textDecoration: 'none', color: 'var(--ink-soft)', background: '#fff', cursor: 'pointer', boxSizing: 'border-box' }
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
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ ...box, textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15, fontWeight: 600, color: 'var(--orange)' }}>Electronic City · Volunteer Care</div>
      </div>

      {info === undefined && <div style={{ ...box, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>Loading…</div>}

      {info === null && (
        <div className="card" style={{ ...box, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>This link isn't valid</div>
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>Please ask your coordinator for a fresh calling link.</div>
        </div>
      )}

      {info && !caller && (
        <div className="card" style={{ ...box, padding: 16 }}>
          <div style={{ fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700 }}>Volunteer calling</div>
          <h1 style={{ fontFamily: "'Newsreader',serif", fontSize: 22, fontWeight: 600, margin: '4px 0 16px' }}>{info.campaign_name}</h1>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            <label style={fieldLabel}>Your name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya Kumar" style={{ ...fieldStyle, marginTop: 6 }} />
            </label>
            <label style={fieldLabel}>Your phone number
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile number" inputMode="tel" style={{ ...fieldStyle, marginTop: 6 }} />
            </label>
            <label style={fieldLabel}>Email (optional)
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" inputMode="email" style={{ ...fieldStyle, marginTop: 6 }} />
            </label>
          </div>
          {err && <div style={{ fontSize: 14, color: 'var(--red)', marginBottom: 12 }}>{err}</div>}
          <button className="btn btn-primary" onClick={submit} style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: 15, minHeight: 48 }}>See the call list</button>
        </div>
      )}

      {info && caller && (
        <div style={{ ...box }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, gap: 8 }}>
            <div style={{ fontFamily: "'Newsreader',serif", fontSize: 18, fontWeight: 600 }}>Namaskaram, {caller.name.split(' ')[0]}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{called}/{(rows || []).length} called</div>
          </div>
          <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 16 }}>{info.campaign_name}</div>

          {rows === null && <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14, padding: 20 }}>Loading…</div>}
          {rows && rows.length === 0 && (
            <div className="card" style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>No one to call in this list yet.</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(rows || []).map((r) => (
              <RecipientRow key={r.journey_id} r={r} token={token} myName={caller.name} label={callerLabel(caller)} messaging={info.campaign_type === 'messaging'}
                onLogged={(outcome) => setRows((prev) => prev.map((x) => (x.journey_id === r.journey_id ? { ...x, called: true, last_outcome: outcome, last_logged_at: new Date().toISOString() } : x)))} />
            ))}
          </div>

          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <button onClick={signOut} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, padding: '0 16px', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 14, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Sign out</button>
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

  const actionCount = (messaging ? 2 : 4)

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: r.called ? 4 : 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.person_name}</div>
          <div style={{ fontSize: 12, color: dialable ? 'var(--muted)' : 'var(--red)' }}>{r.phone || 'no phone on record'}</div>
        </div>
        {r.called && r.last_outcome && (
          <span className="pill" style={pillForOutcome(r.last_outcome)}>{r.last_outcome}</span>
        )}
      </div>
      {r.called && r.last_logged_at && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Last logged {fmtWhen(r.last_logged_at)}</div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${actionCount === 2 ? 2 : 2}, 1fr)`, gap: 8 }}>
        {!messaging && <a href={telHref(r.phone)} aria-disabled={!dialable} tabIndex={dialable ? 0 : -1} style={{ ...rowBtn, opacity: dialable ? 1 : 0.45, pointerEvents: dialable ? 'auto' : 'none' }}>Call</a>}
        <a href={smsHref(r.phone, smsText)} aria-disabled={!dialable} tabIndex={dialable ? 0 : -1} style={{ ...rowBtn, opacity: dialable ? 1 : 0.45, pointerEvents: dialable ? 'auto' : 'none' }}>SMS</a>
        <a href={waHref(r.phone, waText)} target="_blank" rel="noopener noreferrer" aria-disabled={!dialable} tabIndex={dialable ? 0 : -1} style={{ ...rowBtn, opacity: dialable ? 1 : 0.45, pointerEvents: dialable ? 'auto' : 'none' }}>WhatsApp</a>
        {!messaging && <button onClick={() => setLogging((v) => !v)} style={{ ...rowBtn, background: logging ? '#241B14' : '#fff', color: logging ? '#F6ECDC' : 'var(--ink-soft)' }}>Log</button>}
      </div>
      {logging && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-soft)' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {LOG_OUTCOMES.map((o) => (
              <button key={o} onClick={() => setOutcome(o)} style={{ fontSize: 12, fontWeight: 600, padding: '8px 12px', minHeight: 44, borderRadius: 8, cursor: 'pointer', border: 'none', background: outcome === o ? '#241B14' : '#F6EFE2', color: outcome === o ? '#F6ECDC' : 'var(--ink-soft)' }}>{o}</button>
            ))}
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Note (optional)…" style={{ ...fieldStyle, resize: 'vertical', marginBottom: 8 }} />
          <button className="btn btn-primary" disabled={busy} onClick={save} style={{ width: '100%', justifyContent: 'center', minHeight: 44 }}>{busy ? 'Saving…' : 'Save log'}</button>
        </div>
      )}
    </div>
  )
}
