import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchActivityTypes } from '../lib/activityTypes'
import { seriesEndDate } from '../lib/planning'
import { ensureSeriesWindow, materializeOccurrence } from '../lib/series'
import RecurrenceFields, { toRule } from './RecurrenceFields'

// The SINGLE event-creation entry point (opened from the site toolbar, coordinators
// only — the button is gated in App and the write is gated at the table by RLS:
// act_insert requires can_all() or a center_coordinator on their own centre).
// Stores ONE series rule for recurring events and materializes only the rolling
// window (+ the first occurrence); future occurrences are projected from the rule.
export default function CreateEventModal({ me, presetDate, onClose, onCreated, onToast }) {
  const today = new Date().toISOString().slice(0, 10)
  const seed = presetDate || today
  const [name, setName] = useState('')
  const [start, setStart] = useState(seed)
  const [end, setEnd] = useState(seed)
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
      setCentres(real)
      // Default to the coordinator's own centre when it's a real one, else the first.
      const mine = me?.center_id && !['all', 'unassigned'].includes(me.center_id) ? me.center_id : ''
      setCentre(mine || real[0]?.id || '')
    })
    fetchActivityTypes().then((all) => setTypes(all || [])).catch(() => setTypes([]))
  }, [me])

  const recurring = toRule(recur, start).freq !== 'none'

  async function save() {
    if (!name.trim()) return onToast('Event needs a name.')
    if (!centre) return onToast('Pick a centre.')
    if (end < start) return onToast('End date is before start date.')
    setBusy(true)
    try {
      const base = { name: name.trim(), center_id: centre, activity_type_id: typeId || null, description: desc.trim() || null, is_open: true, created_by: me?.id || null }
      const rule = toRule(recur, start)
      if (rule.freq === 'none') {
        const { data, error } = await supabase.from('activities')
          .insert({ ...base, start_date: start, end_date: end, activity_date: start }).select('id').single()
        if (error) throw error
        onToast(`Event "${name.trim()}" created.`)
        onCreated?.(data?.id)
      } else {
        const spanDays = Math.round((Date.parse(end) - Date.parse(start)) / 86400000)
        const { data: s, error: e1 } = await supabase.from('event_series').insert({
          name: base.name, center_id: centre, activity_type_id: typeId || null, description: desc.trim() || null,
          freq: rule.freq, interval: rule.interval, span_days: Math.max(0, spanDays),
          start_date: start, end_date: seriesEndDate(start, rule),
          monthly_mode: rule.monthly_mode ?? null, month_week: rule.month_week ?? null, month_weekday: rule.month_weekday ?? null,
          created_by: me?.id || null,
        }).select('*').single()
        if (e1) throw e1
        const firstId = await materializeOccurrence(s, start)
        await ensureSeriesWindow()
        onToast(`Recurring "${name.trim()}" created.`)
        onCreated?.(firstId)
      }
    } catch (e) {
      onToast('Could not create: ' + (e.message || e))
    } finally { setBusy(false) }
  }

  const input = { width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 12px', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: '#fff', color: 'var(--ink)' }
  const label = { display: 'block', fontSize: 12, fontWeight: 600, color: '#5C5142', marginBottom: 5 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }} onClick={onClose}>
      <div className="card scrollarea" style={{ width: 460, maxWidth: '100%', padding: 24, boxShadow: 'var(--shadow-lg)', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 2px' }}>Create event</h3>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 16 }}>Attendance, staffing and stage are managed on the event afterwards.</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div><span style={label}>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Guru Purnima Setup" style={input} autoFocus /></div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><span style={label}>Start date</span><input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value) }} style={input} /></div>
            <div style={{ flex: 1 }}><span style={label}>End date</span><input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} style={input} /></div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><span style={label}>Centre</span>
              <select value={centre} onChange={(e) => setCentre(e.target.value)} style={input}>
                <option value="">— select —</option>
                {centres.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}><span style={label}>Type (optional)</span>
              <select value={typeId} onChange={(e) => setTypeId(e.target.value)} style={input}>
                <option value="">— none —</option>
                <optgroup label="Volunteer">{types.filter((t) => t.kind === 'volunteer').map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</optgroup>
                <optgroup label="Meditator">{types.filter((t) => t.kind === 'meditator').map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</optgroup>
              </select>
            </div>
          </div>
          <div><span style={label}>Description (optional)</span><textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} style={{ ...input, resize: 'vertical' }} /></div>
          <div><span style={label}>Repeats</span><RecurrenceFields value={recur} onChange={setRecur} startDate={start} /></div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={save}>{busy ? 'Creating…' : recurring ? 'Create series' : 'Create event'}</button>
        </div>
      </div>
    </div>
  )
}
