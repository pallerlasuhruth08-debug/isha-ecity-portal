import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { telHref, waHref } from '../lib/phone'
import { Pad, ErrorCard, Loading, Empty, SectionTitle, Chip } from '../components/View'
import {
  createPooja, listPoojas, listRequests, approveRequest, declineRequest,
  setSeats, closePooja, reopenPooja, cancelPooja, istIso,
} from '../lib/poojaWrites'

// Coordinator side of pooja hosting. In v1 hosts have no accounts — a coordinator
// posts on their behalf and approves every guest. That is not a temporary
// shortcut: approving a request is what hands a stranger a family's home address,
// and a human should be making that call.
//
// The guest-facing half is views/PublicPoojas.jsx at #poojas.

const fmtWhen = (ts) => (ts
  ? new Date(ts).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  : '')

const STATUS_PILL = {
  open: { background: 'var(--success-bg)', color: 'var(--success-fg)' },
  closed: { background: 'var(--neutral-bg)', color: 'var(--neutral-fg)' },
  cancelled: { background: 'var(--danger-bg)', color: 'var(--danger-fg)' },
}

const input = { width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 12px', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: '#fff', color: 'var(--ink)' }
const label = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 5 }

export default function Poojas({ me, isCoordinator = false, onToast }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [includePast, setIncludePast] = useState(false)
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState(null)

  const load = useCallback(async () => {
    try { setErr(null); setRows(await listPoojas({ includePast })) }
    catch (e) { setErr(e.message || String(e)) }
  }, [includePast])

  useEffect(() => { load() }, [load])

  if (!rows && !err) return <Loading />

  return (
    <Pad>
      {err && <ErrorCard>{err}</ErrorCard>}

      <SectionTitle
        title="Poojas at homes"
        subtitle="Hosts don't have logins — you post for them and approve each guest."
        right={isCoordinator && <button className="btn btn-primary" onClick={() => setCreating(true)}>＋ Post a pooja</button>}
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <Chip on={!includePast} label="Upcoming" onClick={() => setIncludePast(false)} />
        <Chip on={includePast} label="All, including past" onClick={() => setIncludePast(true)} />
      </div>

      {rows && rows.length === 0 && (
        <Empty
          label={includePast ? 'No poojas have been posted yet.' : 'No upcoming poojas.'}
          action={isCoordinator && <button className="btn btn-primary" onClick={() => setCreating(true)}>Post the first one</button>}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(rows || []).map((p) => (
          <PoojaRow
            key={p.activity_id}
            pooja={p}
            me={me}
            isCoordinator={isCoordinator}
            expanded={openId === p.activity_id}
            onToggle={() => setOpenId(openId === p.activity_id ? null : p.activity_id)}
            onChanged={load}
            onToast={onToast}
          />
        ))}
      </div>

      {creating && (
        <CreatePoojaModal
          me={me}
          onClose={() => setCreating(false)}
          onToast={onToast}
          onCreated={() => { setCreating(false); load() }}
        />
      )}
    </Pad>
  )
}

function PoojaRow({ pooja, me, isCoordinator, expanded, onToggle, onChanged, onToast }) {
  const [reqs, setReqs] = useState(null)
  const [busy, setBusy] = useState(false)
  const [seatsDraft, setSeatsDraft] = useState(String(pooja.seats))
  const [confirmCancel, setConfirmCancel] = useState(false)

  const loadReqs = useCallback(async () => {
    try { setReqs(await listRequests(pooja.activity_id)) }
    catch (e) { onToast?.('Could not load requests: ' + (e.message || e)) }
  }, [pooja.activity_id, onToast])

  useEffect(() => { if (expanded) loadReqs() }, [expanded, loadReqs])

  const act = async (fn, msg) => {
    setBusy(true)
    try { await fn(); onToast?.(msg); await Promise.all([onChanged(), loadReqs()]) }
    catch (e) { onToast?.(e.message || String(e)) }
    finally { setBusy(false) }
  }

  const pill = STATUS_PILL[pooja.status] || STATUS_PILL.closed
  const waiting = pooja.pending_count || 0

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{pooja.title}</h3>
            <span className="pill" style={pill}>{pooja.status}</span>
            {waiting > 0 && <span className="pill" style={{ background: 'var(--warning-bg)', color: 'var(--warning-fg)' }}>{waiting} waiting</span>}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{fmtWhen(pooja.starts_at)}</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {pooja.area}{pooja.landmark ? ` · near ${pooja.landmark}` : ''} · {pooja.seats_left} of {pooja.seats} seats left
          </div>
        </div>
        <button className="btn btn-ghost" onClick={onToggle} aria-expanded={expanded}>
          {expanded ? 'Hide' : `Guests${waiting ? ` · ${waiting} to decide` : ''}`}
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          {/* The private half. Visible here because you are logged in and RLS let
              you read the row — never rendered on any public page. */}
          <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6, marginBottom: 14 }}>
            <div><b>Address</b> (approved guests only): {pooja.address || <span style={{ color: 'var(--muted-2)' }}>not set — approved guests will see nothing</span>}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span><b>Host</b>: {pooja.host_phone || <span style={{ color: 'var(--muted-2)' }}>no number</span>}</span>
              {pooja.host_phone && <a className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12, textDecoration: 'none' }} href={telHref(pooja.host_phone)}>Call</a>}
              {pooja.host_phone && <a className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12, textDecoration: 'none' }} href={waHref(pooja.host_phone, `Namaskaram, about the pooja on ${fmtWhen(pooja.starts_at)}`)} target="_blank" rel="noreferrer">WhatsApp</a>}
            </div>
            {pooja.bring_note && <div><b>Guests are asked to bring</b>: {pooja.bring_note}</div>}
          </div>

          {isCoordinator && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Seats</span>
              <input value={seatsDraft} onChange={(e) => setSeatsDraft(e.target.value)} inputMode="numeric"
                style={{ ...input, width: 74, padding: '7px 9px' }} aria-label="Seats" />
              <button className="btn btn-ghost" disabled={busy || seatsDraft === String(pooja.seats)}
                onClick={() => act(() => setSeats(pooja.activity_id, Number(seatsDraft)), 'Seats updated.')}>Save</button>

              <span style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 4px' }} />

              {pooja.status === 'open'
                ? <button className="btn btn-ghost" disabled={busy} onClick={() => act(() => closePooja(pooja.activity_id), 'Closed — no new requests.')}>Stop taking requests</button>
                : pooja.status === 'closed'
                  ? <button className="btn btn-ghost" disabled={busy} onClick={() => act(() => reopenPooja(pooja.activity_id), 'Open for requests again.')}>Reopen</button>
                  : null}

              {pooja.status !== 'cancelled' && (confirmCancel ? (
                <>
                  <button className="btn btn-ghost" disabled={busy} style={{ color: 'var(--danger-fg)' }}
                    onClick={() => act(() => cancelPooja(pooja.activity_id), 'Cancelled. Ring the approved guests — nothing is sent automatically.')}>
                    Yes, cancel the pooja
                  </button>
                  <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirmCancel(false)}>Keep it</button>
                </>
              ) : (
                <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirmCancel(true)}>Cancel pooja</button>
              ))}
            </div>
          )}

          {pooja.status === 'cancelled' && (
            <ErrorCard>Cancelled. Approved guests are not told automatically — call them.</ErrorCard>
          )}

          <Requests
            reqs={reqs}
            seatsLeft={pooja.seats_left}
            busy={busy}
            isCoordinator={isCoordinator}
            onApprove={(id) => act(() => approveRequest(id, me?.id), 'Approved — they can now see the address.')}
            onDecline={(id) => act(() => declineRequest(id, me?.id), 'Declined.')}
          />
        </div>
      )}
    </div>
  )
}

function Requests({ reqs, seatsLeft, busy, isCoordinator, onApprove, onDecline }) {
  if (!reqs) return <Loading label="Loading guests…" />
  if (!reqs.length) return <Empty label="No one has asked for a seat yet." />

  const order = { requested: 0, approved: 1, declined: 2, cancelled: 3 }
  const sorted = [...reqs].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sorted.map((r) => {
        const tooBig = r.status === 'requested' && r.party_size > seatsLeft
        return (
          <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--panel)' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                {r.phone} · {r.party_size === 1 ? 'just them' : `${r.party_size} people`}
                {r.status !== 'requested' && ` · ${r.status}`}
              </div>
            </div>
            {r.phone && <a className="btn btn-ghost" style={{ padding: '5px 11px', fontSize: 12, textDecoration: 'none' }} href={telHref(r.phone)}>Call</a>}
            {isCoordinator && r.status === 'requested' && (
              <>
                {/* Approving is what releases the address. The seat check is here
                    as a guard rail; the RPC that grants seats enforces it too. */}
                <button className="btn btn-primary" disabled={busy || tooBig} style={{ padding: '6px 13px', fontSize: 12.5 }}
                  title={tooBig ? `Only ${seatsLeft} seat(s) left` : undefined}
                  onClick={() => onApprove(r.id)}>
                  {tooBig ? `Needs ${r.party_size}` : 'Approve'}
                </button>
                <button className="btn btn-ghost" disabled={busy} style={{ padding: '6px 13px', fontSize: 12.5 }}
                  onClick={() => onDecline(r.id)}>Decline</button>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

function CreatePoojaModal({ me, onClose, onCreated, onToast }) {
  const today = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({
    title: '', date: today, time: '07:00', seats: '12',
    area: '', landmark: '', bringNote: '', address: '', hostPhone: '', centre: '',
  })
  const [centres, setCentres] = useState([])
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  useEffect(() => {
    supabase.from('centers').select('id, name').eq('active', true).then(({ data }) => {
      const real = (data || []).filter((c) => !['all', 'unassigned'].includes(c.id))
      setCentres(real)
      const mine = me?.center_id && !['all', 'unassigned'].includes(me.center_id) ? me.center_id : ''
      setF((s) => ({ ...s, centre: mine || real[0]?.id || '' }))
    })
  }, [me])

  async function save() {
    setBusy(true)
    try {
      await createPooja({
        title: f.title, centerId: f.centre, startsAt: istIso(f.date, f.time),
        seats: Number(f.seats), area: f.area, landmark: f.landmark,
        bringNote: f.bringNote, address: f.address, hostPhone: f.hostPhone,
        createdBy: me?.id,
      })
      onToast?.(`"${f.title.trim()}" is live at #poojas.`)
      onCreated()
    } catch (e) {
      onToast?.(e.message || String(e))
    } finally { setBusy(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }} onClick={onClose}>
      <div className="card scrollarea modal-sheet" style={{ width: 480, maxWidth: '100%', padding: 24, boxShadow: 'var(--shadow-lg)', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 2px' }}>Post a pooja</h3>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 16 }}>
          Only post one the host has actually agreed to. Guests see the area and landmark; the address is released to each guest only when you approve them.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div><span style={label}>What to call it</span>
            <input value={f.title} onChange={set('title')} placeholder="e.g. Guru Pooja at Anand's home" style={input} autoFocus /></div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><span style={label}>Date</span><input type="date" value={f.date} onChange={set('date')} style={input} /></div>
            <div style={{ width: 120 }}><span style={label}>Start time</span><input type="time" value={f.time} onChange={set('time')} style={input} /></div>
            <div style={{ width: 90 }}><span style={label}>Seats</span><input value={f.seats} onChange={set('seats')} inputMode="numeric" style={input} /></div>
          </div>

          <div><span style={label}>Centre</span>
            <select value={f.centre} onChange={set('centre')} style={input}>
              <option value="">— select —</option>
              {centres.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
            </select>
          </div>

          <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700, marginTop: 4 }}>Everyone can see this</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><span style={label}>Area</span><input value={f.area} onChange={set('area')} placeholder="Neeladri Nagar" style={input} /></div>
            <div style={{ flex: 1 }}><span style={label}>Landmark (optional)</span><input value={f.landmark} onChange={set('landmark')} placeholder="near Vibgyor School" style={input} /></div>
          </div>
          <div><span style={label}>What to bring (optional)</span>
            <input value={f.bringNote} onChange={set('bringNote')} placeholder="Flowers or fruit, if you wish" style={input} /></div>

          <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700, marginTop: 4 }}>Approved guests only</div>
          <div><span style={label}>Full address</span>
            <textarea value={f.address} onChange={set('address')} rows={2} placeholder="Flat 402, Sai Residency, 3rd Cross…" style={{ ...input, resize: 'vertical' }} /></div>
          <div><span style={label}>Host's mobile</span>
            <input value={f.hostPhone} onChange={set('hostPhone')} inputMode="numeric" placeholder="9XXXXXXXXX" style={input} /></div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !f.title.trim() || !f.area.trim()} onClick={save}>
            {busy ? 'Posting…' : 'Post pooja'}
          </button>
        </div>
      </div>
    </div>
  )
}
