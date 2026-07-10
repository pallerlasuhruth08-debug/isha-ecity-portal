import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { waHref, smsHref, hasDialable, fillTemplate } from '../lib/phone'
import { initials, avatarFor } from '../lib/ui'

// Volunteer messaging portal — ONE link per campaign (campaigns.portal_token),
// reached via #volunteer-portal/<token> or #volunteer-portal/<token>/batch/<batch_id>.
// Replaces the old one-token-per-split PublicVolunteerPortal flow (kept in place
// untouched — the #volunteer=<token> route).
//
// Entry flow: verify (phone -> email -> coordinator approval) -> auto-assign to
// the next unclaimed batch (a "batch" is a campaign_splits row; renamed at this
// display/URL/variable layer only — the table itself stays campaign_splits since
// the legacy portal above still reads it). A volunteer never browses or picks a
// batch; they see only their own.

const credKey = (token) => `claim_portal_${token}`
const box = { maxWidth: 480, margin: '0 auto', width: '100%' }
const fieldStyle = { padding: '13px 14px', border: '1px solid var(--border)', borderRadius: 10, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: 'var(--ink)', outline: 'none', width: '100%', boxSizing: 'border-box' }
const fieldLabel = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted-2)', marginBottom: 6 }

export default function VolunteerPortalClaim({ token, splitId: initialBatchId }) {
  const [info, setInfo] = useState(undefined) // undefined=loading, null=invalid, {}=valid
  const [caller, setCaller] = useState(null) // {name, phone}
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [err, setErr] = useState(null)
  const [toast, setToast] = useState(null)

  // {ok:true, status:'approved'|'needs_email'|'pending'|'rejected', batch_id} | {ok:false, reason}
  const [session, setSession] = useState(undefined)
  const [email, setEmail] = useState('')
  const [emailErr, setEmailErr] = useState(null)
  const [emailBusy, setEmailBusy] = useState(false)

  const [batchId, setBatchId] = useState(initialBatchId || null)
  const [assigning, setAssigning] = useState(false)
  const [assignFailed, setAssignFailed] = useState(false)

  const [gate, setGate] = useState(undefined) // undefined=checking, {ok:true,...} | {ok:false,...}
  const [recipients, setRecipients] = useState(null)

  useEffect(() => {
    let alive = true
    supabase.rpc('claim_portal_info', { p_token: token }).then(({ data, error }) => {
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

  const approved = session?.ok && session.status === 'approved'

  // Checked on every visit once a phone is known (fresh submit or localStorage
  // restore). A brand-new (campaign, phone) pair runs Step 1 (phone lookup) --
  // match auto-approves, miss returns 'needs_email' (no session row yet, so the
  // email step below can still create one with the right outcome). A RETURNING
  // visit with an already-decided status just reports it -- verification never
  // re-runs once a session row exists.
  const identify = useCallback(() => {
    if (!caller) return
    supabase.rpc('claim_portal_identify', { p_token: token, p_name: caller.name, p_phone: caller.phone }).then(({ data, error }) => {
      setSession(error ? { ok: false, reason: 'error' } : data)
    })
  }, [caller, token])

  useEffect(() => {
    if (!caller) { setSession(undefined); return }
    identify()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caller, token])

  // Pending holding screen polls for a coordinator decision every 30s.
  useEffect(() => {
    if (session?.ok !== true || session.status !== 'pending') return
    const t = setInterval(identify, 30000)
    return () => clearInterval(t)
  }, [session, identify])

  async function verifyEmail(skip) {
    setEmailErr(null)
    if (!skip && !email.trim()) return setEmailErr('Please enter your email address.')
    setEmailBusy(true)
    try {
      const { data, error } = await supabase.rpc('claim_portal_verify_email', { p_token: token, p_name: caller.name, p_phone: caller.phone, p_email: skip ? null : email.trim() })
      if (error) throw error
      setSession({ ok: true, status: data.status, verified_by: data.verified_by, batch_id: null })
    } catch (e) {
      setEmailErr('Could not verify: ' + (e.message || e))
    } finally {
      setEmailBusy(false)
    }
  }

  // Auto-assignment: runs once approved, if we don't already know a batch (either
  // from the URL or from the session's own batch_id). Idempotent server-side, so
  // a returning approved volunteer with a stored batch just gets it echoed back.
  const assignBatch = useCallback(() => {
    if (!caller) return
    setAssigning(true); setAssignFailed(false)
    supabase.rpc('claim_portal_assign_batch', { p_token: token, p_phone: caller.phone }).then(({ data, error }) => {
      setAssigning(false)
      if (error || data.status !== 'ok') { setAssignFailed(true); return }
      setBatchId(data.batch_id)
      window.location.hash = `volunteer-portal/${token}/batch/${data.batch_id}`
      setToast(`Welcome ${caller.name.split(' ')[0]}! Here's your outreach list.`)
    })
  }, [caller, token])

  useEffect(() => {
    if (!approved || batchId) return
    if (session.batch_id) { setBatchId(session.batch_id); return }
    assignBatch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approved, batchId, session])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  function submit() {
    setErr(null)
    if (!name.trim()) return setErr('Please enter your name.')
    if (!phone.trim()) return setErr('Please enter your phone number.')
    const c = { name: name.trim(), phone: phone.trim() }
    localStorage.setItem(credKey(token), JSON.stringify(c))
    setCaller(c)
  }
  function signOut() {
    localStorage.removeItem(credKey(token))
    setCaller(null); setSession(undefined); setBatchId(null); setAssignFailed(false)
    setName(''); setPhone(''); setErr(''); setEmail(''); setEmailErr(null)
  }

  // Ownership gate — re-checked whenever we have a batch to show (direct link,
  // fresh assignment, or a returning visit). Never trust that getting here already
  // proved ownership; a volunteer only ever sees THEIR OWN batch, nothing else.
  useEffect(() => {
    if (!caller || !batchId) { setGate(undefined); return }
    let alive = true
    setGate(undefined)
    supabase.rpc('claim_portal_split_info', { p_token: token, p_split_id: batchId, p_phone: caller.phone }).then(({ data, error }) => {
      if (!alive) return
      if (error) { setGate({ ok: false, owner_name: null }); return }
      setGate(data)
      if (!data.ok) {
        setToast(data.owner_name ? `This batch belongs to ${data.owner_name}. Please contact your coordinator.` : "This batch hasn't been assigned yet.")
        setBatchId(null)
        window.location.hash = `volunteer-portal/${token}`
      }
    })
    return () => { alive = false }
  }, [caller, batchId, token])

  const loadRecipients = useCallback(() => {
    if (!caller || !batchId || !gate?.ok) return
    supabase.rpc('claim_portal_split_recipients', { p_token: token, p_split_id: batchId, p_phone: caller.phone }).then(({ data }) => setRecipients(data || []))
  }, [caller, batchId, gate, token])

  useEffect(() => { loadRecipients() }, [loadRecipients])

  function touchBatch() {
    if (!caller || !batchId) return
    supabase.rpc('claim_portal_touch', { p_token: token, p_split_id: batchId, p_phone: caller.phone })
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ ...box, textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15, fontWeight: 600, color: 'var(--orange)' }}>Electronic City · Volunteer Care</div>
      </div>

      {info === undefined && <div style={{ ...box, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>Loading…</div>}

      {info === null && (
        <div className="card" style={{ ...box, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>This link isn't valid</div>
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>Please ask your coordinator for a fresh link.</div>
        </div>
      )}

      {info && !caller && (
        <div className="card" style={{ ...box, padding: 16 }}>
          <div style={{ fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700 }}>Volunteer messaging</div>
          <h1 style={{ fontFamily: "'Newsreader',serif", fontSize: 22, fontWeight: 600, margin: '4px 0 16px' }}>{info.campaign_name}</h1>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            <label style={fieldLabel}>Your name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya Kumar" style={{ ...fieldStyle, marginTop: 6 }} />
            </label>
            <label style={fieldLabel}>Your phone number
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile number" inputMode="tel" style={{ ...fieldStyle, marginTop: 6 }} />
            </label>
          </div>
          {err && <div style={{ fontSize: 14, color: 'var(--red)', marginBottom: 12 }}>{err}</div>}
          <button className="btn btn-primary" onClick={submit} style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: 15, minHeight: 48 }}>Continue</button>
        </div>
      )}

      {info && caller && session === undefined && (
        <div style={{ ...box, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>Checking your details…</div>
      )}

      {info && caller && session && !session.ok && (
        <div className="card" style={{ ...box, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Your session has expired</div>
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>Contact your coordinator for a new link.</div>
        </div>
      )}

      {/* Step 1 (phone) found no match -- secondary verification by email. */}
      {info && caller && session?.ok && session.status === 'needs_email' && (
        <div className="card" style={{ ...box, padding: 16 }}>
          <div style={{ fontSize: 15, color: 'var(--ink-soft)', marginBottom: 14, lineHeight: 1.5 }}>
            We couldn't find your phone number in our records. Please enter the email address you used during Inner Engineering registration.
          </div>
          <label style={fieldLabel}>Email address
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" inputMode="email" style={{ ...fieldStyle, marginTop: 6 }} />
          </label>
          {emailErr && <div style={{ fontSize: 14, color: 'var(--red)', marginTop: 10 }}>{emailErr}</div>}
          <button className="btn btn-primary" disabled={emailBusy} onClick={() => verifyEmail(false)} style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: 15, minHeight: 48, marginTop: 14 }}>{emailBusy ? 'Verifying…' : 'Verify with email →'}</button>
          <button disabled={emailBusy} onClick={() => verifyEmail(true)} style={{ width: '100%', textAlign: 'center', marginTop: 10, background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', minHeight: 44 }}>Skip — request coordinator approval</button>
        </div>
      )}

      {/* Neither phone nor email matched -- coordinator has to approve manually. */}
      {info && caller && session?.ok && session.status === 'pending' && (
        <div className="card" style={{ ...box, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Your access request is pending approval</div>
          <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 16 }}>The coordinator has been notified. Please check back shortly.</div>
          <button className="btn btn-ghost" onClick={identify} style={{ width: '100%', justifyContent: 'center', minHeight: 44 }}>Refresh status</button>
        </div>
      )}

      {info && caller && session?.ok && session.status === 'rejected' && (
        <div className="card" style={{ ...box, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Your request was not approved</div>
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>Please contact your coordinator.</div>
        </div>
      )}

      {info && caller && approved && !batchId && assigning && (
        <div style={{ ...box, textAlign: 'center', color: 'var(--muted)', fontSize: 14, padding: 20 }}>Assigning your outreach list…</div>
      )}

      {info && caller && approved && !batchId && !assigning && assignFailed && (
        <div className="card" style={{ ...box, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>All outreach lists are currently taken</div>
          <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 16 }}>The coordinator has been notified and will assign you one shortly.</div>
          <button className="btn btn-ghost" onClick={assignBatch} style={{ width: '100%', justifyContent: 'center', minHeight: 44 }}>Try again</button>
        </div>
      )}

      {/* A volunteer's whole world: their name, their campaign, their list. No
          navigation to other batches, no way to see other batches exist. */}
      {info && caller && approved && batchId && (
        <div style={{ ...box }}>
          {gate === undefined && <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14, padding: 20 }}>Checking…</div>}
          {gate?.ok && (
            <>
              <div style={{ fontFamily: "'Newsreader',serif", fontSize: 18, fontWeight: 600, marginBottom: 2 }}>Namaskaram, {caller.name.split(' ')[0]}</div>
              <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 4 }}>{info.campaign_name}</div>
              <div style={{ fontSize: 14, color: 'var(--ink-soft)', fontWeight: 600, marginBottom: 16 }}>
                Your outreach list — {(recipients || []).length} people
                {recipients && recipients.length > 0 && <span style={{ fontWeight: 400, color: 'var(--muted)' }}> · {recipients.filter((r) => r.message_status !== 'to_message').length} sent</span>}
              </div>
              {recipients === null && <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14, padding: 20 }}>Loading…</div>}
              {recipients && recipients.length === 0 && (
                <div className="card" style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>No one in your list yet.</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(recipients || []).map((r) => (
                  <RecipientRow key={r.journey_id} r={r} token={token} splitId={batchId} phone={caller.phone} myName={caller.name} label={`${caller.name} · ${caller.phone}`}
                    onTouch={touchBatch}
                    onSent={(status) => setRecipients((prev) => prev.map((x) => (x.journey_id === r.journey_id ? { ...x, message_status: status } : x)))} />
                ))}
              </div>
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <button onClick={signOut} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, padding: '0 16px', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 14, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Sign out</button>
              </div>
            </>
          )}
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', background: '#241B14', color: '#F6ECDC', padding: '11px 18px', borderRadius: 10, fontSize: 13.5, fontWeight: 600, boxShadow: 'var(--shadow-lg)', zIndex: 200, maxWidth: 'calc(100vw - 32px)', textAlign: 'center' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

// Recipient row (a volunteer's own batch). WA/SMS taps keep the claim alive
// (last_active_at); Sent is optimistic (flips immediately, reverts on failure).
function RecipientRow({ r, token, splitId, phone, myName, label, onTouch, onSent }) {
  const [busy, setBusy] = useState(false)
  const [lastChannel, setLastChannel] = useState('whatsapp')
  const dialable = hasDialable(r.phone)
  const waText = fillTemplate(r.whatsapp_template, { name: r.person_name, myName })
  const smsText = fillTemplate(r.sms_template, { name: r.person_name, myName })
  const sent = r.message_status === 'sent' || r.message_status === 'responded'

  async function toggleSent() {
    const prev = r.message_status
    if (sent) return // split-view Sent is one-way (mark sent); undo lives on the coordinator's row
    setBusy(true)
    onSent('sent')
    try {
      const { data, error } = await supabase.rpc('claim_portal_mark_sent', { p_token: token, p_split_id: splitId, p_journey_id: r.journey_id, p_phone: phone, p_channel: lastChannel, p_caller_label: label })
      if (error) throw error
      if (data.status !== 'ok') throw new Error(data.status)
    } catch {
      onSent(prev)
    } finally { setBusy(false) }
  }

  const btnBase = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 1, height: 36, fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid var(--border)', textDecoration: 'none', color: 'var(--ink-soft)', background: '#fff', cursor: 'pointer', boxSizing: 'border-box' }

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: avatarFor(0), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(r.person_name)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.person_name}</div>
          <div style={{ fontSize: 12, color: dialable ? 'var(--muted)' : 'var(--red)' }}>{r.phone || 'no phone on record'}</div>
        </div>
        <span className="pill" style={sent ? { background: '#EAF2E5', color: '#4E7C3F' } : { background: '#F1EADD', color: '#8C7E6B' }}>{sent ? 'Sent' : 'To message'}</span>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <a href={smsHref(r.phone, smsText)} onClick={() => { setLastChannel('sms'); onTouch() }} aria-disabled={!dialable} style={{ ...btnBase, opacity: dialable ? 1 : 0.45, pointerEvents: dialable ? 'auto' : 'none' }}>SMS</a>
        <a href={waHref(r.phone, waText)} target="_blank" rel="noopener noreferrer" onClick={() => { setLastChannel('whatsapp'); onTouch() }} aria-disabled={!dialable} style={{ ...btnBase, opacity: dialable ? 1 : 0.45, pointerEvents: dialable ? 'auto' : 'none' }}>WhatsApp</a>
        <button onClick={toggleSent} disabled={busy || sent} style={{ ...btnBase, cursor: sent ? 'default' : 'pointer', border: '1px solid ' + (sent ? '#4E7C3F' : 'var(--border)'), background: sent ? '#EAF2E5' : '#fff', color: sent ? '#4E7C3F' : 'var(--ink-soft)' }}>{sent ? '✓ Sent' : 'Sent'}</button>
      </div>
    </div>
  )
}
