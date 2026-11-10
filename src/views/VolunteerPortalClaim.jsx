import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { waHref, smsHref, telHref, hasDialable, fillTemplate, checkMobile } from '../lib/phone'
import Field from '../components/Field'
import { initials, avatarFor, BRAND } from '../lib/ui'
import { MESSAGE_STATUS, pillForMessage, labelForMessage } from '../lib/messageStatus'
import KebabMenu from '../components/KebabMenu'
import { LOG_OUTCOMES, DEFAULT_OUTCOME, pillForOutcome, OUTCOME_TO_STATUS } from '../lib/calllog'

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
// Cards / List preference for the calling list — per device, convenience only.
const VIEW_KEY = 'portal_call_view'
const readView = () => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards' } catch { return 'cards' } }
const ViewToggle = ({ view, setView }) => (
  <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 9, overflow: 'hidden', flexShrink: 0 }}>
    {[['cards', 'Cards'], ['list', 'List']].map(([v, l]) => (
      <button key={v} onClick={() => { setView(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* ignore */ } }} aria-pressed={view === v}
        style={{ fontSize: 12.5, fontWeight: 600, padding: '6px 12px', border: 'none', cursor: 'pointer', background: view === v ? '#241B14' : '#fff', color: view === v ? '#F6ECDC' : 'var(--ink-soft)' }}>{l}</button>
    ))}
  </div>
)

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
  const [statusFilter, setStatusFilter] = useState('all')
  const [callView, setCallView] = useState(readView)
  const [celebrating, setCelebrating] = useState(false)
  const [bulkConfirming, setBulkConfirming] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkErr, setBulkErr] = useState(null)

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
  // Calling campaigns reuse this page: same link, sign-in and batch claim, but
  // rows get Call + Log instead of Sent, and a finished batch pulls the next one.
  const calling = !!info && info.campaign_type !== 'messaging'
  const [nextState, setNextState] = useState(null) // calling only: null | 'loading' | 'all_taken'

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

  // Poll while pending so an approval lands on its own. The volunteer should never
  // have to tap Refresh to find out whether a human noticed them. 20s is frequent
  // enough to feel immediate and light enough to leave open on a phone.
  useEffect(() => {
    if (!(session?.ok && session.status === 'pending')) return
    const t = setInterval(() => { identify() }, 20000)
    return () => clearInterval(t)
  }, [session, identify])

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
    const p = checkMobile(phone)
    if (!p.ok) return setErr(p.reason)
    const c = { name: name.trim(), phone: phone.trim() }
    localStorage.setItem(credKey(token), JSON.stringify(c))
    setCaller(c)
  }
  function signOut() {
    localStorage.removeItem(credKey(token))
    setCaller(null); setSession(undefined); setBatchId(null); setAssignFailed(false)
    setName(''); setPhone(''); setErr(''); setEmail(''); setEmailErr(null)
    setCelebrating(false)
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
        setToast(data.owner_name ? `This batch belongs to ${data.owner_name}. Please contact a volunteer.` : "This batch hasn't been assigned yet.")
        setBatchId(null)
        window.location.hash = `volunteer-portal/${token}`
      }
    })
    return () => { alive = false }
  }, [caller, batchId, token])

  const loadRecipients = useCallback(() => {
    if (!caller || !batchId || !gate?.ok) return
    const fn = calling ? 'claim_portal_call_recipients' : 'claim_portal_split_recipients'
    supabase.rpc(fn, { p_token: token, p_split_id: batchId, p_phone: caller.phone }).then(({ data }) => setRecipients(data || []))
  }, [caller, batchId, gate, token, calling])

  useEffect(() => { loadRecipients() }, [loadRecipients])

  function touchBatch() {
    if (!caller || !batchId) return
    supabase.rpc('claim_portal_touch', { p_token: token, p_split_id: batchId, p_phone: caller.phone })
  }

  // A batch is "done" once every recipient has been either messaged or marked
  // no-WhatsApp -- nothing left for the volunteer to action.
  const allResolved = !!recipients && recipients.length > 0 && (calling ? recipients.every((r) => !!r.last_outcome) : recipients.every((r) => r.message_status !== 'to_message'))
  const loggedCount = recipients ? recipients.filter((r) => !!r.last_outcome).length : 0

  // Calling: once every person in the batch has a log, claim the next free batch.
  // Server re-checks completeness, so this can't skip people early.
  useEffect(() => {
    if (!calling || !allResolved || nextState) return
    setNextState('loading')
    supabase.rpc('claim_portal_claim_next_batch', { p_token: token, p_phone: caller.phone }).then(({ data, error }) => {
      if (error || !data) { setNextState(null); return }
      if (data.status === 'ok') {
        setNextState(null)
        setRecipients(null)
        setBatchId(data.batch_id)
        window.location.hash = `volunteer-portal/${token}/batch/${data.batch_id}`
        setToast('Batch done 🙏 Here are your next people.')
      } else if (data.status === 'all_taken') {
        setNextState('all_taken')
      } else {
        setNextState(null)
      }
    })
  }, [calling, allResolved, nextState, token, caller])
  const resolvedStats = recipients ? {
    total: recipients.length,
    sent: recipients.filter((r) => r.message_status === 'sent' || r.message_status === 'responded').length,
    noWa: recipients.filter((r) => r.message_status === 'no_whatsapp').length,
  } : { total: 0, sent: 0, noWa: 0 }
  const unresolvedCount = recipients ? recipients.filter((r) => r.message_status === 'to_message').length : 0

  // Bulk-marks every still-"to_message" recipient as sent -- same message_logs
  // entry shape (channel: whatsapp) as the per-row Sent button, just server-side
  // in one round trip. No WhatsApp / Responded rows are untouched (the RPC only
  // targets message_status = 'to_message'). Always leaves the batch fully
  // resolved, so it goes straight to the celebration screen.
  async function confirmBulkMarkSent() {
    setBulkBusy(true)
    setBulkErr(null)
    try {
      const { data, error } = await supabase.rpc('claim_portal_mark_all_sent', { p_token: token, p_split_id: batchId, p_phone: caller.phone, p_caller_label: `${caller.name} · ${caller.phone}` })
      if (error) throw error
      if (data.status !== 'ok') throw new Error(data.status)
      setRecipients((prev) => prev.map((r) => (r.message_status === 'to_message' ? { ...r, message_status: 'sent' } : r)))
      setBulkConfirming(false)
      setCelebrating(true)
    } catch (e) {
      setBulkErr('Could not mark all as sent: ' + (e.message || e))
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ ...box, textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15, fontWeight: 600, color: 'var(--orange)' }}>{BRAND}</div>
      </div>

      {info === undefined && <div style={{ ...box, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>Loading…</div>}

      {info === null && (
        <div className="card" style={{ ...box, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>This link isn't valid</div>
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>Please ask a volunteer for a fresh link.</div>
        </div>
      )}

      {info && !caller && (
        <div className="card" style={{ ...box, padding: 16 }}>
          <div style={{ fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700 }}>{calling ? 'Volunteer calling' : 'Volunteer messaging'}</div>
          <h1 style={{ fontFamily: "'Newsreader',serif", fontSize: 22, fontWeight: 600, margin: '4px 0 16px' }}>{info.campaign_name}</h1>
          <Field label="Your name" required value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Priya Kumar" autoComplete="name" enterKeyHint="next" />
          <Field label="Your mobile number" required value={phone} onChange={(e) => setPhone(e.target.value)}
            hint="The number the centre has on record for you."
            placeholder="9XXXXXXXXX" inputMode="numeric" autoComplete="tel" maxLength={15}
            enterKeyHint="go" onKeyDown={(e) => e.key === 'Enter' && submit()} />
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
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>Contact a volunteer for a new link.</div>
        </div>
      )}

      {/* Step 1 (phone) found no match -- secondary verification by email. */}
      {info && caller && session?.ok && session.status === 'needs_email' && (
        <div className="card" style={{ ...box, padding: 16 }}>
          <div style={{ fontSize: 15, color: 'var(--ink-soft)', marginBottom: 14, lineHeight: 1.5 }}>
            We couldn't find your phone number in our records. Please enter the email address you used during Inner Engineering registration.
          </div>
          <Field label="Email address" required value={email} onChange={(e) => setEmail(e.target.value)}
            hint="The address you used when you registered for Inner Engineering."
            placeholder="you@example.com" inputMode="email" autoComplete="email" type="email"
            enterKeyHint="go" onKeyDown={(e) => e.key === 'Enter' && verifyEmail(false)} />
          {emailErr && <div style={{ fontSize: 14, color: 'var(--red)', marginTop: 10 }}>{emailErr}</div>}
          <button className="btn btn-primary" disabled={emailBusy} onClick={() => verifyEmail(false)} style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: 15, minHeight: 48, marginTop: 14 }}>{emailBusy ? 'Verifying…' : 'Verify with email →'}</button>
          <button disabled={emailBusy} onClick={() => verifyEmail(true)} style={{ width: '100%', textAlign: 'center', marginTop: 10, background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', minHeight: 44 }}>Skip — request volunteer approval</button>
        </div>
      )}

      {/* Neither phone nor email matched -- coordinator has to approve manually.
          This screen used to say "check back shortly" and hand the volunteer a
          Refresh button: no timeframe, no fallback, and a person left tapping a
          button to find out whether anyone had noticed them. It now polls on their
          behalf and, more importantly, tells them how long to wait and exactly what
          to do if nothing happens. */}
      {info && caller && session?.ok && session.status === 'pending' && (
        <div className="card" style={{ ...box, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Waiting for a volunteer to approve you</div>
          <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.55, marginBottom: 14 }}>
            We couldn't match your phone or email to our records, so a volunteer is checking by hand.
            They've been notified. This usually takes a few hours, and often longer at the weekend.
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.55, marginBottom: 16, textAlign: 'left', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 13px' }}>
            <strong>You don't need to keep this page open.</strong> Open the same link again later and you'll go straight in once you're approved.
            If you haven't heard anything by tomorrow, call the centre on <a href="tel:+918095963111" style={{ color: 'var(--orange)', fontWeight: 600 }}>8095963111</a>.
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>Checking automatically…</div>
        </div>
      )}

      {info && caller && session?.ok && session.status === 'rejected' && (
        <div className="card" style={{ ...box, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>We couldn't give you access to this list</div>
          <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.55 }}>
            This usually means the number you entered isn't the one we have on record. Call the centre on{' '}
            <a href="tel:+918095963111" style={{ color: 'var(--orange)', fontWeight: 600 }}>8095963111</a> and we'll sort it out.
          </div>
        </div>
      )}

      {info && caller && approved && !batchId && assigning && (
        <div style={{ ...box, textAlign: 'center', color: 'var(--muted)', fontSize: 14, padding: 20 }}>Assigning your outreach list…</div>
      )}

      {info && caller && approved && !batchId && !assigning && assignFailed && (
        <div className="card" style={{ ...box, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>All outreach lists are currently taken</div>
          <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 16 }}>A volunteer has been notified and will assign you one shortly.</div>
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
              <div style={{ fontSize: 14, color: 'var(--ink-soft)', fontWeight: 600, marginBottom: 12 }}>
                Your {calling ? 'call' : 'outreach'} list — {(recipients || []).length} people
                {recipients && recipients.length > 0 && <span style={{ fontWeight: 400, color: 'var(--muted)' }}> · {calling ? `${loggedCount} logged` : `${recipients.filter((r) => r.message_status === 'sent' || r.message_status === 'responded').length} sent`}</span>}
              </div>
              {calling && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', flex: 1 }}>Call each person, then log how it went. When all are logged, your next people load automatically.</div>
                  <ViewToggle view={callView} setView={setCallView} />
                </div>
              )}
              {calling && recipients?.[0]?.script && (
                <details className="card" style={{ padding: '10px 12px', marginBottom: 12 }}>
                  <summary style={{ fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Call script</summary>
                  <div style={{ fontSize: 13.5, color: 'var(--ink-soft)', whiteSpace: 'pre-wrap', lineHeight: 1.5, marginTop: 8 }}>{recipients[0].script}</div>
                </details>
              )}

              {!calling && unresolvedCount > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <button onClick={() => setBulkConfirming(true)} style={{ fontSize: 12.5, fontWeight: 600, padding: '8px 13px', borderRadius: 9, border: '1px solid var(--border)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer' }}>
                    ✓ Mark all as sent & finish
                  </button>
                </div>
              )}

              {!calling && recipients && recipients.length > 0 && (() => {
                const counts = { all: recipients.length }
                for (const s of MESSAGE_STATUS) counts[s.v] = recipients.filter((r) => r.message_status === s.v).length
                const chip = (on) => ({ fontSize: 12, fontWeight: 600, padding: '6px 11px', borderRadius: 20, cursor: 'pointer', border: on ? 'none' : '1px solid var(--border)', background: on ? '#241B14' : '#fff', color: on ? '#F6ECDC' : 'var(--ink-soft)', whiteSpace: 'nowrap', flexShrink: 0 })
                return (
                  <div className="scroll-tabs" style={{ display: 'flex', gap: 6, flexWrap: 'nowrap', overflowX: 'auto', marginBottom: 14 }}>
                    <button onClick={() => setStatusFilter('all')} style={chip(statusFilter === 'all')}>All {counts.all}</button>
                    {MESSAGE_STATUS.map((s) => (
                      <button key={s.v} onClick={() => setStatusFilter(s.v)} style={chip(statusFilter === s.v)}>{s.label} {counts[s.v]}</button>
                    ))}
                  </div>
                )
              })()}

              {recipients === null && <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14, padding: 20 }}>Loading…</div>}
              {recipients && recipients.length === 0 && (
                <div className="card" style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>No one in your list yet.</div>
              )}
              <div className={calling && callView === 'list' ? 'card' : undefined} style={calling && callView === 'list' ? { display: 'flex', flexDirection: 'column', overflow: 'hidden' } : { display: 'flex', flexDirection: 'column', gap: 8 }}>
                {calling && (recipients || []).map((r) => (
                  <CallRow key={r.journey_id} list={callView === 'list'} r={r} token={token} splitId={batchId} phone={caller.phone} myName={caller.name} label={`${caller.name} · ${caller.phone}`}
                    onTouch={touchBatch}
                    onLogged={(outcome, remarks) => setRecipients((prev) => prev.map((x) => (x.journey_id === r.journey_id ? { ...x, last_outcome: outcome, last_remarks: remarks, last_logged_at: new Date().toISOString() } : x)))} />
                ))}
                {!calling && (recipients || []).filter((r) => statusFilter === 'all' || r.message_status === statusFilter).map((r) => (
                  <RecipientRow key={r.journey_id} r={r} token={token} splitId={batchId} phone={caller.phone} myName={caller.name} label={`${caller.name} · ${caller.phone}`}
                    onTouch={touchBatch}
                    onSent={(status) => setRecipients((prev) => prev.map((x) => (x.journey_id === r.journey_id ? { ...x, message_status: status } : x)))} />
                ))}
              </div>
              {calling && nextState === 'loading' && <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14, padding: 16 }}>Loading your next people…</div>}
              {calling && nextState === 'all_taken' && (
                <div className="card" style={{ padding: 16, textAlign: 'center', marginTop: 14 }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>🙏</div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Everyone in this campaign has been taken</div>
                  <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>Thank you for your seva! There are no more people left to call right now.</div>
                </div>
              )}
              <div style={{ textAlign: 'center', marginTop: 24, marginBottom: !calling && allResolved ? 64 : 0 }}>
                <button onClick={signOut} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, padding: '0 16px', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 14, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Sign out</button>
              </div>

              {!calling && allResolved && !celebrating && (
                <button className="btn btn-primary done-sticky-btn" onClick={() => setCelebrating(true)} style={{ padding: '14px 22px', fontSize: 15, borderRadius: 999 }}>🎉 All done! Tap to finish</button>
              )}
              {celebrating && (
                <CelebrationScreen name={caller.name} stats={resolvedStats} onDismiss={() => setCelebrating(false)} />
              )}
              {bulkConfirming && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 250, padding: 20 }} onClick={() => !bulkBusy && setBulkConfirming(false)}>
                  <div className="card" style={{ width: 380, maxWidth: '100%', padding: 22 }} onClick={(e) => e.stopPropagation()}>
                    <h3 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 8px' }}>Mark all as sent?</h3>
                    <div style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 16 }}>
                      This marks all {unresolvedCount} remaining recipient{unresolvedCount === 1 ? '' : 's'} as sent via WhatsApp — same as tapping Sent on each one individually. No WhatsApp and Responded statuses won't be touched.
                    </div>
                    {bulkErr && <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 12 }}>{bulkErr}</div>}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <button className="btn btn-ghost" disabled={bulkBusy} onClick={() => setBulkConfirming(false)}>Cancel</button>
                      <button className="btn btn-primary" disabled={bulkBusy} onClick={confirmBulkMarkSent}>{bulkBusy ? 'Marking…' : `Yes, mark all ${unresolvedCount} sent`}</button>
                    </div>
                  </div>
                </div>
              )}
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

// Calling row: Call (tel:) + WhatsApp + Log. A log is append-only (a new call_logs
// row via claim_portal_log_call, stamped with the volunteer's name · phone).
function CallRow({ r, token, splitId, phone, myName, label, onTouch, onLogged, list = false }) {
  const [open, setOpen] = useState(false)
  const [outcome, setOutcome] = useState(DEFAULT_OUTCOME)
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const dialable = hasDialable(r.phone)
  const waText = fillTemplate(r.whatsapp_template, { name: r.person_name, myName })
  const smsText = fillTemplate(r.sms_template, { name: r.person_name, myName })

  async function save() {
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('claim_portal_log_call', { p_token: token, p_split_id: splitId, p_journey_id: r.journey_id, p_phone: phone, p_reachability: outcome, p_remarks: remarks, p_caller_label: label })
      if (error) throw error
      if (data.status !== 'ok') throw new Error(data.status === 'not_authorized' ? 'Your session expired — open the link again.' : data.status)
      onLogged(outcome, remarks)
      setOpen(false); setRemarks('')
    } catch (e) {
      setErr('Could not save: ' + (e.message || e))
    } finally { setBusy(false) }
  }

  const btnBase = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 1, height: 38, fontSize: 13.5, fontWeight: 600, borderRadius: 8, border: '1px solid var(--border)', textDecoration: 'none', color: 'var(--ink-soft)', background: '#fff', cursor: 'pointer', boxSizing: 'border-box' }
  const status = r.last_outcome ? (OUTCOME_TO_STATUS[r.last_outcome] || r.last_outcome) : 'To call'

  const logForm = (
    <div style={{ background: '#FBF6EC', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {LOG_OUTCOMES.map((o) => (
          <button key={o} onClick={() => setOutcome(o)} style={{ fontSize: 12.5, fontWeight: 600, padding: '7px 11px', borderRadius: 20, cursor: 'pointer', border: outcome === o ? 'none' : '1px solid var(--border)', background: outcome === o ? '#241B14' : '#fff', color: outcome === o ? '#F6ECDC' : 'var(--ink-soft)' }}>{o}</button>
        ))}
      </div>
      <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} placeholder="Remarks (optional) — what was said, callback time…"
        style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 13.5, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', marginBottom: 8 }} />
      {err && <div style={{ fontSize: 12.5, color: 'var(--red)', marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 6 }}>
        <button disabled={busy} onClick={() => setOpen(false)} style={btnBase}>Cancel</button>
        <button disabled={busy} onClick={save} style={{ ...btnBase, border: 'none', background: 'var(--orange)', color: '#fff' }}>{busy ? 'Saving…' : 'Save log'}</button>
      </div>
    </div>
  )

  if (list) {
    const icon = { ...btnBase, flex: 'none', width: 36, height: 34, fontSize: 13, padding: 0, opacity: dialable ? 1 : 0.45, pointerEvents: dialable ? 'auto' : 'none' }
    return (
      <div style={{ padding: '9px 10px', borderBottom: '1px solid var(--border-soft)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.person_name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <span style={{ fontSize: 12, color: dialable ? 'var(--muted)' : 'var(--red)' }}>{r.phone || 'no phone'}</span>
              <span className="pill" style={{ ...pillForOutcome(r.last_outcome), fontSize: 11 }}>{status}</span>
            </div>
          </div>
          <a href={telHref(r.phone) || undefined} onClick={onTouch} title="Call" style={icon}>📞</a>
          <a href={smsHref(r.phone, smsText) || undefined} onClick={onTouch} title="SMS" style={icon}>SMS</a>
          <a href={waHref(r.phone, waText)} target="_blank" rel="noopener noreferrer" onClick={onTouch} title="WhatsApp" style={icon}>WA</a>
          <button onClick={() => { setOutcome(r.last_outcome || DEFAULT_OUTCOME); setOpen((o) => !o) }} style={{ ...btnBase, flex: 'none', height: 34, padding: '0 10px', fontSize: 12.5, border: '1px solid ' + (r.last_outcome ? '#4E7C3F' : 'var(--border)'), background: r.last_outcome ? '#EAF2E5' : '#fff', color: r.last_outcome ? '#4E7C3F' : 'var(--ink-soft)' }}>{r.last_outcome ? '✓' : 'Log'}</button>
        </div>
        {open && <div style={{ marginTop: 8 }}>{logForm}</div>}
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: avatarFor(0), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(r.person_name)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.person_name}</div>
          <div style={{ fontSize: 12, color: dialable ? 'var(--muted)' : 'var(--red)' }}>{r.phone || 'no phone on record'}</div>
        </div>
        <span className="pill" style={pillForOutcome(r.last_outcome)}>{status}</span>
      </div>
      {r.last_remarks && !open && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>“{r.last_remarks}”</div>}

      {open ? logForm : (
        <div style={{ display: 'flex', gap: 6 }}>
          <a href={telHref(r.phone) || undefined} onClick={onTouch} aria-disabled={!dialable} style={{ ...btnBase, opacity: dialable ? 1 : 0.45, pointerEvents: dialable ? 'auto' : 'none' }}>📞 Call</a>
          <a href={smsHref(r.phone, smsText) || undefined} onClick={onTouch} aria-disabled={!dialable} style={{ ...btnBase, opacity: dialable ? 1 : 0.45, pointerEvents: dialable ? 'auto' : 'none' }}>SMS</a>
          <a href={waHref(r.phone, waText)} target="_blank" rel="noopener noreferrer" onClick={onTouch} aria-disabled={!dialable} style={{ ...btnBase, opacity: dialable ? 1 : 0.45, pointerEvents: dialable ? 'auto' : 'none' }}>WhatsApp</a>
          <button onClick={() => { setOutcome(r.last_outcome || DEFAULT_OUTCOME); setOpen(true) }} style={{ ...btnBase, border: '1px solid ' + (r.last_outcome ? '#4E7C3F' : 'var(--border)'), background: r.last_outcome ? '#EAF2E5' : '#fff', color: r.last_outcome ? '#4E7C3F' : 'var(--ink-soft)' }}>{r.last_outcome ? '✓ Logged' : 'Log'}</button>
        </div>
      )}
    </div>
  )
}

// Recipient row (a volunteer's own batch). WA/SMS taps keep the claim alive
// (last_active_at); Sent is a proper toggle -- tapping it while already sent asks
// for confirmation before reverting (guards against an accidental double-tap).
function RecipientRow({ r, token, splitId, phone, myName, label, onTouch, onSent }) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmingNoWa, setConfirmingNoWa] = useState(false)
  const [lastChannel, setLastChannel] = useState('whatsapp')
  const dialable = hasDialable(r.phone)
  const waText = fillTemplate(r.whatsapp_template, { name: r.person_name, myName })
  const smsText = fillTemplate(r.sms_template, { name: r.person_name, myName })
  const sent = r.message_status === 'sent' || r.message_status === 'responded'

  async function setSentStatus(to) {
    const prev = r.message_status
    setBusy(true)
    onSent(to)
    try {
      const { data, error } = await supabase.rpc('claim_portal_mark_sent', { p_token: token, p_split_id: splitId, p_journey_id: r.journey_id, p_phone: phone, p_channel: lastChannel, p_caller_label: label, p_to: to })
      if (error) throw error
      if (data.status !== 'ok') throw new Error(data.status)
    } catch {
      onSent(prev)
    } finally { setBusy(false) }
  }

  function tapSent() {
    if (sent) { setConfirming(true); return }
    setSentStatus('sent')
  }
  function confirmUndo() {
    setConfirming(false)
    setSentStatus('to_message')
  }

  async function confirmNoWhatsapp() {
    setConfirmingNoWa(false)
    const prev = r.message_status
    setBusy(true)
    onSent('no_whatsapp')
    try {
      const { data, error } = await supabase.rpc('claim_portal_mark_no_whatsapp', { p_token: token, p_split_id: splitId, p_journey_id: r.journey_id, p_phone: phone, p_caller_label: label })
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
        <span className="pill" style={pillForMessage(r.message_status)}>{labelForMessage(r.message_status)}</span>
      </div>

      {confirming ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#FBF6EC', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
          <span style={{ fontSize: 12.5, color: 'var(--ink-soft)', flex: 1 }}>Mark as not sent?</span>
          <button disabled={busy} onClick={confirmUndo} style={{ height: 30, padding: '0 10px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none', background: 'var(--red)', color: '#fff', cursor: 'pointer' }}>Yes, undo</button>
          <button disabled={busy} onClick={() => setConfirming(false)} style={{ height: 30, padding: '0 10px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: '1px solid var(--border)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer' }}>Cancel</button>
        </div>
      ) : confirmingNoWa ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#FBF6EC', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
          <span style={{ fontSize: 12.5, color: 'var(--ink-soft)', flex: 1 }}>Mark {r.person_name} as having no WhatsApp number? They will be skipped in this campaign.</span>
          <button disabled={busy} onClick={confirmNoWhatsapp} style={{ height: 30, padding: '0 10px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none', background: '#C2691F', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>Yes</button>
          <button disabled={busy} onClick={() => setConfirmingNoWa(false)} style={{ height: 30, padding: '0 10px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: '1px solid var(--border)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer' }}>Cancel</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <a href={smsHref(r.phone, smsText)} onClick={() => { setLastChannel('sms'); onTouch() }} aria-disabled={!dialable} style={{ ...btnBase, opacity: dialable ? 1 : 0.45, pointerEvents: dialable ? 'auto' : 'none' }}>SMS</a>
          <a href={waHref(r.phone, waText)} target="_blank" rel="noopener noreferrer" onClick={() => { setLastChannel('whatsapp'); onTouch() }} aria-disabled={!dialable} style={{ ...btnBase, opacity: dialable ? 1 : 0.45, pointerEvents: dialable ? 'auto' : 'none' }}>WhatsApp</a>
          <button onClick={tapSent} disabled={busy} style={{ ...btnBase, border: '1px solid ' + (sent ? '#4E7C3F' : 'var(--border)'), background: sent ? '#EAF2E5' : '#fff', color: sent ? '#4E7C3F' : 'var(--ink-soft)' }}>{sent ? '✓ Sent' : 'Sent'}</button>
          <KebabMenu buttonStyle={{ height: 36, width: 36, fontSize: 16 }} items={[
            { label: '📵 No WhatsApp number', onClick: () => setConfirmingNoWa(true), disabled: busy || r.message_status === 'no_whatsapp' },
          ]} />
        </div>
      )}
    </div>
  )
}

// Full-screen "batch complete" celebration, reached by tapping the sticky done
// button (or the bulk mark-all-sent action) once every recipient is resolved.
// One outcome: the volunteer confirms they're done for today, which shows a
// "come back tomorrow" closing message.
function CelebrationScreen({ name, stats, onDismiss }) {
  const [phase, setPhase] = useState('celebrate') // celebrate | done

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'linear-gradient(160deg, #2a2017, #241b14)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, overflow: 'hidden' }}>
      <Confetti />
      {phase === 'celebrate' && (
        <div style={{ position: 'relative', zIndex: 2, textAlign: 'center', maxWidth: 420 }}>
          <div style={{ fontSize: 56, marginBottom: 8 }}>🙏</div>
          <div style={{ fontFamily: "'Newsreader',serif", fontSize: 26, fontWeight: 600, color: '#F6ECDC', marginBottom: 6 }}>Namaskaram {name.split(' ')[0]}!</div>
          <div style={{ fontSize: 15, color: '#D8CBB4', marginBottom: 22, lineHeight: 1.5 }}>You've reached out to everyone on your list. Thank you for your seva!</div>
          <div style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 16, padding: '18px 20px', marginBottom: 24, display: 'flex', justifyContent: 'center', gap: 28 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#F6ECDC' }}>{stats.total}</div>
              <div style={{ fontSize: 11, color: '#B4A78C', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 2 }}>People</div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#F6ECDC' }}>{stats.sent}</div>
              <div style={{ fontSize: 11, color: '#B4A78C', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 2 }}>Messaged</div>
            </div>
            {stats.noWa > 0 && (
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#F6ECDC' }}>{stats.noWa}</div>
                <div style={{ fontSize: 11, color: '#B4A78C', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 2 }}>No WhatsApp</div>
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={() => setPhase('done')} style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: 15, minHeight: 48 }}>I'm done for today</button>
        </div>
      )}
      {phase === 'done' && (
        <ClosingMessage title="🙏 Thank you for your seva today!" body="Come back tomorrow to help reach out to more people." onDismiss={onDismiss} />
      )}
    </div>
  )
}

function ClosingMessage({ title, body, onDismiss }) {
  return (
    <div style={{ position: 'relative', zIndex: 2, textAlign: 'center', maxWidth: 380 }}>
      <div style={{ fontFamily: "'Newsreader',serif", fontSize: 22, fontWeight: 600, color: '#F6ECDC', marginBottom: 10 }}>{title}</div>
      <div style={{ fontSize: 15, color: '#D8CBB4', marginBottom: 26, lineHeight: 1.5 }}>{body}</div>
      <button className="btn btn-primary" onClick={onDismiss} style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: 15, minHeight: 48 }}>Close</button>
    </div>
  )
}

// CSS-only confetti -- a fixed set of pieces (computed once, not on every
// render) falling on a staggered loop via the .confetti-piece keyframe.
function Confetti() {
  const [pieces] = useState(() => {
    const colors = ['#E79248', '#C2691F', '#4E7C3F', '#F6ECDC', '#B5532F']
    return Array.from({ length: 36 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 2.5,
      duration: 2.6 + Math.random() * 2,
      color: colors[i % colors.length],
      width: 6 + Math.random() * 6,
    }))
  })
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {pieces.map((p, i) => (
        <span key={i} className="confetti-piece" style={{ left: `${p.left}%`, background: p.color, width: p.width, height: p.width * 1.6, animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s` }} />
      ))}
    </div>
  )
}
