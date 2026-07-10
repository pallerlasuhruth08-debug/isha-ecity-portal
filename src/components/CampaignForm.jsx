import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { multiFieldOr } from '../lib/searchFilter'

// Campaign creation form (design §2 + two-source caller assignment).
// Callers can come from VOLUNTEERS (people) or the NURTURING TEAM (nurturers) —
// separate tables, so each caller stores (caller_source, caller_id).
// Writes on submit only:
//   campaigns -> { ..., segment:{distribution, callers:[{source,id}]} }
//   journeys  -> per recipient { person_id, type:'campaign', campaign_id, status:'active',
//                caller_source, caller_id, assigned_to }
//   assigned_to = the caller's operating profile, set ONLY for nurturing_team callers
//   that have a profile_id (so they can operate the caller workspace). Volunteers /
//   no-profile nurturers are assignment-only (assigned_to null).
const DIST = [
  { key: 'equal', label: 'Divide equally', hint: 'Round-robin; remainder to the first callers' },
  { key: 'shared', label: 'Shared pool', hint: 'Unassigned queue; callers claim next uncalled' },
  { key: 'manual', label: 'Manual', hint: 'Assign specific recipients to specific callers' },
]
const ckey = (c) => `${c.source}:${c.id}`

export default function CampaignForm({ audience = 'volunteer', personIds = [], segmentLabel = '', eventId = null, defaultType = 'full', onClose, onCreated, onToast }) {
  const [name, setName] = useState('')
  const [goal, setGoal] = useState(segmentLabel || '')
  const [templates, setTemplates] = useState([])
  const [templateId, setTemplateId] = useState('')
  const [message, setMessage] = useState('')
  const [script, setScript] = useState('')
  const [wa, setWa] = useState('')
  const [sms, setSms] = useState('')
  const [campaignType, setCampaignType] = useState(defaultType) // 'full' | 'messaging'
  const [schedule, setSchedule] = useState('')

  // caller sources
  const [nurturers, setNurturers] = useState([])
  const [nurturerPhones, setNurturerPhones] = useState(new Set())
  const [callerTab, setCallerTab] = useState('nurturing') // 'nurturing' | 'volunteers' | 'both'
  const [volSearch, setVolSearch] = useState('')
  const [volResults, setVolResults] = useState([])
  const [selCallers, setSelCallers] = useState([]) // caller objects {source,id,name,phone,profileId}
  const [mode, setMode] = useState('')

  const [recipients, setRecipients] = useState([])
  const [manualMap, setManualMap] = useState({}) // personId -> caller key
  const [bulkCaller, setBulkCaller] = useState('')

  const [isTest, setIsTest] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    supabase.from('message_templates').select('id, name, body').order('name').then(({ data }) => setTemplates(data || []))
    supabase.from('nurturers').select('id, full_name, phone, profile_id').order('full_name').then(({ data }) => {
      setNurturers(data || [])
      setNurturerPhones(new Set((data || []).map((n) => n.phone).filter(Boolean)))
    })
  }, [])

  // volunteer caller search — debounced name+phone, same multi-field pattern used
  // everywhere else (exclude phones already on the nurturing team — nurturing wins).
  const [volSearchDebounced, setVolSearchDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setVolSearchDebounced(volSearch.trim()), 300)
    return () => clearTimeout(t)
  }, [volSearch])
  useEffect(() => {
    if (callerTab === 'nurturing' || volSearchDebounced.length < 2) {
      setVolResults([])
      return
    }
    let alive = true
    const or = multiFieldOr(volSearchDebounced, ['full_name', 'phone'])
    supabase
      .from('people')
      .select('id, full_name, phone')
      .eq('is_volunteer', true)
      .or(or)
      .limit(12)
      .then(({ data }) => {
        if (alive) setVolResults((data || []).filter((p) => !p.phone || !nurturerPhones.has(p.phone)))
      })
    return () => {
      alive = false
    }
  }, [volSearchDebounced, callerTab, nurturerPhones])

  const callerCount = selCallers.length
  const needMode = callerCount >= 2
  const selKeys = useMemo(() => new Set(selCallers.map(ckey)), [selCallers])
  const byKey = useMemo(() => Object.fromEntries(selCallers.map((c) => [ckey(c), c])), [selCallers])

  function toggleCaller(c) {
    setSelCallers((prev) => (prev.some((x) => ckey(x) === ckey(c)) ? prev.filter((x) => ckey(x) !== ckey(c)) : [...prev, c]))
  }

  useEffect(() => {
    if (mode !== 'manual' || !personIds.length || recipients.length) return
    let alive = true
    ;(async () => {
      const out = []
      for (let i = 0; i < personIds.length; i += 300) {
        const { data } = await supabase.from('people').select('id, full_name').in('id', personIds.slice(i, i + 300))
        out.push(...(data || []))
      }
      if (alive) setRecipients(out)
    })()
    return () => {
      alive = false
    }
  }, [mode, personIds, recipients.length])

  function pickTemplate(id) {
    setTemplateId(id)
    const t = templates.find((x) => x.id === id)
    if (t) setMessage(t.body || '')
  }

  function callerForIndex(i, pid) {
    if (selCallers.length === 0) return null
    if (selCallers.length === 1) return selCallers[0]
    if (mode === 'equal') return selCallers[i % selCallers.length]
    if (mode === 'shared') return null
    if (mode === 'manual') return manualMap[pid] ? byKey[manualMap[pid]] : null
    return null
  }

  async function submit(e) {
    e.preventDefault()
    if (!name.trim()) return setErr('Give the campaign a name.')
    if (needMode && !mode) return setErr('Choose how recipients are distributed across the callers.')
    setBusy(true)
    setErr(null)
    try {
      const distribution = selCallers.length >= 2 ? mode : selCallers.length === 1 ? 'single' : 'none'
      const { data: camp, error: e1 } = await supabase
        .from('campaigns')
        .insert({
          name: name.trim(),
          goal: goal.trim() || null,
          campaign_type: campaignType,
          script: campaignType === 'messaging' ? null : (script.trim() || null),
          message: message.trim() || null,
          whatsapp_template: wa.trim() || null,
          sms_template: sms.trim() || null,
          audience,
          status: 'active',
          is_test: isTest,
          event_id: eventId || null,
          segment: { from: audience === 'meditator' ? 'meditators' : 'volunteers', schedule: schedule || null, size: personIds.length, distribution, callers: selCallers.map((c) => ({ source: c.source, id: c.id })) },
        })
        .select('id, name')
        .single()
      if (e1) throw e1

      if (personIds.length) {
        const BATCH = 500
        for (let i = 0; i < personIds.length; i += BATCH) {
          const rows = personIds.slice(i, i + BATCH).map((pid, j) => {
            const c = callerForIndex(i + j, pid)
            return {
              person_id: pid,
              type: 'campaign',
              campaign_id: camp.id,
              status: 'active',
              caller_source: c ? c.source : null,
              caller_id: c ? c.id : null,
              // operating profile: only nurturing-team callers who can log in
              assigned_to: c && c.source === 'nurturing_team' && c.profileId ? c.profileId : null,
            }
          })
          const { error: e2 } = await supabase.from('journeys').insert(rows)
          if (e2) throw e2
        }
      }

      onToast(`Campaign "${camp.name}" created${personIds.length ? ` with ${personIds.length} people` : ''}${selCallers.length ? ` · ${selCallers.length} caller(s)` : ''}.`)
      onCreated && onCreated(camp.id)
      onClose()
    } catch (e2) {
      setErr(e2.message || String(e2))
    } finally {
      setBusy(false)
    }
  }

  const field = { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13.5, fontFamily: 'inherit', background: '#fff', color: 'var(--ink)', outline: 'none' }
  const label = { fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted-2)', marginBottom: 6, display: 'block' }
  const srcBadge = (s) => ({ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', padding: '1px 6px', borderRadius: 5, color: s === 'nurturing_team' ? '#2F6E5E' : '#9C4A14', background: s === 'nurturing_team' ? '#E9F0EF' : '#F3E3D2' })

  const Row = ({ c, sub }) => {
    const on = selKeys.has(ckey(c))
    return (
      <div className="rowhover" onClick={() => toggleCaller(c)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', cursor: 'pointer', borderBottom: '1px solid #F4EEE2' }}>
        <div style={{ width: 18, height: 18, borderRadius: 5, border: '1.5px solid ' + (on ? '#C2691F' : '#D8CBB6'), background: on ? '#C2691F' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
          {on && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name || 'Unnamed'}</div>
          {sub && <div style={{ fontSize: 10.5, color: 'var(--muted-2)' }}>{sub}</div>}
        </div>
        <span style={srcBadge(c.source)}>{c.source === 'nurturing_team' ? 'Team' : 'Volunteer'}</span>
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 580, maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto', padding: 26, boxShadow: 'var(--shadow-lg)' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 4px' }}>New campaign</h2>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>{personIds.length ? `Creating campaign for ${personIds.length} people.` : 'No recipients selected.'}</div>

        {err && <div style={{ background: '#FBE6E0', color: '#B5532F', padding: '10px 12px', borderRadius: 9, fontSize: 12.5, marginBottom: 14 }}>{err}</div>}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={label}>Campaign type</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[{ v: 'full', l: 'Full Campaign' }, { v: 'messaging', l: 'Messaging Campaign' }].map((t) => (
                <button key={t.v} type="button" onClick={() => setCampaignType(t.v)} className="btn" style={{ flex: 1, padding: '9px 12px', fontSize: 12.5, background: campaignType === t.v ? '#241B14' : '#fff', color: campaignType === t.v ? '#F6ECDC' : 'var(--ink-soft)', border: campaignType === t.v ? 'none' : '1px solid var(--border)' }}>{t.l}</button>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>{campaignType === 'messaging' ? 'WhatsApp & SMS only — no call script or dialing.' : 'Calls + WhatsApp + SMS, with a call script.'}</div>
          </div>
          <div>
            <label style={label}>Campaign name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shoonya — August cohort" style={field} />
          </div>
          {/* Real vs test — a deliberate choice at creation. Test campaigns + all their
              logs/statuses are excluded from real signals and are freely deletable. */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, cursor: 'pointer', color: isTest ? '#B5532F' : 'var(--ink-soft)' }}>
            <input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} />
            <span><strong>Test campaign</strong> — excluded from call-history, last-active &amp; stats; freely deletable</span>
          </label>
          <div>
            <label style={label}>Target segment</label>
            <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Who this reaches" style={field} />
          </div>
          <div>
            <label style={label}>Message template</label>
            <select value={templateId} onChange={(e) => pickTemplate(e.target.value)} style={field}>
              <option value="">— choose a template —</option>
              {templates.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
            </select>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Message body…" style={{ ...field, marginTop: 8, resize: 'vertical' }} />
          </div>
          {/* WhatsApp + SMS templates — the primary content for a messaging campaign. */}
          <div style={campaignType === 'messaging' ? { padding: 12, border: '1px solid #E7C9B8', borderRadius: 10, background: '#FBF6EC', display: 'flex', flexDirection: 'column', gap: 12 } : { display: 'flex', flexDirection: 'column', gap: 12 }}>
            {campaignType === 'messaging' && <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#9C4A14' }}>Message content</div>}
            <div>
              <label style={label}>WhatsApp template</label>
              <textarea value={wa} onChange={(e) => setWa(e.target.value)} rows={3} placeholder="Prefilled into the WhatsApp button…" style={{ ...field, resize: 'vertical' }} />
            </div>
            <div>
              <label style={label}>SMS template</label>
              <textarea value={sms} onChange={(e) => setSms(e.target.value)} rows={2} placeholder="Prefilled into the SMS button…" style={{ ...field, resize: 'vertical' }} />
            </div>
          </div>
          {campaignType === 'full' && (
            <div>
              <label style={label}>Call script (optional)</label>
              <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={2} placeholder="One step per line…" style={{ ...field, resize: 'vertical' }} />
            </div>
          )}

          {/* CALLERS — two sources */}
          <div>
            <label style={label}>Callers ({callerCount} selected) — from volunteers or the nurturing team</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {[{ k: 'nurturing', l: 'Nurturing team' }, { k: 'volunteers', l: 'Volunteers' }, { k: 'both', l: 'Both' }].map((t) => (
                <button key={t.k} type="button" onClick={() => setCallerTab(t.k)} className="btn" style={{ padding: '6px 11px', fontSize: 12, background: callerTab === t.k ? '#241B14' : '#fff', color: callerTab === t.k ? '#F6ECDC' : 'var(--ink-soft)', border: callerTab === t.k ? 'none' : '1px solid var(--border)' }}>{t.l}</button>
              ))}
            </div>

            {/* selected chips */}
            {selCallers.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {selCallers.map((c) => (
                  <span key={ckey(c)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, background: '#FBF1E6', border: '1px solid #EBD9C2', borderRadius: 7, padding: '3px 8px' }}>
                    {c.name}
                    <span style={srcBadge(c.source)}>{c.source === 'nurturing_team' ? 'Team' : 'Vol'}</span>
                    <span onClick={() => toggleCaller(c)} style={{ cursor: 'pointer', color: 'var(--muted)' }}>✕</span>
                  </span>
                ))}
              </div>
            )}

            {(callerTab === 'volunteers' || callerTab === 'both') && (
              <input value={volSearch} onChange={(e) => setVolSearch(e.target.value)} placeholder="Search volunteer callers by name or phone…" style={{ ...field, marginBottom: 8 }} />
            )}

            <div style={{ maxHeight: 170, overflowY: 'auto', border: '1px solid var(--border-soft)', borderRadius: 10 }}>
              {(callerTab === 'nurturing' || callerTab === 'both') &&
                nurturers.map((n) => (
                  <Row key={'n' + n.id} c={{ source: 'nurturing_team', id: n.id, name: n.full_name, phone: n.phone, profileId: n.profile_id }} sub={n.profile_id ? 'can log in' : 'assignment-only (no login)'} />
                ))}
              {(callerTab === 'volunteers' || callerTab === 'both') &&
                volResults.map((p) => (
                  <Row key={'v' + p.id} c={{ source: 'volunteer', id: p.id, name: p.full_name, phone: p.phone, profileId: null }} sub={p.phone || ''} />
                ))}
              {(callerTab === 'volunteers' || callerTab === 'both') && volSearch.trim().length >= 2 && volResults.length === 0 && (
                <div style={{ padding: 12, fontSize: 12, color: 'var(--muted-2)' }}>No matching volunteers (those already on the nurturing team are hidden).</div>
              )}
              {callerTab === 'volunteers' && volSearch.trim().length < 2 && (
                <div style={{ padding: 12, fontSize: 12, color: 'var(--muted-2)' }}>Type to search volunteer callers.</div>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 6 }}>Volunteers &amp; nurturers without a login are recorded as responsible; a coordinator logs on their behalf.</div>
          </div>

          {needMode && (
            <div>
              <label style={label}>Distribution across {callerCount} callers *</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {DIST.map((d) => (
                  <label key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 11px', border: '1.5px solid ' + (mode === d.key ? '#C2691F' : '#ECE3D4'), borderRadius: 10, cursor: 'pointer', background: mode === d.key ? '#FBF1E6' : '#fff' }}>
                    <input type="radio" name="dist" checked={mode === d.key} onChange={() => setMode(d.key)} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{d.label}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{d.hint}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {needMode && mode === 'manual' && (
            <div>
              <label style={label}>Assign recipients to callers</label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <select value={bulkCaller} onChange={(e) => setBulkCaller(e.target.value)} style={{ ...field, flex: 1 }}>
                  <option value="">Bulk: assign all to…</option>
                  {selCallers.map((c) => (<option key={ckey(c)} value={ckey(c)}>{c.name} ({c.source === 'nurturing_team' ? 'Team' : 'Vol'})</option>))}
                </select>
                <button type="button" className="btn btn-ghost" disabled={!bulkCaller} onClick={() => setManualMap(Object.fromEntries(personIds.map((p) => [p, bulkCaller])))}>Apply to all</button>
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border-soft)', borderRadius: 10 }}>
                {recipients.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: 'var(--muted-2)' }}>Loading recipients…</div>}
                {recipients.map((r) => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 11px', borderBottom: '1px solid #F4EEE2' }}>
                    <div style={{ fontSize: 12.5, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.full_name}</div>
                    <select value={manualMap[r.id] || ''} onChange={(e) => setManualMap((m) => ({ ...m, [r.id]: e.target.value }))} style={{ fontSize: 12, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 7, background: '#fff' }}>
                      <option value="">— unassigned —</option>
                      {selCallers.map((c) => (<option key={ckey(c)} value={ckey(c)}>{c.name}</option>))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label style={label}>Schedule (optional)</label>
            <input type="date" value={schedule} onChange={(e) => setSchedule(e.target.value)} style={field} />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create campaign'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
