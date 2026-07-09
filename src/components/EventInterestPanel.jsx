import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pill, initials, avatarFor } from '../lib/ui'
import { Loading, Empty } from './View'
import { eventDays, fmtDay } from '../lib/planning'

// Event-interest status state machine (all reversible; Contacted is optional, so
// Interested → Approved is a single step). Stored values are snake_case; labels below.
export const EI_STATUS = [
  { v: 'interested', label: 'Interested', pill: pill('#E9F0EF', '#2F6E5E') },
  { v: 'contacted', label: 'Contacted', pill: pill('#FBEAD9', '#C28A2A') },
  { v: 'approved', label: 'Approved', pill: pill('#EAF2E5', '#4E7C3F') },
  { v: 'declined', label: 'Declined', pill: pill('#FBE6E0', '#B5532F') },
  { v: 'no_response', label: 'No Response', pill: pill('#F1EADD', '#8C7E6B') },
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
//  - lockEventId set → single event, no event dropdown (Event Hub tab).
//  - lockEventId null → all events with a dropdown (Interest Inbox); scopeEventId presets it.
export default function EventInterestPanel({ uid, lockEventId = null, scopeEventId = null, onScopeConsumed, reloadKey = 0, onToast, isCoordinator = true }) {
  const [rows, setRows] = useState(null)
  const [statusFilter, setStatusFilter] = useState('approved') // default = Approved (confirmed list)
  const [evFilter, setEvFilter] = useState('all')
  const [scopeName, setScopeName] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    let q = supabase.from('event_interest')
      .select('id, created_at, status, contacted_at, approved_at, availability_dates, activity:activities!event_interest_activity_id_fkey(id, name, activity_date, start_date, end_date), person:people!event_interest_person_id_fkey(id, full_name, phone)')
      .order('created_at', { ascending: false })
    if (lockEventId) q = q.eq('activity_id', lockEventId)
    const { data } = await q
    setRows(data || [])
  }, [lockEventId])
  useEffect(() => { load() }, [load, reloadKey])

  // Preset the event dropdown to the event we arrived from (Interest Inbox from a hub).
  useEffect(() => {
    if (scopeEventId && !lockEventId) {
      setEvFilter(scopeEventId)
      supabase.from('activities').select('name').eq('id', scopeEventId).maybeSingle().then(({ data }) => setScopeName(data?.name || null))
      onScopeConsumed?.()
    }
  }, [scopeEventId, lockEventId, onScopeConsumed])

  const patchRow = (id, fields) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...fields } : r)))

  async function changeStatus(r, to) {
    setBusyId(r.id)
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
    } catch (e) { onToast?.('Could not update status: ' + (e.message || e)) } finally { setBusyId(null) }
  }

  async function saveAvailability(r, dates) {
    setBusyId(r.id)
    try {
      const { error } = await supabase.from('event_interest').update({ availability_dates: dates }).eq('id', r.id)
      if (error) throw error
      patchRow(r.id, { availability_dates: dates })
    } catch (e) { onToast?.('Could not save availability: ' + (e.message || e)) } finally { setBusyId(null) }
  }

  if (!rows) return <Loading label="Loading event interests…" />

  // Event scope first (dropdown), then status filter over that scope.
  const events = [...new Map(rows.map((r) => [r.activity?.id, r.activity])).values()].filter(Boolean)
  const evScoped = (lockEventId || evFilter === 'all') ? rows : rows.filter((r) => r.activity?.id === evFilter)
  const statusCounts = evScoped.reduce((m, r) => { const s = r.status || 'interested'; m[s] = (m[s] || 0) + 1; return m }, {})
  const shown = statusFilter === 'all' ? evScoped : evScoped.filter((r) => (r.status || 'interested') === statusFilter)
  const byEvent = {}
  for (const r of shown) { const id = r.activity?.id || '?'; (byEvent[id] ||= { ev: r.activity, people: [] }).people.push(r) }

  const filterChip = (on) => ({ fontSize: 12, fontWeight: 600, padding: '6px 11px', borderRadius: 20, cursor: 'pointer', border: on ? 'none' : '1px solid var(--border)', background: on ? '#241B14' : '#fff', color: on ? '#F6ECDC' : 'var(--ink-soft)' })

  return (
    <>
      {/* Status filter bar — defaults to Approved; switch to work the pipeline. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <button onClick={() => setStatusFilter('all')} style={filterChip(statusFilter === 'all')}>All <span style={{ opacity: 0.6 }}>{evScoped.length}</span></button>
        {EI_STATUS.map((s) => (
          <button key={s.v} onClick={() => setStatusFilter(s.v)} style={filterChip(statusFilter === s.v)}>{s.label} <span style={{ opacity: 0.6 }}>{statusCounts[s.v] || 0}</span></button>
        ))}
      </div>

      {!lockEventId && (
        <div style={{ marginBottom: 12 }}>
          <select value={evFilter} onChange={(e) => setEvFilter(e.target.value)} style={{ padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 13, background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer' }}>
            <option value="all">All events ({events.length})</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name} · {fmtDate(e.activity_date)}</option>)}
          </select>
        </div>
      )}

      {shown.length === 0 && (
        <Empty label={statusFilter === 'approved'
          ? 'No approved volunteers yet — switch to Interested/Contacted to work the pipeline.'
          : `No ${statusFilter === 'all' ? '' : (EI_STATUS_MAP[statusFilter]?.label.toLowerCase() + ' ')}interests${scopeName ? ` for ${scopeName}` : ''} yet.`} />
      )}

      {Object.values(byEvent).map((g) => {
        const days = eventDays(g.ev?.start_date || g.ev?.activity_date, g.ev?.end_date)
        return (
          <div key={g.ev?.id} className="card" style={{ padding: 16, marginBottom: 12 }}>
            {!lockEventId && <div style={{ fontSize: 14, fontWeight: 600 }}>{g.ev?.name} <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>· {fmtDate(g.ev?.activity_date)} · {g.people.length} shown</span></div>}
            <div style={{ marginTop: lockEventId ? 0 : 8 }}>
              {g.people.map((r, i) => (
                <PersonInterestRow key={r.id} r={r} i={i} days={days} busy={busyId === r.id} canEdit={isCoordinator}
                  onAction={(to) => changeStatus(r, to)} onAvailability={(d) => saveAvailability(r, d)} />
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}

// One event-interest person: name/phone + status badge + contextual action buttons +
// editable day-availability chips.
function PersonInterestRow({ r, i, days, busy, canEdit, onAction, onAvailability }) {
  const status = r.status || 'interested'
  const avail = r.availability_dates || []
  const allSelected = days.length > 0 && days.every((d) => avail.includes(d))
  const toggleDay = (d) => onAvailability(avail.includes(d) ? avail.filter((x) => x !== d) : [...avail, d].sort())
  const toggleAll = () => onAvailability(allSelected ? [] : [...days])
  const chip = (on) => ({ fontSize: 11, fontWeight: 600, padding: '4px 9px', borderRadius: 7, cursor: busy ? 'default' : 'pointer', border: on ? '1px solid #C2691F' : '1px solid var(--border)', background: on ? '#F6E8D8' : '#fff', color: on ? '#C2691F' : 'var(--muted)', opacity: busy ? 0.6 : 1 })
  const actions = actionsFor(status, r.contacted_at)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid #F4EEE2' }}>
      <div style={{ width: 30, height: 30, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 600, flexShrink: 0 }}>{initials(r.person?.full_name || '?')}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{r.person?.full_name || 'Unknown'}</div>
          <span className="pill" style={{ ...(EI_STATUS_MAP[status]?.pill), fontSize: 10 }}>{EI_STATUS_MAP[status]?.label}</span>
          <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>· {ago(r.created_at)}</span>
        </div>
        <div style={{ fontSize: 11.5, color: r.person?.phone ? 'var(--muted)' : '#B5532F', marginTop: 1 }}>{r.person?.phone || 'no phone'}</div>

        {canEdit && actions.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {actions.map((a) => (
              <button key={a.to + a.label} disabled={busy} onClick={() => onAction(a.to)}
                style={{ fontSize: 11.5, fontWeight: 600, padding: '5px 11px', borderRadius: 8, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
                  border: a.primary ? 'none' : '1px solid var(--border)', background: a.primary ? 'linear-gradient(150deg, var(--orange-2), var(--orange-3))' : '#fff', color: a.primary ? '#fff' : 'var(--ink-soft)' }}>{a.label}</button>
            ))}
          </div>
        )}

        {days.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 10.5, color: 'var(--muted-2)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginRight: 2 }}>Available</label>
            {canEdit ? (
              <>
                {days.length > 1 && <button disabled={busy} onClick={toggleAll} style={chip(allSelected)}>All Days</button>}
                {days.map((d, di) => (
                  <button key={d} disabled={busy} onClick={() => toggleDay(d)} style={chip(avail.includes(d))} title={fmtDay(d)}>Day {di + 1} · {fmtDay(d)}</button>
                ))}
              </>
            ) : (
              avail.length ? avail.map((d) => <span key={d} className="pill" style={{ ...pill('#F6E8D8', '#C2691F'), fontSize: 10.5 }}>Day {days.indexOf(d) + 1} · {fmtDay(d)}</span>)
                : <span style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>not set</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
