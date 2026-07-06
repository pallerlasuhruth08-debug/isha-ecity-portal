import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Pad, ErrorCard, Loading, Empty } from '../components/View'
import { initials, avatarFor } from '../lib/ui'
import { fetchActivityTypes } from '../lib/activityTypes'
import { waHref } from '../lib/phone'
import EventList, { EventCalendarPanel } from '../components/EventList'
import RecurrenceFields, { toRule } from '../components/RecurrenceFields'
import {
  eventDays, effectiveStage, deriveStage, STAGES, STAGE_TONE,
  fillCount, fmtDay, rangeLabel, todayISO, generateOccurrences, addDaysISO,
} from '../lib/planning'

// BOUNDARY: the whole volunteer-staffing loop lives HERE (blocks, per-day slots,
// recruiting, assignment, attendance, reliability). The Events screen stays
// attendance-only and shares the same event record — planning never renders there.
// Event creation exists on BOTH screens (same activities row); creating from the
// calendar here is equivalent to creating on Events.

const inputStyle = { padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', background: '#fff', color: 'var(--ink)', outline: 'none', width: '100%', boxSizing: 'border-box' }
const selStyle = { ...inputStyle, cursor: 'pointer' }
const label = { fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }

export default function Planning({ me, isCoordinator, onToast }) {
  const [events, setEvents] = useState(null)
  const [stageRows, setStageRows] = useState({}) // activity_id -> {stage, manual}
  const [err, setErr] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [creating, setCreating] = useState(null)
  const [showCal, setShowCal] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    const [a, s] = await Promise.all([
      supabase.from('activities').select('id, name, center_id, activity_date, start_date, end_date, activity_type_id, description, series_id').is('archived_at', null).order('start_date', { ascending: true }),
      supabase.from('event_stages').select('activity_id, stage, manual'),
    ])
    if (a.error) { setErr(a.error.message); setEvents([]); return }
    setEvents(a.data || [])
    setStageRows(Object.fromEntries((s.data || []).map((r) => [r.activity_id, r])))
  }, [])
  useEffect(() => { load() }, [load])

  if (err) return <Pad><ErrorCard>Couldn't load planning: {err}</ErrorCard></Pad>
  if (!events) return <Pad><Loading label="Loading planning…" /></Pad>

  if (openId) {
    const ev = events.find((e) => e.id === openId)
    if (!ev) { setOpenId(null); return null }
    return <PlanningEvent ev={ev} stageRow={stageRows[ev.id]} me={me} isCoordinator={isCoordinator} onBack={() => { setOpenId(null); load() }} onToast={onToast} onEventChanged={load} />
  }

  // List-first (upcoming default). Clicking an event opens the STAFFING detail
  // (distinct from the Attendance page). The calendar is a panel over the list.
  return (
    <Pad>
      <p style={{ margin: '0 0 14px', fontSize: 13.5, color: 'var(--muted)' }}>Staff volunteers for each event — activity blocks, per-day slots, recruiting.</p>
      <EventList events={events} stageRows={stageRows} onOpen={setOpenId} right={isCoordinator && (
        <>
          <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '8px 13px' }} onClick={() => setShowCal(true)}>📅 Calendar</button>
          <button className="btn btn-primary" style={{ fontSize: 12.5, padding: '8px 14px' }} onClick={() => setCreating(true)}>＋ Create event</button>
        </>
      )} />
      {showCal && (
        <EventCalendarPanel events={events} stageRows={stageRows}
          onOpen={(id) => { setShowCal(false); setOpenId(id) }}
          onCreateDay={isCoordinator ? (d) => { setShowCal(false); setCreating(d) } : undefined}
          onClose={() => setShowCal(false)} />
      )}
      {creating && <CreateEventForm preset={creating === true ? '' : creating} me={me} onClose={() => setCreating(null)} onToast={onToast} onCreated={(id) => { setCreating(null); load(); if (id) setOpenId(id) }} />}
    </Pad>
  )
}

function CreateEventForm({ preset, me, onClose, onToast, onCreated }) {
  const [name, setName] = useState('')
  const [start, setStart] = useState(preset || todayISO())
  const [end, setEnd] = useState(preset || todayISO())
  const [centre, setCentre] = useState('')
  const [centres, setCentres] = useState([])
  const [typeId, setTypeId] = useState('')
  const [types, setTypes] = useState([])
  const [desc, setDesc] = useState('')
  const [recur, setRecur] = useState({ freq: 'none' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('centers').select('id, name').eq('active', true).then(({ data }) => {
      const real = (data || []).filter((c) => !['all', 'unassigned'].includes(c.id))
      setCentres(real); if (real[0]) setCentre(real[0].id)
    })
    fetchActivityTypes().then((all) => setTypes((all || []).filter((t) => t.kind === 'volunteer')))
  }, [])

  async function save() {
    if (!name.trim()) return onToast('Event needs a name.')
    if (end < start) return onToast('End date is before start date.')
    setBusy(true)
    try {
      const base = { name: name.trim(), center_id: centre || null, activity_type_id: typeId || null, description: desc.trim() || null, is_open: true, created_by: me?.id || null }
      const rule = toRule(recur)
      if (rule.freq === 'none') {
        const { data, error } = await supabase.from('activities').insert({ ...base, start_date: start, end_date: end, activity_date: start }).select('id').single()
        if (error) throw error
        onToast(`Event "${name.trim()}" created.`)
        onCreated(data?.id)
      } else {
        // One INDEPENDENT activities row per occurrence, grouped by series_id.
        const spanDays = Math.round((Date.parse(end) - Date.parse(start)) / 86400000)
        const starts = generateOccurrences(start, rule)
        const seriesId = crypto.randomUUID()
        const ruleStr = JSON.stringify(rule)
        const rows = starts.map((s) => ({ ...base, activity_date: s, start_date: s, end_date: addDaysISO(s, spanDays), series_id: seriesId, recurrence_rule: ruleStr }))
        const { data, error } = await supabase.from('activities').insert(rows).select('id')
        if (error) throw error
        onToast(`Created ${rows.length} occurrences of "${name.trim()}".`)
        onCreated(data?.[0]?.id)
      }
    } catch (e) {
      onToast('Could not create: ' + (e.message || e))
    } finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} title="Create event">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div><span style={label}>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Guru Purnima Setup" style={inputStyle} autoFocus /></div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}><span style={label}>Start date</span><input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value) }} style={inputStyle} /></div>
          <div style={{ flex: 1 }}><span style={label}>End date</span><input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} style={inputStyle} /></div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}><span style={label}>Centre</span><select value={centre} onChange={(e) => setCentre(e.target.value)} style={selStyle}>{centres.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}</select></div>
          <div style={{ flex: 1 }}><span style={label}>Type (optional)</span><select value={typeId} onChange={(e) => setTypeId(e.target.value)} style={selStyle}><option value="">—</option>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
        </div>
        <div><span style={label}>Description (optional)</span><textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} /></div>
        <div><span style={label}>Repeats</span><RecurrenceFields value={recur} onChange={setRecur} /></div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Creating…' : toRule(recur).freq === 'none' ? 'Create event' : 'Create series'}</button>
        </div>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------- Event planning detail
function PlanningEvent({ ev, stageRow, me, isCoordinator, onBack, onToast, onEventChanged }) {
  const [blocks, setBlocks] = useState(null)
  const [assignments, setAssignments] = useState([]) // all assignments across blocks
  const [acceptances, setAcceptances] = useState([])
  const [people, setPeople] = useState({}) // person_id -> {full_name, phone}
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [err, setErr] = useState(null)

  const days = eventDays(ev.start_date, ev.end_date)
  const stage = effectiveStage(ev, stageRow)

  const load = useCallback(async () => {
    setErr(null)
    const { data: bl, error } = await supabase.from('activity_blocks').select('*').eq('activity_id', ev.id).order('created_at')
    if (error) { setErr(error.message); setBlocks([]); return }
    setBlocks(bl || [])
    const ids = (bl || []).map((b) => b.id)
    if (ids.length) {
      const [asg, acc] = await Promise.all([
        supabase.from('block_assignments').select('*').in('block_id', ids),
        supabase.from('block_acceptances').select('*').in('block_id', ids),
      ])
      const asgRows = asg.data || []
      const accRows = acc.data || []
      setAssignments(asgRows)
      setAcceptances(accRows)
      const pids = [...new Set([...asgRows.map((r) => r.person_id), ...accRows.map((r) => r.person_id)])]
      if (pids.length) {
        const { data: pp } = await supabase.from('people').select('id, full_name, phone').in('id', pids)
        setPeople(Object.fromEntries((pp || []).map((p) => [p.id, p])))
      }
    } else { setAssignments([]); setAcceptances([]) }
  }, [ev.id])
  useEffect(() => { load() }, [load])

  async function setStage(newStage) {
    // Manual override wins over the date-derived stage.
    const { error } = await supabase.from('event_stages').upsert(
      { activity_id: ev.id, stage: newStage, manual: true, updated_by: me?.id || null, updated_at: new Date().toISOString() },
      { onConflict: 'activity_id' })
    if (error) return onToast('Could not set stage: ' + error.message)
    onToast(`Stage → ${newStage}.`)
    onEventChanged()
  }
  async function autoStage() {
    const { error } = await supabase.from('event_stages').upsert(
      { activity_id: ev.id, stage: deriveStage(ev.start_date, ev.end_date), manual: false, updated_by: me?.id || null, updated_at: new Date().toISOString() },
      { onConflict: 'activity_id' })
    if (error) return onToast('Could not reset: ' + error.message)
    onToast('Stage now follows the dates.')
    onEventChanged()
  }

  return (
    <Pad>
      <div onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: 'var(--orange)', cursor: 'pointer', marginBottom: 16 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
        Calendar
      </div>

      <div className="card" style={{ padding: 22, marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 21, fontWeight: 600, margin: '0 0 3px' }}>{ev.name}</h2>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{rangeLabel(ev.start_date, ev.end_date)} · {days.length} day{days.length !== 1 ? 's' : ''} · {ev.center_id}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="pill" style={{ background: (STAGE_TONE[stage] || STAGE_TONE.Planning).bg, color: (STAGE_TONE[stage] || STAGE_TONE.Planning).fg }}>{stage}{stageRow?.manual ? '' : ' · auto'}</span>
            {isCoordinator && (
              <select value={stage} onChange={(e) => setStage(e.target.value)} style={{ ...selStyle, width: 'auto', padding: '7px 9px', fontSize: 12.5 }}>
                {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            {isCoordinator && stageRow?.manual && <button className="btn btn-ghost" style={{ padding: '7px 10px', fontSize: 12 }} onClick={autoStage}>Follow dates</button>}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Activity blocks</div>
        {isCoordinator && <button className="btn btn-primary" style={{ padding: '8px 14px', fontSize: 12.5 }} onClick={() => setAdding(true)}>＋ Add block</button>}
      </div>

      {err && <ErrorCard>{err}</ErrorCard>}
      {!blocks ? <Loading label="Loading blocks…" /> : blocks.length === 0 ? (
        <Empty label="No activity blocks yet — add one (e.g. Kitchen, Setup, Car)." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {blocks.map((b) => (
            <BlockCard key={b.id} block={b} days={days} isCoordinator={isCoordinator} me={me}
              assignments={assignments.filter((a) => a.block_id === b.id)}
              acceptances={acceptances.filter((a) => a.block_id === b.id)}
              people={people} eventName={ev.name} onToast={onToast} onChanged={load} onEdit={() => setEditing(b)} />
          ))}
        </div>
      )}

      {(adding || editing) && (
        <AddBlockForm activityId={ev.id} block={editing} me={me}
          onClose={() => { setAdding(false); setEditing(null) }}
          onToast={onToast} onAdded={() => { setAdding(false); setEditing(null); load() }} />
      )}
    </Pad>
  )
}

function AddBlockForm({ activityId, block, me, onClose, onToast, onAdded }) {
  const editing = !!block
  const [heading, setHeading] = useState(block?.heading || '')
  const [desc, setDesc] = useState(block?.description || '')
  const [needed, setNeeded] = useState(block?.volunteers_needed ?? 4)
  const [method, setMethod] = useState(block?.recruiting_method || 'manual')
  const [start, setStart] = useState(block?.start_time?.slice(0, 5) || '')
  const [end, setEnd] = useState(block?.end_time?.slice(0, 5) || '')
  const [typeId, setTypeId] = useState(block?.activity_type_id || '')
  const [types, setTypes] = useState([])
  const [newType, setNewType] = useState('')
  const [busy, setBusy] = useState(false)

  const reloadTypes = useCallback(() => fetchActivityTypes().then((all) => setTypes((all || []).filter((t) => t.kind === 'volunteer'))), [])
  useEffect(() => { reloadTypes() }, [reloadTypes])

  async function createType() {
    const lbl = newType.trim()
    if (!lbl) return
    const maxSort = Math.max(0, ...types.map((t) => t.sort_order || 0))
    const { data, error } = await supabase.from('activity_types').insert({ label: lbl, kind: 'volunteer', active: true, sort_order: maxSort + 1 }).select('id, label').single()
    if (error) return onToast(error.message?.includes('duplicate') ? 'That type already exists.' : 'Could not add type: ' + error.message)
    setNewType('')
    await reloadTypes()
    setTypeId(data.id)
    onToast(`Activity type "${lbl}" added (now reusable for future events).`)
  }

  async function save() {
    if (!heading.trim()) return onToast('Block needs a heading.')
    setBusy(true)
    try {
      const payload = {
        activity_type_id: typeId || null, heading: heading.trim(), description: desc.trim() || null,
        volunteers_needed: Number(needed) || 0, start_time: start || null, end_time: end || null, recruiting_method: method,
      }
      const { error } = editing
        ? await supabase.from('activity_blocks').update(payload).eq('id', block.id)
        : await supabase.from('activity_blocks').insert({ ...payload, activity_id: activityId, created_by: me?.id || null })
      if (error) throw error
      onToast(`Block "${heading.trim()}" ${editing ? 'updated' : 'added'}.`)
      onAdded()
    } catch (e) {
      onToast(`Could not ${editing ? 'update' : 'add'} block: ` + (e.message || e))
    } finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} title={editing ? 'Edit activity block' : 'Add activity block'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div><span style={label}>Heading</span><input value={heading} onChange={(e) => setHeading(e.target.value)} placeholder="e.g. Kitchen Coordination" style={inputStyle} autoFocus /></div>
        <div>
          <span style={label}>Activity type (suggested from the shared list)</span>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} style={selStyle}>
            <option value="">— none —</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="…or create a new type" style={{ ...inputStyle, fontSize: 12 }} />
            <button className="btn btn-ghost" style={{ padding: '6px 11px', fontSize: 12, whiteSpace: 'nowrap' }} onClick={createType}>Add type</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ width: 120 }}><span style={label}>Needed / day</span><input type="number" min={0} value={needed} onChange={(e) => setNeeded(e.target.value)} style={inputStyle} /></div>
          <div style={{ flex: 1 }}><span style={label}>Recruiting</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)} style={selStyle}>
              <option value="manual">Manual — pick from Volunteers</option>
              <option value="broadcast">Broadcast — WhatsApp tap-to-accept</option>
              <option value="form">Form — controlled intake</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}><span style={label}>Start time (optional)</span><input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={inputStyle} /></div>
          <div style={{ flex: 1 }}><span style={label}>End time (optional)</span><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={inputStyle} /></div>
        </div>
        <div><span style={label}>Description (optional)</span><textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} /></div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : editing ? 'Save' : 'Add block'}</button>
        </div>
      </div>
    </Modal>
  )
}

const METHOD_LABEL = { manual: 'Manual pick', broadcast: 'Broadcast', form: 'Form' }

function BlockCard({ block, days, isCoordinator, me, assignments, acceptances, people, eventName, onToast, onChanged, onEdit }) {
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(null) // day being assigned
  const [broadcast, setBroadcast] = useState(false)
  const [recording, setRecording] = useState(false)

  // Destructive: deleting a block removes its assignments + acceptances (FK cascade).
  // Warn with counts per the standing destructive-action guard.
  async function del() {
    const msg = (assignments.length || acceptances.length)
      ? `Delete "${block.heading}"? ${assignments.length} assignment(s) and ${acceptances.length} acceptance(s) will be removed. This cannot be undone.`
      : `Delete "${block.heading}"?`
    if (!window.confirm(msg)) return
    const { error } = await supabase.from('activity_blocks').delete().eq('id', block.id)
    if (error) return onToast('Could not delete: ' + error.message)
    onToast(`Block "${block.heading}" deleted.`)
    onChanged()
  }

  const needed = block.volunteers_needed
  const dayFill = days.map((d) => ({ day: d, filled: fillCount(assignments, d), needed }))
  const shortfall = dayFill.some((d) => d.filled < d.needed)

  // Backfill a day from the acceptance pool (accepted that day, not yet assigned).
  async function backfill(day) {
    const assignedIds = new Set(assignments.filter((a) => a.day_date === day && a.status !== 'no_show' && a.status !== 'dropped').map((a) => a.person_id))
    const pool = acceptances.filter((ac) => (ac.day_dates || []).includes(day) && !assignedIds.has(ac.person_id))
    if (!pool.length) return onToast('No one in the backfill pool for this day.')
    const pick = pool[0]
    const { error } = await supabase.from('block_assignments').insert({ block_id: block.id, person_id: pick.person_id, day_date: day, status: 'assigned', is_backfill: true, assigned_by: me?.id || null })
    if (error) return onToast(error.message?.includes('duplicate') ? 'Already assigned that day.' : 'Could not backfill: ' + error.message)
    onToast(`${people[pick.person_id]?.full_name || 'Volunteer'} backfilled into ${fmtDay(day)}.`)
    onChanged()
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', flexWrap: 'wrap' }} onClick={() => setOpen((o) => !o)}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{block.heading}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {needed}/day · {METHOD_LABEL[block.recruiting_method]}{block.start_time ? ` · ${block.start_time.slice(0, 5)}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {dayFill.map((d) => (
            <span key={d.day} title={fmtDay(d.day)} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: d.filled >= d.needed ? '#EAF2E5' : '#FBEAD9', color: d.filled >= d.needed ? '#4E7C3F' : '#C2691F' }}>
              {days.length > 1 ? `${fmtDay(d.day).split(' ')[0]} ` : ''}{d.filled}/{d.needed}
            </span>
          ))}
        </div>
        <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '14px 18px', background: 'var(--panel)' }}>
          {block.description && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 12 }}>{block.description}</div>}
          {isCoordinator && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {block.recruiting_method === 'broadcast' && <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setBroadcast(true)}>Compose broadcast</button>}
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setRecording(true)}>Record reply</button>
              <span style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>Pool: {acceptances.length} accepted</span>
              <button className="btn btn-ghost" style={{ fontSize: 12, marginLeft: 'auto' }} onClick={() => onEdit && onEdit()}>Edit</button>
              <button onClick={del} style={{ fontSize: 12, fontWeight: 600, padding: '7px 11px', borderRadius: 8, border: '1px solid #E7C9B8', background: '#fff', color: '#B5532F', cursor: 'pointer' }}>Delete</button>
            </div>
          )}
          {acceptances.length > 0 && (
            <div style={{ marginBottom: 14, background: '#fff', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 12px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', marginBottom: 5 }}>Pool — accepted, available to assign / backfill</div>
              {acceptances.map((ac) => (
                <div key={ac.id} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '2px 0' }}>
                  <span style={{ fontWeight: 600 }}>{people[ac.person_id]?.full_name || 'Unknown'}</span>
                  <span style={{ color: 'var(--muted)' }}>{(ac.day_dates || []).map(fmtDay).join(', ')}</span>
                </div>
              ))}
            </div>
          )}

          {days.map((day) => {
            const dayAsg = assignments.filter((a) => a.day_date === day)
            const active = dayAsg.filter((a) => a.status === 'assigned' || a.status === 'show')
            const openSlots = Math.max(0, needed - active.length)
            const poolCount = acceptances.filter((ac) => (ac.day_dates || []).includes(day) && !active.some((a) => a.person_id === ac.person_id)).length
            return (
              <div key={day} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>{fmtDay(day)}</div>
                  <span style={{ fontSize: 11, color: active.length >= needed ? '#4E7C3F' : '#C2691F', fontWeight: 600 }}>{active.length}/{needed}</span>
                  {isCoordinator && openSlots > 0 && <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 11.5 }} onClick={() => setPicking(day)}>＋ Assign</button>}
                  {isCoordinator && openSlots > 0 && poolCount > 0 && <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 11.5 }} onClick={() => backfill(day)}>Backfill ({poolCount})</button>}
                </div>
                {dayAsg.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>No one assigned.</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {dayAsg.map((a) => (
                    <AssignmentRow key={a.id} a={a} person={people[a.person_id]} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {picking && <AssignPicker block={block} day={picking} me={me} assignments={assignments} onClose={() => setPicking(null)} onToast={onToast} onDone={() => { setPicking(null); onChanged() }} />}
      {broadcast && <BroadcastComposer block={block} days={days} eventName={eventName} onClose={() => setBroadcast(false)} />}
      {recording && <RecordAcceptanceDialog block={block} days={days} onClose={() => setRecording(false)} onToast={onToast} onDone={() => { setRecording(false); onChanged() }} />}
    </div>
  )
}

// Read-only on Planning — show/no-show is MARKED on the Attendance page. Status
// here reflects whatever was marked there (and drives fill/backfill).
function AssignmentRow({ a, person }) {
  const STATUS = { assigned: { t: 'assigned', c: 'var(--muted)' }, show: { t: 'showed', c: '#4E7C3F' }, no_show: { t: 'no-show', c: '#B5532F' }, dropped: { t: 'dropped', c: '#9C4A14' } }
  const s = STATUS[a.status] || STATUS.assigned
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: '#fff', border: '1px solid var(--border)', borderRadius: 9, padding: '7px 10px' }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {person?.full_name || 'Unknown'}{a.is_backfill && <span style={{ fontSize: 10, color: 'var(--muted-2)', marginLeft: 6 }}>backfill</span>}
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: s.c }}>{s.t}</span>
    </div>
  )
}

// Manual pick from Volunteers, ordered for targeting: interested first, then
// done_count (specialists), then reliability. Choice stays open — any volunteer.
function AssignPicker({ block, day, me, assignments, onClose, onToast, onDone }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const alreadyDay = new Set(assignments.filter((a) => a.day_date === day && a.status !== 'no_show' && a.status !== 'dropped').map((a) => a.person_id))

  useEffect(() => {
    let alive = true
    const t = setTimeout(async () => {
      let query = supabase.from('people').select('id, full_name, phone, pincode').eq('is_volunteer', true).limit(40)
      if (q.trim()) query = query.or(`full_name.ilike.%${q.trim()}%,phone.ilike.%${q.trim()}%`)
      const { data } = await query
      if (!alive) return
      const ppl = data || []
      const ids = ppl.map((p) => p.id)
      const [rel, stats, intr] = await Promise.all([
        ids.length ? supabase.from('volunteer_reliability').select('person_id, reliability_pct').in('person_id', ids) : { data: [] },
        block.activity_type_id && ids.length ? supabase.from('volunteer_activity_stats').select('person_id, done_count').eq('activity_type_id', block.activity_type_id).in('person_id', ids) : { data: [] },
        block.activity_type_id && ids.length ? supabase.from('volunteer_activity_interest').select('person_id').eq('activity_type_id', block.activity_type_id).in('person_id', ids) : { data: [] },
      ])
      const relMap = Object.fromEntries((rel.data || []).map((r) => [r.person_id, r.reliability_pct]))
      const doneMap = Object.fromEntries((stats.data || []).map((r) => [r.person_id, r.done_count]))
      const intrSet = new Set((intr.data || []).map((r) => r.person_id))
      const enriched = ppl.map((p) => ({ ...p, reliability: relMap[p.id], done: doneMap[p.id] || 0, interested: intrSet.has(p.id) }))
      enriched.sort((a, b) => (b.interested - a.interested) || (b.done - a.done) || ((b.reliability ?? -1) - (a.reliability ?? -1)))
      setRows(enriched)
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [q, block.activity_type_id])

  async function assign(p) {
    setBusy(true)
    try {
      const { error } = await supabase.from('block_assignments').insert({ block_id: block.id, person_id: p.id, day_date: day, status: 'assigned', assigned_by: me?.id || null })
      if (error) throw error
      onToast(`${p.full_name} assigned to ${fmtDay(day)}.`)
      onDone()
    } catch (e) {
      onToast(e.message?.includes('duplicate') ? 'Already assigned that day.' : 'Could not assign: ' + (e.message || e))
    } finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} title={`Assign · ${block.heading} · ${fmtDay(day)}`}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search volunteers by name or phone…" style={{ ...inputStyle, marginBottom: 10 }} autoFocus />
      <div style={{ fontSize: 11, color: 'var(--muted-2)', marginBottom: 8 }}>Ordered: interested → done this activity → reliability. Any volunteer can be picked.</div>
      {!rows ? <Loading label="Loading…" /> : rows.length === 0 ? <Empty label="No volunteers match." /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }} className="scrollarea">
          {rows.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--border)', borderRadius: 9, padding: '8px 11px' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(p.full_name || '?')}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.full_name || 'Unknown'}
                  {p.interested && <span className="pill" style={{ background: '#EAF2E5', color: '#4E7C3F', marginLeft: 6, fontSize: 10 }}>interested</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {p.reliability != null ? `${p.reliability}% reliable` : 'no history'} · done {p.done}×{p.pincode ? ` · ${p.pincode}` : ''}
                </div>
              </div>
              {alreadyDay.has(p.id) ? <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>assigned</span> : (
                <button className="btn btn-primary" disabled={busy} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => assign(p)}>Assign</button>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

// Broadcast: a shareable WhatsApp message listing this block as a tap-to-accept
// option. The accepter replies / a coordinator records it into the pool. (A fully
// public auto-landing endpoint is a separate surface; this drives the outreach.)
function BroadcastComposer({ block, days, eventName, onClose }) {
  const acceptUrl = `${window.location.origin}${window.location.pathname}#accept=${block.id}`
  const text = `🙏 Namaskaram! Volunteers needed for *${block.heading}* at ${eventName} (${block.volunteers_needed}/day).\n\n${days.map((d) => `• ${fmtDay(d)}`).join('\n')}\n\n👉 Tap to accept & choose your days:\n${acceptUrl}`
  return (
    <Modal onClose={onClose} title="Broadcast — tap to accept">
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>Share this on your volunteer WhatsApp group. The link opens a no-login page where they pick days — replies land as typed acceptances in this block's pool.</div>
      <textarea readOnly value={text} rows={8} style={{ ...inputStyle, resize: 'vertical', marginBottom: 10 }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn btn-ghost" onClick={() => { navigator.clipboard?.writeText(text) }}>Copy</button>
        <a className="btn btn-primary" href={waHref('', text)} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Open WhatsApp</a>
      </div>
    </Modal>
  )
}

// Coordinator records a reply (e.g. a WhatsApp message) into the block's pool as a
// typed acceptance. Resolves to an existing person by name/phone.
function RecordAcceptanceDialog({ block, days, onClose, onToast, onDone }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const [sel, setSel] = useState(null)
  const [pickDays, setPickDays] = useState(days)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    const t = setTimeout(async () => {
      let query = supabase.from('people').select('id, full_name, phone, pincode').limit(30)
      if (q.trim()) query = query.or(`full_name.ilike.%${q.trim()}%,phone.ilike.%${q.trim()}%`)
      else query = query.eq('is_volunteer', true)
      const { data } = await query
      if (alive) setRows(data || [])
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [q])

  const toggle = (d) => setPickDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d]))

  async function save() {
    if (!sel) return onToast('Pick a person.')
    if (!pickDays.length) return onToast('Pick at least one day.')
    setBusy(true)
    try {
      const { error } = await supabase.from('block_acceptances').upsert(
        { block_id: block.id, person_id: sel.id, day_dates: pickDays, method: 'manual' }, { onConflict: 'block_id,person_id' })
      if (error) throw error
      onToast(`${sel.full_name} added to the pool.`)
      onDone()
    } catch (e) {
      onToast('Could not record: ' + (e.message || e))
    } finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} title={`Record reply · ${block.heading}`}>
      {!sel ? (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or phone…" style={{ ...inputStyle, marginBottom: 10 }} autoFocus />
          {!rows ? <Loading label="Loading…" /> : rows.length === 0 ? <Empty label="No match." /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }} className="scrollarea">
              {rows.map((p, i) => (
                <div key={p.id} onClick={() => setSel(p)} className="rowhover" style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--border)', borderRadius: 9, padding: '8px 11px', cursor: 'pointer' }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 600 }}>{initials(p.full_name || '?')}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{p.full_name || 'Unknown'}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{p.phone || 'no phone'}{p.pincode ? ` · ${p.pincode}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ fontSize: 13.5, marginBottom: 12 }}>Recording <strong>{sel.full_name}</strong> — which days?</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {days.map((d) => (
              <label key={d} style={{ display: 'flex', alignItems: 'center', gap: 7, border: `1px solid ${pickDays.includes(d) ? 'var(--orange)' : 'var(--border)'}`, background: pickDays.includes(d) ? '#FBF1E6' : '#fff', borderRadius: 8, padding: '7px 11px', cursor: 'pointer' }}>
                <input type="checkbox" checked={pickDays.includes(d)} onChange={() => toggle(d)} />
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{fmtDay(d)}</span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => setSel(null)}>‹ Back</button>
            <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Add to pool'}</button>
          </div>
        </>
      )}
    </Modal>
  )
}

// -------------------------------------------------------------------- shared modal
function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, zIndex: 120, overflowY: 'auto' }} onClick={onClose}>
      <div className="card" style={{ maxWidth: 540, width: '100%', marginTop: 40, padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>{title}</h3>
          <div onClick={onClose} style={{ fontSize: 13, fontWeight: 600, color: 'var(--orange)', cursor: 'pointer' }}>✕ Close</div>
        </div>
        {children}
      </div>
    </div>
  )
}
