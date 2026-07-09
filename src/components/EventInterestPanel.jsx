import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pill, initials, avatarFor } from '../lib/ui'
import { Loading, Empty } from './View'
import SidePanel, { PanelHeader } from './SidePanel'
import { eventDays, fmtDay } from '../lib/planning'

// Event-interest status state machine (all reversible; Contacted is optional, so
// Interested → Approved is a single step). Stored values are snake_case; labels below.
// Colors per spec: Interested=grey, Contacted=yellow, Approved=green, Declined=red, No Response=orange.
export const EI_STATUS = [
  { v: 'interested', label: 'Interested', pill: pill('#F1EADD', '#8C7E6B') },
  { v: 'contacted', label: 'Contacted', pill: pill('#FCF4CB', '#8A6D1B') },
  { v: 'approved', label: 'Approved', pill: pill('#EAF2E5', '#4E7C3F') },
  { v: 'declined', label: 'Declined', pill: pill('#FBE6E0', '#B5532F') },
  { v: 'no_response', label: 'No Response', pill: pill('#FBEAD9', '#C2691F') },
]
export const EI_STATUS_MAP = Object.fromEntries(EI_STATUS.map((s) => [s.v, s]))

const ago = (d) => {
  if (!d) return '—'
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

// Contextual actions per current status (the pipeline). Each entry moves the record
// to `to`; the patch (who/when stamps) is computed in changeStatus below.
function actionsFor(status, contactedAt) {
  const s = status || 'interested'
  if (s === 'interested') return [{ label: 'Mark Contacted', to: 'contacted' }, { label: 'Approve', to: 'approved', primary: true }]
  if (s === 'contacted') return [{ label: 'Approve', to: 'approved', primary: true }, { label: 'Declined', to: 'declined' }, { label: 'No Response', to: 'no_response' }]
  if (s === 'approved') return [{ label: 'Undo', to: contactedAt ? 'contacted' : 'interested' }]
  if (s === 'declined' || s === 'no_response') return [{ label: 'Re-contact', to: 'contacted' }]
  return []
}

// Shared Event-Interest list. Two modes:
//  - lockEventId set → single event, no event filter pill row (Event Hub tab).
//  - lockEventId null → all events with an "Event" pill row; scopeEventId presets it.
export default function EventInterestPanel({ uid, lockEventId = null, scopeEventId = null, onScopeConsumed, reloadKey = 0, onToast, isCoordinator = true }) {
  const [rows, setRows] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [evFilter, setEvFilter] = useState('all')
  const [availFilter, setAvailFilter] = useState('all')
  const [selected, setSelected] = useState(null) // the row open in the detail panel

  const load = useCallback(async () => {
    let q = supabase.from('event_interest')
      .select('id, created_at, status, contacted_at, approved_at, availability_dates, note, activity:activities!event_interest_activity_id_fkey(id, name, activity_date, start_date, end_date), person:people!event_interest_person_id_fkey(id, full_name, phone, email)')
      .order('created_at', { ascending: false })
    if (lockEventId) q = q.eq('activity_id', lockEventId)
    const { data } = await q
    setRows(data || [])
  }, [lockEventId])
  useEffect(() => { load() }, [load, reloadKey])

  // Preset the event filter to the event we arrived from (Interest Inbox from a hub).
  useEffect(() => {
    if (scopeEventId && !lockEventId) { setEvFilter(scopeEventId); onScopeConsumed?.() }
  }, [scopeEventId, lockEventId, onScopeConsumed])

  const patchRow = (id, fields) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...fields } : r)))
    setSelected((s) => (s && s.id === id ? { ...s, ...fields } : s))
  }

  async function changeStatus(r, to) {
    const patch = { status: to }
    if (to === 'contacted') { patch.contacted_at = new Date().toISOString(); patch.contacted_by = uid || null; patch.approved_at = null; patch.approved_by = null }
    else if (to === 'approved') { patch.approved_at = new Date().toISOString(); patch.approved_by = uid || null }
    else if (to === 'interested') { patch.contacted_at = null; patch.contacted_by = null; patch.approved_at = null; patch.approved_by = null }
    // declined / no_response: status only
    try {
      const { error } = await supabase.from('event_interest').update(patch).eq('id', r.id)
      if (error) throw error
      patchRow(r.id, patch)
      onToast?.(`${r.person?.full_name || 'Interest'} → ${EI_STATUS_MAP[to]?.label || to}.`)
    } catch (e) { onToast?.('Could not update status: ' + (e.message || e)) }
  }

  async function saveAvailability(r, dates) {
    try {
      const { error } = await supabase.from('event_interest').update({ availability_dates: dates }).eq('id', r.id)
      if (error) throw error
      patchRow(r.id, { availability_dates: dates })
    } catch (e) { onToast?.('Could not save availability: ' + (e.message || e)) }
  }

  async function saveNote(r, note) {
    try {
      const { error } = await supabase.from('event_interest').update({ note }).eq('id', r.id)
      if (error) throw error
      patchRow(r.id, { note })
      onToast?.('Comment saved.')
    } catch (e) { onToast?.('Could not save comment: ' + (e.message || e)) }
  }

  if (!rows) return <Loading label="Loading event interests…" />

  // Every event that has at least one interest record — the Event pill row + the
  // per-record day-list lookup (each record's availability is scoped to its own event).
  const events = [...new Map(rows.map((r) => [r.activity?.id, r.activity])).values()].filter(Boolean)
  const daysByEvent = Object.fromEntries(events.map((e) => [e.id, eventDays(e.start_date || e.activity_date, e.end_date)]))
  const maxDays = Math.max(1, ...events.map((e) => (daysByEvent[e.id] || []).length))

  const matchesAvail = (r) => {
    if (availFilter === 'all') return true
    const days = daysByEvent[r.activity?.id] || []
    const avail = r.availability_dates || []
    if (availFilter === 'all_days') return days.length > 0 && days.every((d) => avail.includes(d))
    const idx = Number(availFilter.slice(3)) - 1 // 'day2' -> 1
    const d = days[idx]
    return d ? avail.includes(d) : false
  }

  // AND filters: status, then event, then availability.
  const statusScoped = statusFilter === 'all' ? rows : rows.filter((r) => (r.status || 'interested') === statusFilter)
  const evScoped = (lockEventId || evFilter === 'all') ? statusScoped : statusScoped.filter((r) => r.activity?.id === evFilter)
  const shown = evScoped.filter(matchesAvail)

  const statusCounts = rows.reduce((m, r) => { const s = r.status || 'interested'; m[s] = (m[s] || 0) + 1; return m }, {})

  const filterChip = (on) => ({ fontSize: 12, fontWeight: 600, padding: '6px 11px', borderRadius: 20, cursor: 'pointer', border: on ? 'none' : '1px solid var(--border)', background: on ? '#241B14' : '#fff', color: on ? '#F6ECDC' : 'var(--ink-soft)', whiteSpace: 'nowrap', flexShrink: 0 })
  const pillRow = { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }

  return (
    <>
      {/* Status pills */}
      <div className="scroll-tabs" style={pillRow}>
        <button className="tap44" onClick={() => setStatusFilter('all')} style={filterChip(statusFilter === 'all')}>All <span style={{ opacity: 0.6 }}>{rows.length}</span></button>
        {EI_STATUS.map((s) => (
          <button key={s.v} className="tap44" onClick={() => setStatusFilter(s.v)} style={filterChip(statusFilter === s.v)}>{s.label} <span style={{ opacity: 0.6 }}>{statusCounts[s.v] || 0}</span></button>
        ))}
      </div>

      {/* Event pills — one per event that has interest records (skipped when locked to a single event). */}
      {!lockEventId && events.length > 0 && (
        <div className="scroll-tabs" style={pillRow}>
          <button className="tap44" onClick={() => setEvFilter('all')} style={filterChip(evFilter === 'all')}>All Events</button>
          {events.map((e) => (
            <button key={e.id} className="tap44" onClick={() => setEvFilter(e.id)} style={filterChip(evFilter === e.id)}>{e.name}</button>
          ))}
        </div>
      )}

      {/* Availability pills */}
      <div className="scroll-tabs" style={{ ...pillRow, marginBottom: 12 }}>
        <button className="tap44" onClick={() => setAvailFilter('all')} style={filterChip(availFilter === 'all')}>All</button>
        {Array.from({ length: maxDays }, (_, i) => `day${i + 1}`).map((k, i) => (
          <button key={k} className="tap44" onClick={() => setAvailFilter(k)} style={filterChip(availFilter === k)}>Day {i + 1}</button>
        ))}
        <button className="tap44" onClick={() => setAvailFilter('all_days')} style={filterChip(availFilter === 'all_days')}>All Days</button>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        {shown.length === 0 ? (
          <Empty label="No interests match these filters." />
        ) : shown.map((r, i) => (
          <InterestListRow key={r.id} r={r} i={i} onOpen={() => setSelected(r)} />
        ))}
      </div>

      {selected && (
        <InterestDetail r={selected} isCoordinator={isCoordinator} days={daysByEvent[selected.activity?.id] || []}
          onClose={() => setSelected(null)} onAction={(to) => changeStatus(selected, to)}
          onAvailability={(d) => saveAvailability(selected, d)} onSaveNote={(n) => saveNote(selected, n)} />
      )}
    </>
  )
}

// List row — name, phone, status badge. Nothing else. Tap opens the detail panel.
function InterestListRow({ r, i, onOpen }) {
  const status = r.status || 'interested'
  return (
    <div className="rowhover tap44" onClick={onOpen} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '1px solid #F1E9DB', cursor: 'pointer' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(r.person?.full_name || '?')}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.person?.full_name || 'Unknown'}</div>
        <div style={{ fontSize: 11.5, color: r.person?.phone ? 'var(--muted)' : '#B5532F' }}>{r.person?.phone || 'no phone'}</div>
      </div>
      <span className="pill" style={{ ...EI_STATUS_MAP[status]?.pill, flexShrink: 0 }}>{EI_STATUS_MAP[status]?.label}</span>
    </div>
  )
}

// Detail panel — full record: contact info, event, status actions, availability
// multi-select, comments. Every status change and edit happens here, not on the row.
function InterestDetail({ r, isCoordinator, days, onClose, onAction, onAvailability, onSaveNote }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(r.note || '')
  const status = r.status || 'interested'
  const avail = r.availability_dates || []
  const allSelected = days.length > 0 && days.every((d) => avail.includes(d))
  const toggleDay = (d) => onAvailability(avail.includes(d) ? avail.filter((x) => x !== d) : [...avail, d].sort())
  const toggleAll = () => onAvailability(allSelected ? [] : [...days])
  const chip = (on) => ({ fontSize: 12, fontWeight: 600, padding: '6px 11px', borderRadius: 8, cursor: 'pointer', border: on ? '1px solid #C2691F' : '1px solid var(--border)', background: on ? '#F6E8D8' : '#fff', color: on ? '#C2691F' : 'var(--muted)' })
  const actions = isCoordinator ? actionsFor(status, r.contacted_at) : []

  async function run(to) { setBusy(true); try { await onAction(to) } finally { setBusy(false) } }

  return (
    <SidePanel onClose={onClose} width={480}>
      <PanelHeader onClose={onClose}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 46, height: 46, borderRadius: '50%', background: avatarFor(1), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 600 }}>{initials(r.person?.full_name || '?')}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 19, fontWeight: 600, margin: '0 0 3px' }}>{r.person?.full_name || 'Unknown'}</h2>
            <span className="pill" style={EI_STATUS_MAP[status]?.pill}>{EI_STATUS_MAP[status]?.label}</span>
          </div>
        </div>
      </PanelHeader>

      <div style={{ padding: '20px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card" style={{ padding: 18 }}>
          <SecH>Contact &amp; event</SecH>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px' }}>
            <F label="Phone" value={r.person?.phone || 'No phone on record'} />
            <F label="Email" value={r.person?.email || '—'} />
            <div style={{ gridColumn: '1 / -1' }}><F label="Event" value={`${r.activity?.name || 'Unknown event'} · ${fmtDate(r.activity?.activity_date)}`} /></div>
            <F label="Interested since" value={fmtDate(r.created_at)} />
            {r.contacted_at && <F label="Contacted" value={`${fmtDate(r.contacted_at)} · ${ago(r.contacted_at)}`} />}
            {r.approved_at && <F label="Approved" value={`${fmtDate(r.approved_at)} · ${ago(r.approved_at)}`} />}
          </div>
        </div>

        {isCoordinator && actions.length > 0 && (
          <div className="card" style={{ padding: 18 }}>
            <SecH>Status</SecH>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {actions.map((a) => (
                <button key={a.to + a.label} disabled={busy} onClick={() => run(a.to)}
                  style={{ fontSize: 13, fontWeight: 600, padding: '9px 15px', borderRadius: 9, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
                    border: a.primary ? 'none' : '1px solid var(--border)', background: a.primary ? 'linear-gradient(150deg, var(--orange-2), var(--orange-3))' : '#fff', color: a.primary ? '#fff' : 'var(--ink-soft)' }}>{a.label}</button>
              ))}
            </div>
          </div>
        )}

        {days.length > 0 && (
          <div className="card" style={{ padding: 18 }}>
            <SecH>Availability</SecH>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {isCoordinator ? (
                <>
                  {days.length > 1 && <button onClick={toggleAll} style={chip(allSelected)}>All Days</button>}
                  {days.map((d, di) => (
                    <button key={d} onClick={() => toggleDay(d)} style={chip(avail.includes(d))}>Day {di + 1} · {fmtDay(d)}</button>
                  ))}
                </>
              ) : (
                avail.length ? avail.map((d) => <span key={d} className="pill" style={pill('#F6E8D8', '#C2691F')}>Day {days.indexOf(d) + 1} · {fmtDay(d)}</span>)
                  : <span style={{ fontSize: 12.5, color: 'var(--muted-2)' }}>Not set</span>
              )}
            </div>
          </div>
        )}

        <div className="card" style={{ padding: 18 }}>
          <SecH>Comments</SecH>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="Notes on availability, preferences, etc…"
            style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', background: '#fff', color: 'var(--ink)', outline: 'none', resize: 'vertical' }} />
          {isCoordinator && (
            <button className="btn btn-ghost" style={{ marginTop: 10, fontSize: 12.5 }} disabled={note === (r.note || '')} onClick={() => onSaveNote(note)}>Save comment</button>
          )}
        </div>
      </div>
    </SidePanel>
  )
}

function F({ label, value }) {
  return (<div><div style={{ fontSize: 10.5, color: 'var(--muted-2)', marginBottom: 4 }}>{label}</div><div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', wordBreak: 'break-word' }}>{value}</div></div>)
}
function SecH({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted-2)', marginBottom: 12 }}>{children}</div>
}
