import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { telHref, smsHref, waHref } from '../lib/phone'
import { Pad, ErrorCard, Loading, Empty, SectionTitle, Chip } from '../components/View'
import HolderMap from '../components/HolderMap'
import {
  createPooja, listPoojas, listRequests, approveRequest, declineRequest,
  setSeats, closePooja, reopenPooja, cancelPooja, istIso,
} from '../lib/poojaWrites'
import {
  POOJA_TYPES, fmtDate, listPoojaDates, datesRemaining, listHoldersFor,
  recordOutreach, confirmHost, updatePersonAddress, addGuestByPhone,
} from '../lib/poojaHosts'

// Volunteer side of pooja hosting. Hosts have no logins: a volunteer rings each
// holder for a given date, and a "yes" becomes a pooja at that person's home.
//
// The dates come from Isha's own lunar calendar (`pooja_dates`), not from a rule
// in this file — Sannidhi Pooja is every Monday plus purnima and amavasya, and
// those two are lunar, so they cannot be derived from a weekday.
//
// The word "coordinator" appears nowhere a host or guest can read.

const fmtWhen = (ts) => (ts
  ? new Date(ts).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  : '')

const STATUS_PILL = {
  open: { background: 'var(--success-bg)', color: 'var(--success-fg)' },
  closed: { background: 'var(--neutral-bg)', color: 'var(--neutral-fg)' },
  cancelled: { background: 'var(--danger-bg)', color: 'var(--danger-fg)' },
}
const OUTCOME_PILL = {
  confirmed: { background: 'var(--success-bg)', color: 'var(--success-fg)', label: 'Hosting' },
  declined: { background: 'var(--neutral-bg)', color: 'var(--neutral-fg)', label: 'Not this time' },
  no_answer: { background: 'var(--warning-bg)', color: 'var(--warning-fg)', label: 'No answer' },
}

const input = { width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 11px', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: '#fff', color: 'var(--ink)' }
const label = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 5 }
const linkBtn = { padding: '5px 11px', fontSize: 12, textDecoration: 'none' }

export default function Poojas({ me, isCoordinator = false, onToast }) {
  const [dates, setDates] = useState(null)
  const [remaining, setRemaining] = useState(null)
  const [selected, setSelected] = useState(null) // { date, types:[] }
  const [tab, setTab] = useState('calls') // 'calls' | 'posted' | 'map'
  const [err, setErr] = useState(null)
  const [centre, setCentre] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    Promise.all([listPoojaDates({ limit: 10 }), datesRemaining()])
      .then(([d, rem]) => { setDates(d); setRemaining(rem); setSelected(d[0] || null) })
      .catch((e) => setErr(e.message || String(e)))
    supabase.from('centers').select('id, name').eq('active', true).then(({ data }) => {
      const real = (data || []).filter((c) => !['all', 'unassigned'].includes(c.id))
      const mine = me?.center_id && !['all', 'unassigned'].includes(me.center_id) ? me.center_id : ''
      setCentre(mine || real[0]?.id || '')
    })
  }, [me])

  // The dates were imported by hand and will run out. Say so before they do,
  // rather than letting the page quietly go empty one week.
  const runningOut = useMemo(() => {
    if (!remaining) return null
    const soon = Object.entries(remaining).filter(([, v]) => v.count <= 6)
    return soon.length ? soon.map(([k, v]) => `${POOJA_TYPES[k]?.short || k} has ${v.count} left (last ${fmtDate(v.last)})`).join('; ') : null
  }, [remaining])

  if (err) return <Pad><ErrorCard>{err}</ErrorCard></Pad>
  if (!dates) return <Loading />

  return (
    <Pad>
      <SectionTitle
        title="Poojas at homes"
        subtitle="Ring each holder for the date. A yes becomes a pooja at their home."
        right={isCoordinator && <button className="btn btn-ghost" onClick={() => setCreating(true)}>＋ Post one by hand</button>}
      />

      {runningOut && (
        <div className="card" style={{ padding: '10px 13px', marginBottom: 14, borderColor: 'var(--border-strong)', background: 'var(--warning-bg)', color: 'var(--warning-fg)', fontSize: 12.5, fontWeight: 600 }}>
          Pooja dates are running low — {runningOut}. Re-import them from Isha&apos;s lunar calendar.
        </div>
      )}

      {dates.length === 0 ? (
        <Empty label="No upcoming pooja dates are loaded. Import them from Isha's lunar calendar." />
      ) : (
        <>
          <div className="scroll-tabs" style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {dates.map((d) => (
              <Chip
                key={d.date}
                on={selected?.date === d.date}
                label={`${fmtDate(d.date)} · ${d.types.map((t) => POOJA_TYPES[t]?.short || t).join(' + ')}`}
                onClick={() => setSelected(d)}
              />
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <Chip on={tab === 'calls'} label="Hosts to call" onClick={() => setTab('calls')} />
            <Chip on={tab === 'posted'} label="Poojas posted" onClick={() => setTab('posted')} />
            <Chip on={tab === 'map'} label="Map" onClick={() => setTab('map')} />
          </div>

          {tab === 'calls' && selected && (
            <CallList date={selected.date} types={selected.types} me={me} centre={centre} isCoordinator={isCoordinator} onToast={onToast} />
          )}
          {tab === 'posted' && <PostedPoojas me={me} isCoordinator={isCoordinator} onToast={onToast} />}
          {tab === 'map' && <MapTab onToast={onToast} />}
        </>
      )}

      {creating && (
        <CreatePoojaModal me={me} onClose={() => setCreating(false)} onToast={onToast} onCreated={() => { setCreating(false); setTab('posted') }} />
      )}
    </Pad>
  )
}

// ── Hosts to call ──────────────────────────────────────────────────────────

function CallList({ date, types, me, centre, isCoordinator, onToast }) {
  const [byType, setByType] = useState(null)
  const [err, setErr] = useState(null)

  const load = useCallback(async () => {
    try {
      setErr(null)
      const out = {}
      for (const t of types) out[t] = await listHoldersFor(date, t)
      setByType(out)
    } catch (e) { setErr(e.message || String(e)) }
  }, [date, types])

  useEffect(() => { load() }, [load])

  if (err) return <ErrorCard>{err}</ErrorCard>
  if (!byType) return <Loading label="Loading holders…" />

  const total = Object.values(byType).reduce((n, r) => n + r.length, 0)
  if (!total) return <Empty label="No holders on record yet. Run the Ishangam holder extract, or mark someone a holder on their profile." />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {types.map((t) => {
        const rows = byType[t] || []
        const done = rows.filter((r) => r.outreach || r.listing).length
        return (
          <div key={t}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: 15.5, fontWeight: 600, margin: 0 }}>{POOJA_TYPES[t]?.label || t}</h3>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{done} of {rows.length} answered</span>
            </div>
            {rows.length === 0
              ? <Empty label={`Nobody is marked as a ${POOJA_TYPES[t]?.short} holder yet.`} />
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {rows.map((h) => (
                    <HolderRow key={h.id} holder={h} date={date} type={t} me={me} centre={centre}
                      isCoordinator={isCoordinator} onChanged={load} onToast={onToast} />
                  ))}
                </div>
              )}
          </div>
        )
      })}
    </div>
  )
}

function HolderRow({ holder: h, date, type, me, centre, isCoordinator, onChanged, onToast }) {
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState(null) // 'confirm' | 'address'
  const out = h.outreach?.outcome
  const pill = out ? OUTCOME_PILL[out] : null

  const act = async (fn, msg) => {
    setBusy(true)
    try { await fn(); onToast?.(msg); await onChanged() }
    catch (e) { onToast?.(e.message || String(e)) }
    finally { setBusy(false) }
  }

  const first = (h.full_name || '').split(' ')[0]
  const ask = `Namaskaram ${first}, this is Isha Electronic City. Would you be able to host the ${POOJA_TYPES[type]?.label} at your home on ${fmtDate(date)}?`

  return (
    <div className="card" style={{ padding: 13 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 210 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>{h.full_name || '(no name)'}</span>
            {h.listing && <span className="pill" style={STATUS_PILL[h.listing.status] || STATUS_PILL.open}>pooja posted</span>}
            {!h.listing && pill && <span className="pill" style={{ background: pill.background, color: pill.color }}>{pill.label}</span>}
            {!h.hasAddress && <span className="pill" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>no address</span>}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
            {h.phone || 'no number'}{h.pincode ? ` · ${h.pincode}` : ''}{h.address ? ` · ${h.address}` : ''}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {telHref(h.phone) && <a className="btn btn-ghost" style={linkBtn} href={telHref(h.phone)}>Call</a>}
          {smsHref(h.phone) && <a className="btn btn-ghost" style={linkBtn} href={smsHref(h.phone, ask)}>SMS</a>}
          {waHref(h.phone) && <a className="btn btn-ghost" style={linkBtn} href={waHref(h.phone, ask)} target="_blank" rel="noreferrer">WhatsApp</a>}
        </div>
      </div>

      {isCoordinator && !h.listing && (
        <div style={{ display: 'flex', gap: 7, marginTop: 11, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-primary" disabled={busy} style={{ padding: '6px 13px', fontSize: 12.5 }}
            onClick={() => setMode(mode === 'confirm' ? null : 'confirm')}>They said yes</button>
          <button className="btn btn-ghost" disabled={busy} style={{ padding: '6px 13px', fontSize: 12.5 }}
            onClick={() => act(() => recordOutreach({ date, type, personId: h.id, outcome: 'declined', by: me?.id }), 'Marked: not this time.')}>
            Not this time
          </button>
          <button className="btn btn-ghost" disabled={busy} style={{ padding: '6px 13px', fontSize: 12.5 }}
            onClick={() => act(() => recordOutreach({ date, type, personId: h.id, outcome: 'no_answer', by: me?.id }), 'Marked: no answer.')}>
            No answer
          </button>
          <button className="btn btn-ghost" disabled={busy} style={{ padding: '6px 13px', fontSize: 12.5 }}
            onClick={() => setMode(mode === 'address' ? null : 'address')}>
            {h.hasAddress ? 'Edit address' : 'Add address'}
          </button>
        </div>
      )}

      {mode === 'address' && (
        <AddressEditor person={h} busy={busy}
          onCancel={() => setMode(null)}
          onSave={(patch) => act(async () => { await updatePersonAddress(h.id, patch); setMode(null) }, 'Address saved to their record.')} />
      )}

      {mode === 'confirm' && (
        <ConfirmPanel holder={h} date={date} type={type} centre={centre} busy={busy}
          onCancel={() => setMode(null)}
          onConfirm={(vals) => act(async () => {
            await confirmHost({ date, type, person: h, ...vals, centerId: centre, by: me?.id })
            setMode(null)
          }, `Pooja posted at ${first}'s home.`)} />
      )}
    </div>
  )
}

function AddressEditor({ person, busy, onSave, onCancel }) {
  const [street, setStreet] = useState(person.street || '')
  const [city, setCity] = useState(person.city || '')
  const [pincode, setPincode] = useState(person.pincode || '')
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700, marginBottom: 8 }}>
        Address — saved on their record, never shown publicly
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div><span style={label}>House / street</span>
          <textarea value={street} onChange={(e) => setStreet(e.target.value)} rows={2} placeholder="Flat 402, Sai Residency, 3rd Cross…" style={{ ...input, resize: 'vertical' }} /></div>
        <div style={{ display: 'flex', gap: 9 }}>
          <div style={{ flex: 1 }}><span style={label}>City</span><input value={city} onChange={(e) => setCity(e.target.value)} style={input} /></div>
          <div style={{ width: 130 }}><span style={label}>Pincode</span><input value={pincode} onChange={(e) => setPincode(e.target.value)} inputMode="numeric" style={input} /></div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 11 }}>
        <button className="btn btn-ghost" disabled={busy} onClick={onCancel} style={{ padding: '6px 13px', fontSize: 12.5 }}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => onSave({ street, city, pincode })} style={{ padding: '6px 13px', fontSize: 12.5 }}>Save address</button>
      </div>
    </div>
  )
}

function ConfirmPanel({ holder, date, type, centre, busy, onConfirm, onCancel }) {
  // Area is typed, never inherited from people.area: that column is free text and
  // some rows hold a full street address, which would publish a home on the guest
  // page. Seats default to 8 — a living room, not a hall.
  const [area, setArea] = useState('')
  const [seats, setSeats] = useState('8')
  const [time, setTime] = useState('18:00')
  const blocked = !holder.hasAddress || !centre

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      {blocked ? (
        <div className="field-error" role="alert">
          {!holder.hasAddress
            ? 'No address on record. Add the address first — each approved guest is given it, so a pooja cannot be posted without one.'
            : 'No centre available for this account.'}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700, marginBottom: 8 }}>
            {POOJA_TYPES[type]?.label} · {fmtDate(date)}
          </div>
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 180 }}><span style={label}>Area guests will see</span>
              <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Neeladri Nagar" style={input} autoFocus /></div>
            <div style={{ width: 120 }}><span style={label}>Start time</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={input} /></div>
            <div style={{ width: 90 }}><span style={label}>Seats</span>
              <input value={seats} onChange={(e) => setSeats(e.target.value)} inputMode="numeric" style={input} /></div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
            Guests see the area only. The address goes to each guest when you approve them.
          </div>
        </>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 11 }}>
        <button className="btn btn-ghost" disabled={busy} onClick={onCancel} style={{ padding: '6px 13px', fontSize: 12.5 }}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || blocked || !area.trim()} style={{ padding: '6px 13px', fontSize: 12.5 }}
          onClick={() => onConfirm({ area, seats: Number(seats), time })}>Post the pooja</button>
      </div>
    </div>
  )
}

// ── Poojas already posted ──────────────────────────────────────────────────

function PostedPoojas({ me, isCoordinator, onToast }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [includePast, setIncludePast] = useState(false)
  const [openId, setOpenId] = useState(null)

  const load = useCallback(async () => {
    try { setErr(null); setRows(await listPoojas({ includePast })) }
    catch (e) { setErr(e.message || String(e)) }
  }, [includePast])
  useEffect(() => { load() }, [load])

  if (err) return <ErrorCard>{err}</ErrorCard>
  if (!rows) return <Loading />

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Chip on={!includePast} label="Upcoming" onClick={() => setIncludePast(false)} />
        <Chip on={includePast} label="All, including past" onClick={() => setIncludePast(true)} />
      </div>
      {rows.length === 0 && <Empty label={includePast ? 'No poojas have been posted yet.' : 'No upcoming poojas.'} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((p) => (
          <PoojaRow key={p.activity_id} pooja={p} me={me} isCoordinator={isCoordinator}
            expanded={openId === p.activity_id}
            onToggle={() => setOpenId(openId === p.activity_id ? null : p.activity_id)}
            onChanged={load} onToast={onToast} />
        ))}
      </div>
    </>
  )
}

function MapTab({ onToast }) {
  const [holders, setHolders] = useState(null)
  useEffect(() => {
    supabase.from('people')
      .select('id, full_name, phone, street, city, pincode')
      .or('has_sadhguru_sannidhi.eq.true,has_devi_yantra.eq.true')
      .then(({ data }) => setHolders((data || []).map((p) => ({ ...p, hasAddress: !!(p.street && p.street.trim()) }))))
  }, [])
  if (!holders) return <Loading label="Loading holders…" />
  if (!holders.length) return <Empty label="No holders on record yet — nothing to map." />
  return <HolderMap holders={holders} onToast={onToast} />
}

function PoojaRow({ pooja, me, isCoordinator, expanded, onToggle, onChanged, onToast }) {
  const [reqs, setReqs] = useState(null)
  const [busy, setBusy] = useState(false)
  const [seatsDraft, setSeatsDraft] = useState(String(pooja.seats))
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [adding, setAdding] = useState(false)

  const loadReqs = useCallback(async () => {
    try { setReqs(await listRequests(pooja.activity_id)) }
    catch (e) { onToast?.('Could not load guests: ' + (e.message || e)) }
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
          <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6, marginBottom: 14 }}>
            <div><b>Address</b> (approved guests only): {pooja.address || <span style={{ color: 'var(--muted-2)' }}>not set — approved guests will see nothing</span>}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span><b>Host</b>: {pooja.host_phone || <span style={{ color: 'var(--muted-2)' }}>no number</span>}</span>
              {pooja.host_phone && <a className="btn btn-ghost" style={linkBtn} href={telHref(pooja.host_phone)}>Call</a>}
              {pooja.host_phone && <a className="btn btn-ghost" style={linkBtn} href={waHref(pooja.host_phone, `Namaskaram, about the pooja on ${fmtWhen(pooja.starts_at)}`)} target="_blank" rel="noreferrer">WhatsApp</a>}
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

              <button className="btn btn-ghost" disabled={busy} onClick={() => setAdding((v) => !v)}>＋ Add a guest</button>

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

          {adding && (
            <AddGuest busy={busy} seatsLeft={pooja.seats_left}
              onCancel={() => setAdding(false)}
              onAdd={(vals) => act(async () => { await addGuestByPhone(pooja.activity_id, { ...vals, by: me?.id }); setAdding(false) }, 'Guest added and approved.')} />
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

// A guest signed up over the phone. Approved on the spot — the volunteer just
// spoke to them, so there is nobody left to approve it.
function AddGuest({ busy, seatsLeft, onAdd, onCancel }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [party, setParty] = useState(1)
  const max = Math.max(1, Math.min(3, seatsLeft || 1))
  return (
    <div className="card" style={{ padding: 13, marginBottom: 14, background: 'var(--panel)' }}>
      <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700, marginBottom: 9 }}>
        Add a guest you spoke to
      </div>
      <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 170 }}><span style={label}>Their name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" style={input} autoFocus /></div>
        <div style={{ flex: 1, minWidth: 150 }}><span style={label}>Mobile</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="9XXXXXXXXX" style={input} /></div>
        <div style={{ width: 120 }}><span style={label}>How many</span>
          <select value={party} onChange={(e) => setParty(Number(e.target.value))} style={input}>
            {Array.from({ length: max }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? 'Just them' : `${n} people`}</option>)}
          </select></div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 11 }}>
        <button className="btn btn-ghost" disabled={busy} onClick={onCancel} style={{ padding: '6px 13px', fontSize: 12.5 }}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !name.trim() || !phone.trim()} style={{ padding: '6px 13px', fontSize: 12.5 }}
          onClick={() => onAdd({ name, phone, party })}>Add and approve</button>
      </div>
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
            {r.phone && <a className="btn btn-ghost" style={linkBtn} href={telHref(r.phone)}>Call</a>}
            {isCoordinator && r.status === 'requested' && (
              <>
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
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
  const [f, setF] = useState({ title: '', date: today, time: '18:00', seats: '8', area: '', landmark: '', bringNote: '', address: '', hostPhone: '', centre: '' })
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
        bringNote: f.bringNote, address: f.address, hostPhone: f.hostPhone, createdBy: me?.id,
      })
      onToast?.(`"${f.title.trim()}" is live at #poojas.`)
      onCreated()
    } catch (e) { onToast?.(e.message || String(e)) } finally { setBusy(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }} onClick={onClose}>
      <div className="card scrollarea modal-sheet" style={{ width: 480, maxWidth: '100%', padding: 24, boxShadow: 'var(--shadow-lg)', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 2px' }}>Post a pooja by hand</h3>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 16 }}>
          For a pooja outside the usual dates. Only post one the host has agreed to. Guests see the area and landmark; the address is released to each guest only when you approve them.
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
          <div><span style={label}>Host&apos;s mobile</span>
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
