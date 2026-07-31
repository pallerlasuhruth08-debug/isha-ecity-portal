import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { initials, avatarFor, pill } from '../lib/ui'
import { Loading, Empty } from './View'
import CampaignForm from './CampaignForm'
import AssignNurturerDialog from './AssignNurturerDialog'
import SidePanel, { PanelHeader } from './SidePanel'
import { ensureSkill } from '../lib/skills'
import { PROGRAMS, programmeCoverage } from '../lib/programs'
import { eligibility, labelOf } from '../lib/eligibility'
import { NURTURE_OUTCOMES, DEFAULT_NURTURE_OUTCOME, labelForOutcome, pillForAnyOutcome } from '../lib/calllog'

// Outcomes come from lib/calllog now. This file used to declare its own three in
// snake_case ('answered', 'will_call_back', 'not_reachable') while every other
// screen wrote Title Case into the SAME column — so this history table rendered a
// raw lowercase "answered" next to "Interested" and "Doing well".
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null)
const waNum = (p) => (p || '').replace(/\D/g, '').replace(/^0+/, '').slice(-10)
const ageOf = (dob) => (dob ? Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400000)) : null)
const genderOf = (g) => (g == null || g === '' ? null : g === 'M' ? 'Male' : g === 'F' ? 'Female' : g)
const boolOf = (v) => (v == null ? null : v ? 'Yes' : 'No')

// Rich person detail (mirrors the AppSheet profile). All values from named
// queries; fields not yet synced from AppSheet render an explicit empty state.
export default function PersonProfile({ personId, me, onClose, onToast, onChanged, panelWidth }) {
  const [p, setP] = useState(null)
  const [vp, setVp] = useState(null)
  const [center, setCenter] = useState(null)
  const [nurturer, setNurturer] = useState(null)
  const [derived, setDerived] = useState([])
  const [manual, setManual] = useState([])
  const [skills, setSkills] = useState([])
  const [skillVocab, setSkillVocab] = useState([])
  const [newSkill, setNewSkill] = useState('')
  const [events, setEvents] = useState([])
  const [calls, setCalls] = useState([])
  const [coverage, setCoverage] = useState(null) // Map(programme -> people recorded); null until known
  const [err, setErr] = useState(null)
  const [newTag, setNewTag] = useState('')
  const [showCampaign, setShowCampaign] = useState(false)
  const [showAssignNurt, setShowAssignNurt] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [outcome, setOutcome] = useState(DEFAULT_NURTURE_OUTCOME)
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [pr, vpr, ctr, nur, mt, att, jn, ps, sv] = await Promise.all([
        supabase.from('people').select('*').eq('id', personId).single(),
        supabase.from('volunteer_profiles').select('*').eq('person_id', personId).maybeSingle(),
        supabase.from('people').select('center:centers!people_center_id_fkey(name)').eq('id', personId).maybeSingle(),
        supabase.from('nurturing_assignments').select('nurturer:people!nurturing_assignments_nurturer_person_id_fkey(full_name)').eq('cared_person_id', personId).eq('active', true),
        supabase.from('manual_tags').select('id, tag').eq('person_id', personId).order('created_at', { ascending: false }),
        supabase.from('attendance').select('time_in, status, activity_type_id, activities!attendance_activity_id_fkey(name, activity_date), atype:activity_types(label, kind)').eq('person_id', personId),
        supabase.from('journeys').select('id, type, campaign:campaigns(is_test), calls(reachability, sadhana_status, remarks, completed_at)').eq('person_id', personId),
        supabase.from('person_skills').select('id, skill:skills(id, label)').eq('person_id', personId),
        supabase.from('skills').select('id, label').eq('active', true).order('sort_order', { ascending: true }).order('label', { ascending: true }),
      ])
      if (pr.error) throw pr.error
      setP(pr.data)
      setVp(vpr.data || null)
      setCenter(ctr.data?.center?.name || null)
      setNurturer((nur.data || []).map((r) => r.nurturer?.full_name).filter(Boolean).join(', ') || null)
      setManual(mt.data || [])
      setSkills(ps.data || [])
      setSkillVocab(sv.data || [])
      const evs = (att.data || [])
        .map((a) => ({ name: a.activities?.name, type: a.atype?.label || null, kind: a.atype?.kind || null, status: a.status || 'attended', date: a.activities?.activity_date || a.time_in }))
        .sort((x, y) => new Date(y.date || 0) - new Date(x.date || 0))
      setEvents(evs)
      const types = new Set()
      // Derived activity-type chips reflect what the person actually DID → attended only.
      for (const a of att.data || []) { if ((a.status || 'attended') !== 'attended') continue; const t = a.atype?.label; if (t) types.add(t) }
      setDerived([...types])
      // Call history spans TWO tables: the legacy `calls` (joined off journeys) and
      // the modern append-only `call_logs` that every log action in the app writes to
      // (this profile, CallLogDialog, Nurturing, Interest, Campaigns). Reading only
      // `calls` meant a call logged here vanished from this very panel. Read both,
      // normalise to one shape, newest first.
      const journeys = jn.data || []
      const testJourneyIds = new Set(journeys.filter((j) => j.campaign?.is_test).map((j) => j.id))
      const journeyIds = journeys.map((j) => j.id).filter(Boolean)

      const cs = []
      // Legacy `calls` — skip test-campaign contact, it never reads as real contact.
      for (const j of journeys) {
        if (j.campaign?.is_test) continue
        for (const c of j.calls || []) {
          if (c.completed_at || c.remarks || c.reachability) {
            cs.push({ key: `c:${j.id}:${c.completed_at || ''}:${c.remarks || ''}`, when: c.completed_at, outcome: c.reachability, sadhana: c.sadhana_status, remarks: c.remarks })
          }
        }
      }

      // Modern `call_logs`: by person, plus by journey (some writers leave person_id null).
      const logQueries = [supabase.from('call_logs').select('id, journey_id, reachability, remarks, logged_at').eq('person_id', personId)]
      if (journeyIds.length) logQueries.push(supabase.from('call_logs').select('id, journey_id, reachability, remarks, logged_at').in('journey_id', journeyIds))
      const logResults = await Promise.all(logQueries)
      const seen = new Set()
      for (const res of logResults) {
        for (const l of res.data || []) {
          if (seen.has(l.id)) continue
          if (l.journey_id && testJourneyIds.has(l.journey_id)) continue
          seen.add(l.id)
          cs.push({ key: `l:${l.id}`, when: l.logged_at, outcome: l.reachability, sadhana: null, remarks: l.remarks })
        }
      }

      cs.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0))
      setCalls(cs)
    } catch (e) { setErr(e.message || String(e)) }
  }, [personId])

  useEffect(() => { load() }, [load])

  // How widely each programme is recorded. Independent of the person, so it
  // loads once and is never re-fetched per profile. Programme Path needs it to
  // tell "they haven't done this" apart from "nobody records this".
  useEffect(() => { let live = true; programmeCoverage().then((c) => { if (live) setCoverage(c) }).catch(() => {}); return () => { live = false } }, [])

  async function addTag() {
    const tag = newTag.trim(); if (!tag) return
    setNewTag('')
    const { data, error } = await supabase.from('manual_tags').insert({ person_id: personId, tag }).select('id, tag').single()
    if (error) return onToast(error.message.includes('duplicate') ? 'Tag already exists.' : 'Could not add tag.')
    setManual((m) => [data, ...m]); onChanged && onChanged()
  }
  async function removeTag(id) {
    setManual((m) => m.filter((x) => x.id !== id))
    const { error } = await supabase.from('manual_tags').delete().eq('id', id)
    if (error) { onToast('Could not remove tag'); load() } else onChanged && onChanged()
  }
  async function applyTag(tag) {
    const { data, error } = await supabase.from('manual_tags').insert({ person_id: personId, tag }).select('id, tag').single()
    if (error) return onToast(error.message.includes('duplicate') ? 'Tag already exists.' : 'Could not apply tag.')
    setManual((m) => [data, ...m]); onToast(`Applied “${tag}” tag.`); onChanged && onChanged()
  }
  async function addSkill(skillId) {
    if (!skillId || skills.some((s) => s.skill?.id === skillId)) return
    const { data, error } = await supabase.from('person_skills').insert({ person_id: personId, skill_id: skillId }).select('id, skill:skills(id, label)').single()
    if (error) return onToast(error.message.includes('duplicate') ? 'Skill already added.' : 'Could not add skill.')
    setSkills((s) => [...s, data]); onChanged && onChanged()
  }
  async function removeSkill(id) {
    setSkills((s) => s.filter((x) => x.id !== id))
    const { error } = await supabase.from('person_skills').delete().eq('id', id)
    if (error) { onToast('Could not remove skill'); load() } else onChanged && onChanged()
  }
  async function createSkill() {
    const label = newSkill.trim(); if (!label) return
    setNewSkill('')
    try {
      const sk = await ensureSkill(label)
      setSkillVocab((v) => (v.some((x) => x.id === sk.id) ? v : [...v, sk].sort((a, b) => a.label.localeCompare(b.label))))
      await addSkill(sk.id)
    } catch (e) { onToast('Could not add skill: ' + (e.message || e)) }
  }
  async function addAsVolunteer() {
    setBusy(true)
    try {
      let e = (await supabase.from('people').update({ is_volunteer: true }).eq('id', personId)).error; if (e) throw e
      e = (await supabase.from('volunteer_profiles').upsert({ person_id: personId, status: 'active', interest_source: 'profile' }, { onConflict: 'person_id' })).error; if (e) throw e
      setP((x) => ({ ...x, is_volunteer: true })); onToast(`${p.full_name} added as volunteer.`); onChanged && onChanged()
    } catch (e) { onToast('Could not add as volunteer: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function addAsMeditator() {
    setBusy(true)
    try { const { error } = await supabase.from('people').update({ is_meditator: true }).eq('id', personId); if (error) throw error; setP((x) => ({ ...x, is_meditator: true })); onToast(`${p.full_name} added as meditator.`); onChanged && onChanged() }
    catch (e) { onToast('Could not add as meditator: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function saveLog() {
    setBusy(true)
    try {
      let jid
      const { data: ex } = await supabase.from('journeys').select('id').eq('person_id', personId).order('created_at', { ascending: false }).limit(1)
      if (ex && ex.length) jid = ex[0].id
      else { const { data: nj, error } = await supabase.from('journeys').insert({ person_id: personId, type: 'volunteer_nurture', status: 'active' }).select('id').single(); if (error) throw error; jid = nj.id }
      const { error } = await supabase.from('call_logs').insert({ journey_id: jid, person_id: personId, reachability: outcome, remarks: remarks || null })
      if (error) throw error
      onToast(`Contact with ${p.full_name} logged.`); setLogOpen(false); setRemarks(''); load()
    } catch (e) { onToast('Could not log: ' + (e.message || e)) } finally { setBusy(false) }
  }

  const hasPhone = !!p?.phone
  const wa = p && hasPhone ? `https://wa.me/91${waNum(p.phone)}` : undefined
  const progTags = p?.tags || []

  // Seva-tag rule (STATED, not silent auto-tagging): attending 3+ events of the SAME
  // activity type (the shared activity_types vocabulary) suggests that type as a tag;
  // a coordinator applies it explicitly below. No hardcoded map — the type IS the tag.
  const SEVA_THRESHOLD = 3
  const sevaCounts = {}
  for (const e of events) { const g = e.type; if (g) sevaCounts[g] = (sevaCounts[g] || 0) + 1 }
  const sevaSuggestions = Object.entries(sevaCounts).filter(([label, n]) => n >= SEVA_THRESHOLD && !manual.some((m) => m.tag === label))

  return (
    <SidePanel onClose={onClose} width={panelWidth}>
      <PanelHeader onClose={onClose}>
        {err && <div style={{ color: '#B5532F', fontSize: 13 }}>{err}</div>}
        {!p && !err && <Loading label="Loading profile…" />}
        {p && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: avatarFor(1), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 600, overflow: 'hidden' }}>
              {p.photo_url ? <img src={p.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(p.full_name)}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 style={{ fontSize: 21, fontWeight: 600, margin: '0 0 2px' }}>{p.full_name}</h2>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{[p.city, p.pincode].filter(Boolean).join(' · ') || center}</div>
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              {p.is_volunteer && <span className="pill" style={pill('var(--pill-orange-bg)', 'var(--pill-orange-fg)')}>Volunteer</span>}
              {p.is_meditator && <span className="pill" style={pill('var(--pill-rust-bg)', 'var(--pill-rust-fg)')}>Meditator</span>}
            </div>
          </div>
        )}
      </PanelHeader>

      {p && (
        <div style={{ padding: '18px 26px 40px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* actions */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <a className="btn btn-primary" href={hasPhone ? `tel:${p.phone}` : undefined} style={{ textDecoration: 'none', opacity: hasPhone ? 1 : 0.45, pointerEvents: hasPhone ? 'auto' : 'none' }}>Call</a>
            <a className="btn btn-ghost" href={wa} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', opacity: hasPhone ? 1 : 0.45, pointerEvents: hasPhone ? 'auto' : 'none' }}>WhatsApp</a>
            <button className="btn btn-ghost" onClick={() => setLogOpen(true)}>Log contact</button>
            <button className="btn btn-ghost" onClick={() => setShowCampaign(true)}>Add to campaign</button>
            {!p.is_volunteer && <button className="btn btn-ghost" disabled={busy} onClick={addAsVolunteer}>Add as volunteer</button>}
            {!p.is_meditator && <button className="btn btn-ghost" disabled={busy} onClick={addAsMeditator}>Add as meditator</button>}
            <button className="btn btn-ghost" onClick={() => setShowAssignNurt(true)}>Add to nurturer</button>
          </div>

          <Section title="Personal Details">
            <Row label="Name" value={p.full_name} strong />
            <Row label="Age" value={ageOf(p.date_of_birth)} />
            <Row label="Gender" value={genderOf(p.gender)} />
            <Row label="Marital Status" value={p.marital_status} />
          </Section>

          <Section title="Contact Details">
            <Row label="Phone" value={p.phone} empty="No phone on record" action={hasPhone && <a href={`tel:${p.phone}`} style={{ color: 'var(--muted)' }}>{Icon.phone(17)}</a>} />
            <Row label="WhatsApp" value={p.phone} empty="No phone on record" action={hasPhone && <a href={wa} target="_blank" rel="noreferrer" style={{ color: 'var(--muted)' }}>{Icon.campaigns(17)}</a>} />
            <Row label="Email" value={p.email} />
            <Row label="Country" value={p.country} />
            <Row label="City" value={p.city} />
            <Row label="Pincode" value={p.pincode} />
            <Row label="Address" value={p.street} />
          </Section>

          <Section title="Key Information">
            <Row label="Center" value={center || p.center_id} />
            <Row label="Region" value={p.region} />
            <Row label="Program Tags" value={progTags.length ? progTags.join(', ') : null} />
            {PROGRAMS.filter((pr) => p[pr.col]).map((pr) => (<Row key={pr.key} label={pr.label} value={fmt(p[pr.col])} />))}
            {!PROGRAMS.some((pr) => p[pr.col]) && <Row label="Programmes" value={null} />}
            <Row label="Last Transaction Date" value={fmt(p.last_active_date)} />
          </Section>

          {/* Programme Path — DERIVED, never stored. Isha publishes the prerequisite
              chain for advanced programmes and we already hold every date it needs,
              so what a person is ready for is a computation, not a coordinator's
              guess. Programmes without a published rule are omitted on purpose. */}
          <Section title="Programme Path">
            <PathPanel person={p} coverage={coverage} />
          </Section>

          <Section title="Other Information">
            <Row label="Volunteering Interest Details" value={vp?.interest_details} wrap />
            <Row label="Would you like to volunteer in-person?" value={vp?.in_person} wrap />
            <Row label="Take a deeper step" value={vp?.deeper_step} wrap />
            <Row label="Any specific skill / hobbies" value={vp?.skills_hobbies} wrap />
            <Row label="Occupation" value={p.occupation || vp?.occupation} />
            <Row label="Any other remarks" value={vp?.remarks} wrap />
            <Row label="Has Bond of Grace" value={boolOf(p.has_bond_of_grace)} />
            <Row label="Has Devi Yantra" value={boolOf(p.has_devi_yantra)} />
            <Row label="Has Sadhguru Sannidhi" value={boolOf(p.has_sadhguru_sannidhi)} />
            <Row label="Is Donor" value={boolOf(p.is_donor)} />
            <Row label="Nurturer" value={nurturer} />
          </Section>

          {/* tags */}
          <Section title="Tags">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {manual.map((t) => (<span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: '#fff', background: '#9C4A14', padding: '3px 9px', borderRadius: 7 }}>{t.tag}<span onClick={() => removeTag(t.id)} style={{ cursor: 'pointer', opacity: 0.8 }}>✕</span></span>))}
              {derived.filter((d) => !manual.some((m) => m.tag === d)).map((d) => (<span key={d} style={{ fontSize: 11.5, fontWeight: 600, color: '#7A5230', background: '#F3EADB', padding: '3px 9px', borderRadius: 7 }}>{d}</span>))}
              {manual.length === 0 && derived.length === 0 && <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>No tags yet.</span>}
            </div>
            {sevaSuggestions.map(([label, n]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 12.5, color: '#5C4A2E', background: '#FBF1E4', border: '1px dashed #D8B98E', borderRadius: 9, padding: '8px 11px', marginBottom: 8 }}>
                <span>Attended <strong>{label}</strong> {n}× — rule: {SEVA_THRESHOLD}+ suggests the {label} tag.</span>
                <button className="btn btn-ghost" style={{ padding: '5px 11px', fontSize: 12, flexShrink: 0 }} onClick={() => applyTag(label)}>Apply “{label}”</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()} placeholder="Add a tag…" style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }} />
              <button className="btn btn-ghost" onClick={addTag}>Add tag</button>
            </div>
          </Section>

          {/* Skills — structured, pickable vocabulary (add new inline) */}
          <Section title="Skills">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {skills.length === 0 && <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>No skills added.</span>}
              {skills.map((s) => (
                <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: '#fff', background: '#33507D', padding: '3px 9px', borderRadius: 7 }}>
                  {s.skill?.label}<span onClick={() => removeSkill(s.id)} style={{ cursor: 'pointer', opacity: 0.8 }}>✕</span>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              <select value="" onChange={(e) => { addSkill(e.target.value); e.target.value = '' }} style={{ flex: 1, minWidth: 150, border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, fontFamily: 'inherit', outline: 'none', background: '#fff' }}>
                <option value="" disabled>Pick a skill…</option>
                {skillVocab.filter((v) => !skills.some((s) => s.skill?.id === v.id)).map((v) => (<option key={v.id} value={v.id}>{v.label}</option>))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={newSkill} onChange={(e) => setNewSkill(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createSkill()} placeholder="Add a new skill…" style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }} />
              <button className="btn btn-ghost" onClick={createSkill}>Add skill</button>
            </div>
          </Section>

          {/* Attendance — one typed timeline (event, satsang, meditator & volunteer) */}
          <Section title="Attendance" count={events.length}>
            {events.length === 0
              ? <Empty label="No attendance recorded yet." />
              : (
                <div className="card" style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead><tr style={{ textAlign: 'left', color: 'var(--muted-2)' }}><th style={th}>Event</th><th style={th}>Type</th><th style={th}>Status</th><th style={th}>Date</th></tr></thead>
                    <tbody>{events.map((e, i) => (<tr key={i} style={{ borderTop: '1px solid #F1E9DB' }}><td style={td}>{e.name || '—'}</td><td style={td}>{e.type || '—'}</td><td style={td}>{e.status === 'registered' ? <span className="pill" style={pill('var(--pill-yellow-bg)', 'var(--pill-yellow-fg)')}>Registered</span> : <span className="pill" style={pill('var(--success-bg)', 'var(--success-fg)')}>Attended</span>}</td><td style={td}>{fmt(e.date) || '—'}</td></tr>))}</tbody>
                  </table>
                </div>
              )}
          </Section>

          {/* Call History */}
          <Section title="Call History" count={calls.length}>
            {calls.length === 0
              ? <Empty label="No calls logged yet." />
              : (
                <div className="card" style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead><tr style={{ textAlign: 'left', color: 'var(--muted-2)' }}><th style={th}>Call Status</th><th style={th}>Response</th><th style={th}>Remarks</th><th style={th}>Date</th></tr></thead>
                    <tbody>{calls.map((c) => (<tr key={c.key} style={{ borderTop: '1px solid #F1E9DB' }}><td style={td}>{c.when ? 'Completed' : 'Scheduled'}{c.outcome ? <> · <span className="pill" style={pillForAnyOutcome(c.outcome)}>{labelForOutcome(c.outcome)}</span></> : ''}</td><td style={td}>{c.sadhana || '—'}</td><td style={td}>{c.remarks || '—'}</td><td style={td}>{fmt(c.when) || '—'}</td></tr>))}</tbody>
                  </table>
                </div>
              )}
          </Section>
        </div>
      )}

      {logOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 130, padding: 20 }} onClick={() => setLogOpen(false)}>
          <div className="card" style={{ width: 400, maxWidth: '100%', padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 12px' }}>Log contact — {p?.full_name}</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>{NURTURE_OUTCOMES.map((o) => (<button key={o} onClick={() => setOutcome(o)} className="btn" style={{ padding: '7px 12px', fontSize: 12.5, background: outcome === o ? '#241B14' : '#fff', color: outcome === o ? '#F6ECDC' : 'var(--ink-soft)', border: outcome === o ? 'none' : '1px solid var(--border)' }}>{o}</button>))}</div>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} placeholder="Remarks…" style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical', marginBottom: 14 }} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}><button className="btn btn-ghost" onClick={() => setLogOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={saveLog}>{busy ? 'Saving…' : 'Save'}</button></div>
          </div>
        </div>
      )}
      {showCampaign && <CampaignForm audience={p?.is_meditator ? 'meditator' : 'volunteer'} personIds={[personId]} segmentLabel={p?.full_name || ''} onClose={() => setShowCampaign(false)} onToast={onToast} />}
      {showAssignNurt && (
        <AssignNurturerDialog personIds={[personId]} label={p?.full_name || ''} me={me}
          onClose={() => setShowAssignNurt(false)} onToast={onToast}
          onDone={() => { setShowAssignNurt(false); load(); onChanged?.() }} />
      )}
    </SidePanel>
  )
}

const th = { padding: '9px 12px', fontSize: 10.5, letterSpacing: '.04em', textTransform: 'uppercase', fontWeight: 700, whiteSpace: 'nowrap' }
const td = { padding: '9px 12px', color: 'var(--ink-soft)', verticalAlign: 'top' }

function Section({ title, count, children }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ color: 'var(--orange)', display: 'flex' }}>{Icon.leaf(18)}</span>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{title}</h3>
        {count != null && <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 20, padding: '1px 8px' }}>{count}</span>}
      </div>
      {children}
    </div>
  )
}

// Programme Path — read-only view of lib/eligibility. Three states a coordinator
// can act on: ready now, ready on a date (needs only time), and blocked on a
// named prerequisite. Completed programmes already appear under Key Information,
// so only the once-in-a-lifetime warning is repeated here.
function PathPanel({ person, coverage }) {
  const e = eligibility(person, new Date(), coverage)
  const rows = [
    ...e.eligible.filter((s) => !s.rule.entry).map((s) => ({ ...s, tone: 'ready' })),
    ...e.blocked.map((s) => ({ ...s, tone: s.readyOn ? 'ripening' : 'blocked' })),
    ...e.indeterminate.map((s) => ({ ...s, tone: 'unknown' })),
  ]
  const noIE = e.states.find((s) => s.key === 'ie' && s.status === 'eligible')
  const bspDone = e.completed.some((s) => s.key === 'bsp')
  // Completed, but the date never arrived from the sync. Shown rather than
  // silently smoothed over: the verdict is now right, and the missing date is
  // still a real data gap somebody should close.
  const inferred = e.completed.filter((s) => s.impliedBy)

  if (noIE) return <Empty label="No Inner Engineering date on record — that is the gate for every advanced programme." />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {inferred.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--info-fg)', background: 'var(--info-bg)', borderRadius: 8, padding: '8px 10px', marginBottom: 2 }}>
          {inferred.map((s) => `${s.label} has no date on record, but ${labelOf(s.impliedBy)} cannot be taken without it — counted as completed.`).join(' ')}
          {' '}Worth fixing at the source so the date is right everywhere.
        </div>
      )}
      {rows.length === 0 && <Empty label="Every programme with a published prerequisite is already completed." />}
      {rows.map((r) => (
        <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 12, alignItems: 'start', padding: '9px 0', borderBottom: '1px solid #F4EEE2' }}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{r.label}</div>
          <div style={{ fontSize: 13, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
            {r.tone === 'ready' && <span className="pill" style={pill('var(--success-bg)', 'var(--success-fg)')}>Eligible now</span>}
            {r.tone === 'ripening' && <span className="pill" style={pill('var(--pill-yellow-bg)', 'var(--pill-yellow-fg)')}>Ready {fmt(r.readyOn)}</span>}
            {r.tone === 'blocked' && <span className="pill" style={pill('var(--neutral-bg)', 'var(--neutral-fg)')}>Not yet</span>}
            {r.tone === 'unknown' && <span className="pill" style={pill('var(--neutral-bg)', 'var(--muted-2)')}>Can’t tell</span>}
            <span style={{ color: 'var(--muted)' }}>{explainBlockers(r)}</span>
          </div>
        </div>
      ))}
      {bspDone && (
        <div style={{ fontSize: 12, color: 'var(--pill-rust-fg)', background: 'var(--pill-rust-bg)', borderRadius: 8, padding: '7px 10px', marginTop: 4 }}>
          Bhava Spandana is attended once in a lifetime — do not offer it again.
        </div>
      )}
    </div>
  )
}

function explainBlockers(r) {
  if (!r.blockers.length) return ''
  const missing = r.blockers.filter((b) => b.reason === 'missing').map((b) => b.label)
  const recent = r.blockers.filter((b) => b.reason === 'too_recent')
  const parts = []
  if (missing.length) parts.push(`needs ${missing.join(', ')}`)
  for (const b of recent) parts.push(`${b.label} must be ${b.minDaysBefore} days prior`)
  // Say what we know AND why the verdict still isn't safe — an untracked column
  // is a gap in the sync, and naming it is the only way it ever gets fixed.
  for (const b of r.blockers.filter((x) => x.reason === 'untracked')) {
    parts.push(b.recordedFor ? `${b.label} is recorded for only ${b.recordedFor} people — too few to judge` : `${b.label} is not recorded for anyone yet`)
  }
  return parts.join(' · ')
}

// Label-left / value-right row; explicit empty state; optional trailing action icon.
function Row({ label, value, empty = 'Not on record', strong, wrap, action }) {
  const isEmpty = value == null || value === ''
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr auto', gap: 12, alignItems: 'start', padding: '9px 0', borderBottom: '1px solid #F4EEE2' }}>
      <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: strong ? 700 : 500, color: isEmpty ? 'var(--muted-2)' : 'var(--ink)', whiteSpace: wrap ? 'normal' : 'nowrap', overflow: wrap ? 'visible' : 'hidden', textOverflow: 'ellipsis' }}>
        {isEmpty ? empty : String(value)}
      </div>
      <div>{action || null}</div>
    </div>
  )
}
