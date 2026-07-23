import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { initials, avatarFor } from '../lib/ui'

// Public per-day attendance capture — ONE link per attendance session
// (attendance_sessions.public_token), reached via #attend/<token>. Verification
// reuses the messaging-portal logic (phone -> email -> coordinator approval) via
// the attend_* RPCs; once approved, the volunteer gets the same capture tool the
// coordinators use internally (reference roster + search + walk-ins).

const credKey = (token) => `attend_portal_${token}`
const box = { maxWidth: 520, margin: '0 auto', width: '100%' }
const fieldStyle = { padding: '13px 14px', border: '1px solid var(--border)', borderRadius: 10, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: 'var(--ink)', outline: 'none', width: '100%', boxSizing: 'border-box' }
const fieldLabel = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted-2)', marginBottom: 6 }
const fmtDate = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : '')

export default function AttendancePortal({ token }) {
  const [info, setInfo] = useState(undefined) // undefined=loading, null=invalid, {}=valid
  const [caller, setCaller] = useState(null) // {name, phone}
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [err, setErr] = useState(null)
  const [toast, setToast] = useState(null)

  const [session, setSession] = useState(undefined) // {ok, status, verified_by} | {ok:false}
  const [email, setEmail] = useState('')
  const [emailErr, setEmailErr] = useState(null)
  const [emailBusy, setEmailBusy] = useState(false)

  const [roster, setRoster] = useState(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [walk, setWalk] = useState(null) // {name, phone} walk-in mini form
  const seq = useRef(0)

  const approved = session?.ok && session.status === 'approved'

  useEffect(() => {
    let alive = true
    supabase.rpc('attend_info', { p_token: token }).then(({ data, error }) => {
      if (!alive) return
      if (error || !data?.ok) { setInfo(null); return }
      setInfo(data)
      try { const s = JSON.parse(localStorage.getItem(credKey(token)) || 'null'); if (s?.name && s?.phone) setCaller(s) } catch { /* ignore */ }
    })
    return () => { alive = false }
  }, [token])

  const identify = useCallback(() => {
    if (!caller) return
    supabase.rpc('attend_identify', { p_token: token, p_name: caller.name, p_phone: caller.phone })
      .then(({ data, error }) => setSession(error ? { ok: false } : data))
  }, [caller, token])

  useEffect(() => { if (!caller) { setSession(undefined); return } identify() /* eslint-disable-line */ }, [caller, token])

  // Pending → poll for a coordinator decision.
  useEffect(() => {
    if (session?.ok !== true || session.status !== 'pending') return
    const t = setInterval(identify, 30000)
    return () => clearInterval(t)
  }, [session, identify])

  const loadRoster = useCallback(() => {
    if (!approved || !caller) return
    supabase.rpc('attend_roster', { p_token: token, p_phone: caller.phone }).then(({ data }) => setRoster(data?.ok ? data : { ok: true, present: [], members: [], capture_open: false }))
  }, [approved, caller, token])
  useEffect(() => { loadRoster() }, [loadRoster])

  // Search existing people (server decides name vs phone).
  useEffect(() => {
    if (!approved || !caller) return
    const h = setTimeout(async () => {
      const term = q.trim()
      if (term.length < 2) { setResults([]); return }
      const s = ++seq.current
      const { data } = await supabase.rpc('attend_search', { p_token: token, p_phone: caller.phone, p_q: term })
      if (s === seq.current) setResults(Array.isArray(data) ? data : [])
    }, 300)
    return () => clearTimeout(h)
  }, [q, approved, caller, token])

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
    setCaller(null); setSession(undefined); setRoster(null); setName(''); setPhone(''); setErr(''); setEmail(''); setEmailErr(null)
  }

  async function verifyEmail(skip) {
    setEmailErr(null)
    if (!skip && !email.trim()) return setEmailErr('Please enter your email address.')
    setEmailBusy(true)
    try {
      const { data, error } = await supabase.rpc('attend_verify_email', { p_token: token, p_name: caller.name, p_phone: caller.phone, p_email: skip ? null : email.trim() })
      if (error) throw error
      setSession({ ok: true, status: data.status, verified_by: data.verified_by })
    } catch (e) { setEmailErr('Could not verify: ' + (e.message || e)) } finally { setEmailBusy(false) }
  }

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(null), 2500) }

  const presentIds = new Set((roster?.present || []).map((p) => p.person_id))

  async function mark(person) {
    if (busy) return
    if (presentIds.has(person.person_id || person.id)) { showToast(`${person.full_name} already marked.`); return }
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('attend_mark', { p_token: token, p_phone: caller.phone, p_person_id: person.person_id || person.id, p_activity_type_id: null, p_center_id: null })
      if (error) throw error
      if (!data.ok) { showToast(data.reason === 'not_open' ? 'Attendance is not open yet.' : data.reason === 'already' ? `${person.full_name} already marked.` : 'Could not mark.'); return }
      setQ(''); setResults([]); showToast(`${data.full_name} — present ✓`); loadRoster()
    } catch (e) { showToast('Could not mark: ' + (e.message || e)) } finally { setBusy(false) }
  }

  async function markWalkIn() {
    const nm = (walk?.name || '').trim()
    if (!nm) return showToast('Enter a name.')
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('attend_create_and_mark', { p_token: token, p_phone: caller.phone, p_name: nm, p_newphone: walk?.phone || null, p_activity_type_id: null, p_center_id: null })
      if (error) throw error
      if (!data.ok) { showToast(data.reason === 'not_open' ? 'Attendance is not open yet.' : data.reason === 'already' ? 'Already marked.' : 'Could not add.'); return }
      setWalk(null); showToast(`${data.full_name} — present ✓`); loadRoster()
    } catch (e) { showToast('Could not add: ' + (e.message || e)) } finally { setBusy(false) }
  }

  async function unmark(attendanceId, nm) {
    setBusy(true)
    try {
      const { error } = await supabase.rpc('attend_unmark', { p_token: token, p_phone: caller.phone, p_attendance_id: attendanceId })
      if (error) throw error
      showToast(`${nm} removed.`); loadRoster()
    } catch (e) { showToast('Could not remove: ' + (e.message || e)) } finally { setBusy(false) }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ ...box, textAlign: 'center', marginBottom: 18 }}>
        <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15, fontWeight: 600, color: 'var(--orange)' }}>Electronic City · Volunteer Care</div>
      </div>

      {info === undefined && <div style={{ ...box, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>Loading…</div>}
      {info === null && (
        <div className="card" style={{ ...box, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>This link isn't valid</div>
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>Please ask your coordinator for a fresh link.</div>
        </div>
      )}

      {/* Identify */}
      {info && !caller && (
        <div className="card" style={{ ...box, padding: 16 }}>
          <div style={{ fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700 }}>Attendance</div>
          <h1 style={{ fontFamily: "'Newsreader',serif", fontSize: 22, fontWeight: 600, margin: '4px 0 2px' }}>{info.event_name}</h1>
          <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 16 }}>{info.day_title} · {fmtDate(info.session_date)}</div>
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

      {info && caller && session === undefined && <div style={{ ...box, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>Checking your details…</div>}

      {info && caller && session && !session.ok && (
        <div className="card" style={{ ...box, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Your session has expired</div>
          <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 14 }}>Please open the link again or contact your coordinator.</div>
          <button className="btn btn-ghost" onClick={signOut} style={{ minHeight: 44 }}>Start over</button>
        </div>
      )}

      {/* needs_email */}
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

      {/* Capture */}
      {info && caller && approved && (
        <div style={{ ...box }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontFamily: "'Newsreader',serif", fontSize: 18, fontWeight: 600 }}>Namaskaram, {caller.name.split(' ')[0]}</div>
            <div style={{ fontSize: 14, color: 'var(--muted)' }}>{info.event_name} · {info.day_title}</div>
          </div>

          {roster && !roster.capture_open && (
            <div className="card" style={{ padding: 16, textAlign: 'center', color: 'var(--ink-soft)' }}>
              Attendance for this day opens on <strong>{fmtDate(info.session_date)}</strong>.
            </div>
          )}

          {roster && roster.capture_open && (
            <>
              {/* search + walk-in */}
              <div className="card" style={{ padding: 14, marginBottom: 12 }}>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone to mark present…" style={{ ...fieldStyle }} />
                {results.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                    {results.map((r) => (
                      <button key={r.id} disabled={busy || presentIds.has(r.id)} onClick={() => mark(r)} style={rowBtn(presentIds.has(r.id))}>
                        <span style={{ textAlign: 'left', flex: 1 }}>{r.full_name}<span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {r.phone || 'no phone'}</span></span>
                        <span>{presentIds.has(r.id) ? '✓' : '+ Present'}</span>
                      </button>
                    ))}
                  </div>
                )}
                {q.trim().length >= 2 && results.length === 0 && (
                  walk ? null : <button onClick={() => setWalk({ name: q.trim(), phone: '' })} style={{ marginTop: 10, background: 'none', border: '1px dashed var(--border)', borderRadius: 9, padding: '9px 12px', fontSize: 13, fontWeight: 600, color: 'var(--rust)', cursor: 'pointer', width: '100%' }}>+ Add “{q.trim()}” as a walk-in</button>
                )}
                {walk && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input value={walk.name} onChange={(e) => setWalk({ ...walk, name: e.target.value })} placeholder="Full name" style={fieldStyle} />
                    <input value={walk.phone} onChange={(e) => setWalk({ ...walk, phone: e.target.value })} placeholder="Phone (optional)" inputMode="tel" style={fieldStyle} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-primary" disabled={busy} onClick={markWalkIn} style={{ flex: 1, justifyContent: 'center', minHeight: 44 }}>Mark present</button>
                      <button className="btn btn-ghost" onClick={() => setWalk(null)} style={{ minHeight: 44 }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>

              {/* present */}
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em', margin: '4px 2px 8px' }}>Present · {(roster.present || []).length}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
                {(roster.present || []).length === 0 && <div style={{ fontSize: 13, color: 'var(--muted-2)', padding: '4px 2px' }}>No one marked yet.</div>}
                {(roster.present || []).map((p) => (
                  <div key={p.attendance_id} className="card" style={{ padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: avatarFor(0), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>{initials(p.full_name)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.full_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.phone || 'no phone'}</div>
                    </div>
                    <button disabled={busy} onClick={() => unmark(p.attendance_id, p.full_name)} title="Remove" style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', padding: 4 }}>✕</button>
                  </div>
                ))}
              </div>

              {/* reference roster (team members not yet present) */}
              {(() => {
                const pending = (roster.members || []).filter((m) => !presentIds.has(m.person_id))
                if (pending.length === 0) return null
                return (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em', margin: '4px 2px 8px' }}>Team roster · tap to mark</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
                      {pending.map((m) => (
                        <button key={m.person_id} disabled={busy} onClick={() => mark(m)} style={rowBtn(false)}>
                          <span style={{ textAlign: 'left', flex: 1 }}>{m.full_name}<span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {m.phone || 'no phone'}</span></span>
                          <span>+ Present</span>
                        </button>
                      ))}
                    </div>
                  </>
                )
              })()}
            </>
          )}

          <div style={{ textAlign: 'center', marginTop: 8, marginBottom: 40 }}>
            <button onClick={signOut} style={{ minHeight: 44, padding: '0 16px', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 14, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Sign out</button>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', background: '#241B14', color: '#F6ECDC', padding: '11px 18px', borderRadius: 10, fontSize: 13.5, fontWeight: 600, boxShadow: 'var(--shadow-lg)', zIndex: 200, maxWidth: 'calc(100vw - 32px)', textAlign: 'center' }}>{toast}</div>
      )}
    </div>
  )
}

const rowBtn = (done) => ({ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '11px 13px', borderRadius: 10, border: '1px solid var(--border)', background: done ? '#EAF2E5' : '#fff', color: done ? '#4E7C3F' : 'var(--ink-soft)', fontSize: 14, fontWeight: 600, cursor: done ? 'default' : 'pointer' })
