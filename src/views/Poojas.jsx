import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { telHref, smsHref, waHref } from '../lib/phone'
import { Pad, ErrorCard, Loading, Empty, Pager } from '../components/View'
import HolderMap from '../components/HolderMap'
import {
  createPooja, listPoojas, listRequests, approveRequest, declineRequest,
  setSeats, closePooja, reopenPooja, cancelPooja, istIso, countWaitingGuests,
} from '../lib/poojaWrites'
import {
  POOJA_TYPES, fmtDate, listPoojaDates, datesRemaining, listHostsForDate,
  searchHostsForDate, recordOutreach, confirmHost, updatePersonAddress, addGuestByPhone,
  optOutOfHosting,
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
// Every action on this screen is secondary to reading the row, so the buttons
// stop shouting: one compact size, used everywhere instead of the default .btn
// padding. `.tap44` keeps the touch target honest on a phone even though the
// paint is small.
const smallBtn = { padding: '5px 10px', fontSize: 12, fontWeight: 600 }

/**
 * Google Maps, searched for this address — the pin drops on the house.
 *
 * A saved lat/lng would be more precise, but this needs nothing stored and no
 * API key: Maps does the lookup each time from the address we already hold. It
 * opens in Maps rather than drawing a pin here, so the volunteer lands in the
 * app that can actually navigate them there.
 */
const mapsHref = (parts) => {
  const q = (Array.isArray(parts) ? parts : [parts]).filter(Boolean).join(', ').trim()
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q + ', India')}` : null
}

// WhatsApp's glyph. Inline rather than in lib/icons.jsx because that set is the
// app's own nav language; this is somebody else's mark and belongs with the one
// button that uses it.
const WhatsAppIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12.04 2A9.9 9.9 0 0 0 2.1 11.9c0 1.75.46 3.46 1.34 4.97L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01a9.9 9.9 0 0 0 9.9-9.9A9.9 9.9 0 0 0 12.04 2Zm0 18.13h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 1 1 6.99 3.86Zm4.5-6.16c-.25-.12-1.46-.72-1.68-.8-.23-.09-.39-.13-.56.12s-.64.8-.79.97c-.14.16-.29.18-.54.06a6.72 6.72 0 0 1-1.98-1.22 7.42 7.42 0 0 1-1.37-1.7c-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.44.12-.15.16-.25.25-.42.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.41-.56-.42h-.47c-.16 0-.43.06-.65.31-.22.25-.85.83-.85 2.03s.87 2.35.99 2.51c.12.16 1.71 2.61 4.15 3.66.58.25 1.03.4 1.39.51.58.19 1.11.16 1.53.1.47-.07 1.46-.6 1.66-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.28Z" />
  </svg>
)

/**
 * The pooja as a message a volunteer can paste into a WhatsApp group.
 *
 * Carries only what a guest needs to decide and turn up: what, when, roughly
 * where, how many seats are left, and the link to ask for one. It never carries
 * the street address or the host's number — those are released per guest, on
 * approval, by pooja_my_request(). Pasting this into a group of 200 people is
 * exactly the case that rule exists for.
 */
function poojasMessage(list, { origin = '' } = {}) {
  const link = `${origin || ''}/#poojas`
  const one = (p) => {
    const when = new Date(p.starts_at).toLocaleString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
    })
    const where = p.lat && p.lng
      ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`
      : [p.area, p.landmark && `near ${p.landmark}`].filter(Boolean).join(', ')
    return [
      `🪔 *${p.title}*`,
      `🗓 ${when}`,
      where && `📍 ${where}`,
      `🪑 ${p.seats_left} of ${p.seats} seats still open`,
      p.bring_note && `🌼 Do bring: ${p.bring_note}`,
    ].filter(Boolean).join('\n')
  }

  const many = list.length > 1
  return [
    many ? '🪔 *Poojas at homes near you*' : null,
    many
      ? 'Families in our sector are opening their homes for the pooja, and there is room for you.'
      : 'A family in our sector is opening their home for the pooja, and there is room for you.',
    '',
    list.map(one).join('\n\n'),
    '',
    `Come and sit with us — say you'd like to join here: ${link}`,
    'They will send you the address once your place is saved. 🙏',
  ].filter((x) => x !== null).join('\n')
}
// Same shape as the filter row on Meditators and Volunteers, so this screen
// reads as part of the set rather than a pill experiment of its own.
const filterSelect = { border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit', background: '#fff', color: 'var(--ink)', cursor: 'pointer', minWidth: 190 }

export default function Poojas({ me, isCoordinator = false, onToast }) {
  const [dates, setDates] = useState(null)
  const [remaining, setRemaining] = useState(null)
  const [selected, setSelected] = useState(null) // { date, types:[] }
  const [tab, setTab] = useState('calls') // 'calls' | 'posted' | 'map'
  // 'all' | 'sannidhi' | 'yantra'. Filters the DATE list as well as the sections:
  // picking Yantra should leave you looking at yantra dates, not at a sannidhi
  // date with an empty yantra section under it.
  const [ptype, setPtype] = useState('all')
  const [err, setErr] = useState(null)
  const [centre, setCentre] = useState('')
  const [creating, setCreating] = useState(false)
  // Guests waiting on a yes/no, across every pooja still ahead. Sits on the tab
  // so it is answerable at a glance — see countWaitingGuests().
  const [waiting, setWaiting] = useState(0)

  const refreshWaiting = useCallback(() => {
    countWaitingGuests().then(setWaiting).catch(() => setWaiting(0))
  }, [])
  useEffect(() => { refreshWaiting() }, [refreshWaiting])

  // The dates load ONCE. This used to sit in the same effect as the centre
  // lookup, keyed on the whole `me` object — so any re-render that handed down a
  // fresh profile reloaded the dates and reset the selection to the first one.
  // A volunteer half way through calling for a purnima would silently be moved
  // to next Monday, and the next "They said yes" would post against the wrong
  // date. Selection is only seeded when nothing is chosen yet.
  useEffect(() => {
    Promise.all([listPoojaDates({ limit: 10 }), datesRemaining()])
      .then(([d, rem]) => {
        setDates(d)
        setRemaining(rem)
        setSelected((cur) => cur || d[0] || null)
      })
      .catch((e) => setErr(e.message || String(e)))
  }, [])

  const myCentre = me?.center_id
  useEffect(() => {
    supabase.from('centers').select('id, name').eq('active', true).then(({ data }) => {
      const real = (data || []).filter((c) => !['all', 'unassigned'].includes(c.id))
      const mine = myCentre && !['all', 'unassigned'].includes(myCentre) ? myCentre : ''
      setCentre(mine || real[0]?.id || '')
    })
  }, [myCentre])

  // The dates were imported by hand and will run out. Say so before they do,
  // rather than letting the page quietly go empty one week.
  const runningOut = useMemo(() => {
    if (!remaining) return null
    const soon = Object.entries(remaining).filter(([, v]) => v.count <= 6)
    return soon.length ? soon.map(([k, v]) => `${POOJA_TYPES[k]?.short || k} has ${v.count} left (last ${fmtDate(v.last)})`).join('; ') : null
  }, [remaining])

  // Dates that carry what you asked for. Sannidhi falls on every Monday plus
  // purnima and amavasya; Yantra only on purnima — so an unfiltered list is
  // mostly sannidhi and the yantra dates are easy to miss.
  //
  // 'both' is a different question from 'all': all = everyone to ring today,
  // both = the people who have a Sannidhi AND a yantra, who can take the two
  // together. That only arises on a day carrying both, so the date list narrows
  // to those days too.
  const shownDates = useMemo(() => {
    const all = dates || []
    if (ptype === 'all') return all
    if (ptype === 'both') return all.filter((d) => d.types.length > 1)
    return all.filter((d) => d.types.includes(ptype))
  }, [dates, ptype])

  // Keep the selection honest when the filter narrows past it.
  useEffect(() => {
    if (!dates) return
    if (!selected || !shownDates.some((d) => d.date === selected.date)) setSelected(shownDates[0] || null)
  }, [shownDates, selected, dates])

  // 'both' still calls for both poojas — it narrows WHO, not WHICH.
  const shownTypes = useMemo(() => {
    if (!selected) return []
    if (ptype === 'all' || ptype === 'both') return selected.types
    return selected.types.filter((t) => t === ptype)
  }, [selected, ptype])

  if (err) return <Pad><ErrorCard>{err}</ErrorCard></Pad>
  if (!dates) return <Loading />

  return (
    <Pad>
      {/* No page title here — the Topbar already says "Consecrated spaces". */}

      {runningOut && (
        <div className="card" style={{ padding: '10px 13px', marginBottom: 14, borderColor: 'var(--border-strong)', background: 'var(--warning-bg)', color: 'var(--warning-fg)', fontSize: 12.5, fontWeight: 600 }}>
          Pooja dates are running low — {runningOut}. Re-import them from Isha&apos;s lunar calendar.
        </div>
      )}

      {dates.length === 0 ? (
        <Empty label="No upcoming pooja dates are loaded. Import them from Isha's lunar calendar." />
      ) : (
        <>
          {/* Tabs, not a dropdown: these are three different jobs, not three
              filters on one list — and a dropdown hides the guests-waiting count
              behind a click. Same underline pattern as the Event Hub. */}
          {/* Tabs and the one page-level action share a row and a rule. The
              action had its own band above, which bought nothing and pushed the
              work down a line on every screen. */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
            <div className="scroll-tabs" role="tablist" aria-label="Pooja views"
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
              {[
                { k: 'calls', label: 'Hosts to call' },
                { k: 'posted', label: 'Poojas posted', n: waiting },
                { k: 'map', label: 'Map' },
              ].map((t) => (
                <button key={t.k} className="tap44" role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)}
                  style={{ padding: '9px 14px', fontSize: 14, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', color: tab === t.k ? 'var(--ink)' : 'var(--muted)', borderBottom: tab === t.k ? '2px solid var(--orange)' : '2px solid transparent', marginBottom: -1, whiteSpace: 'nowrap' }}>
                  {t.label}
                  {t.n > 0 && (
                    <span title={`${t.n} guest${t.n === 1 ? '' : 's'} asking for a seat`}
                      style={{ marginLeft: 6, fontSize: 12, fontWeight: 700, color: tab === t.k ? 'var(--orange)' : 'var(--muted-2)' }}>
                      {t.n} waiting
                    </span>
                  )}
                </button>
              ))}
            </div>
            {isCoordinator && (
              <button className="btn btn-ghost tap44" style={{ ...smallBtn, marginBottom: 6, flexShrink: 0 }}
                onClick={() => setCreating(true)}
                title="Add a pooja somebody already agreed to, without going through the call list">
                ＋ Add Pooja
              </button>
            )}
          </div>

          {tab === 'calls' && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <select aria-label="Pooja type" style={filterSelect} value={ptype} onChange={(e) => setPtype(e.target.value)}>
                <option value="all">All holders</option>
                <option value="sannidhi">Sannidhi holders</option>
                <option value="yantra">Yantra holders</option>
                <option value="both">Holds both</option>
              </select>
              <select aria-label="Pooja date" style={filterSelect}
                value={selected?.date || ''}
                onChange={(e) => setSelected(shownDates.find((d) => d.date === e.target.value) || null)}>
                {shownDates.map((d) => (
                  <option key={d.date} value={d.date}>
                    {fmtDate(d.date)} · {d.types.map((t) => POOJA_TYPES[t]?.short || t).join(' + ')}
                  </option>
                ))}
              </select>
            </div>
          )}

          {tab === 'calls' && !selected && (
            <Empty label={`No upcoming ${POOJA_TYPES[ptype]?.short || ''} date is loaded. Yantra Pooja falls only on purnima, so there are far fewer of them — switch to "Both poojas", or re-import from Isha's lunar calendar.`} />
          )}
          {tab === 'calls' && selected && (
            <CallList date={selected.date} types={shownTypes} onlyBoth={ptype === 'both'}
              me={me} centre={centre} isCoordinator={isCoordinator} onToast={onToast} />
          )}
          {tab === 'posted' && <PostedPoojas me={me} isCoordinator={isCoordinator} onToast={onToast} onCountsChanged={refreshWaiting} />}
          {tab === 'map' && <MapTab />}
        </>
      )}

      {creating && (
        <CreatePoojaModal me={me} onClose={() => setCreating(false)} onToast={onToast} onCreated={() => { setCreating(false); setTab('posted') }} />
      )}
    </Pad>
  )
}

// ── Hosts to call ──────────────────────────────────────────────────────────

function CallList({ date, types, onlyBoth = false, me, centre, isCoordinator, onToast }) {
  const [all, setAll] = useState(null)
  const [err, setErr] = useState(null)
  // types is a fresh array each render; key on its content or the load loops.
  const typeKey = types.join(',')

  const load = useCallback(async () => {
    try { setErr(null); setAll(await listHostsForDate(date, typeKey.split(','))) }
    catch (e) { setErr(e.message || String(e)) }
  }, [date, typeKey])

  useEffect(() => { load() }, [load])

  if (err) return <ErrorCard>{err}</ErrorCard>
  if (!all) return <Loading label="Loading holders…" />

  // "Holds both" is a filter on people, applied after the fetch — the query is
  // per pooja type and cannot express "has two of them".
  const rows = onlyBoth ? all.filter((r) => r.types.length > 1) : all
  const total = rows.length
  const answered = rows.filter((r) => r.answered).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* The date a volunteer is ringing about must never scroll away. Sixty
          holders is a long list, and "which date was this again?" is the one
          question she cannot answer from the row in front of her — every row
          looks the same. Sticky, so it is on screen for every single call. */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg)',
        padding: '10px 12px', margin: '-4px 0 0', borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-strong)', boxShadow: '0 2px 8px rgba(60,40,20,.06)',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
          You are calling for {fmtDate(date)}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>
          {types.map((t) => POOJA_TYPES[t]?.label || t).join(' + ')}
          {total > 0 && ` · ${answered} of ${total} answered`}
        </div>
      </div>

      {!total && (
        <Empty label="No Sannidhi or Yantra holders are on record yet — run the Ishangam holder extract, or find a host by name below." />
      )}
      <HolderSection rows={rows} types={typeKey.split(',')} date={date} me={me} centre={centre}
        isCoordinator={isCoordinator} onChanged={load} onToast={onToast} />
    </div>
  )
}

/**
 * One pooja type's holders: heading, the find-a-host box, then a paged list.
 *
 * Paged in memory rather than through usePagedQuery, because the ORDER is
 * computed client-side in poojaHosts.decorate() — not-yet-called first, then
 * no-address, then the rest. Server-side paging would page the raw alphabetical
 * rows and scatter the people who still need calling across every page, which is
 * the opposite of what this screen is for. Sixty holders is one small request.
 */
function HolderSection({ rows, types, date, me, centre, isCoordinator, onChanged, onToast }) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)

  // A new date or a new filter is a new list; page 3 of the old one is nonsense.
  useEffect(() => { setPage(0) }, [date, types.join(','), rows.length])

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const shown = rows.slice(page * pageSize, page * pageSize + pageSize)

  return (
    <div>
      {/* Above the list, not below it. Sixty holders deep, a search box at the
          bottom is a search box nobody finds. */}
      <HostSearch date={date} types={types} me={me} centre={centre}
        isCoordinator={isCoordinator} onChanged={onChanged} onToast={onToast} />

      {rows.length === 0
        ? <Empty label="Nobody is marked as a holder for this pooja yet." />
        : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {shown.map((h) => (
                <HolderRow key={h.id} holder={h} date={date} me={me} centre={centre}
                  isCoordinator={isCoordinator} onChanged={onChanged} onToast={onToast} />
              ))}
            </div>
            {rows.length > pageSize && (
              <Pager page={page} pageCount={pageCount} total={rows.length} onPage={setPage}
                pageSize={pageSize} onPageSize={(n) => { setPageSize(n); setPage(0) }} noun="holders" />
            )}
          </>
        )}
    </div>
  )
}

// Holders are the shortlist, not the only possible host. A home can host without
// the Sannidhi being recorded in Ishangam — and until the extract has been run,
// the shortlist is empty and this is the only way in.
function HostSearch({ date, types, me, centre, isCoordinator, onChanged, onToast }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const typeKey = types.join(',')

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setRows(null); return }
    let alive = true
    setBusy(true)
    const h = setTimeout(() => {
      searchHostsForDate(date, typeKey.split(','), term)
        .then((r) => { if (alive) setRows(r) })
        .catch((e) => onToast?.(e.message || String(e)))
        .finally(() => { if (alive) setBusy(false) })
    }, 300)
    return () => { alive = false; clearTimeout(h) }
  }, [q, date, typeKey, onToast])

  return (
    <div style={{ marginBottom: 12 }}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find another host — name or phone"
        aria-label="Find a host by name or phone"
        style={{ ...input, maxWidth: 420 }}
      />
      {busy && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }}>Searching…</div>}
      {rows && rows.length === 0 && !busy && (
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }}>Nobody matched that.</div>
      )}
      {rows && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {rows.map((h) => (
            <HolderRow key={h.id} holder={h} date={date} me={me} centre={centre}
              isCoordinator={isCoordinator} onChanged={onChanged} onToast={onToast} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One person, one row — however many poojas fall that day.
 *
 * `h.types` is what THIS person could host on THIS date. When it holds both, the
 * row offers them together: that is one evening at one house, and it is the
 * question a volunteer actually asks on the phone.
 */
function HolderRow({ holder: h, date, me, centre, isCoordinator, onChanged, onToast }) {
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState(null) // 'confirm' | 'address'
  const types = h.types?.length ? h.types : ['sannidhi']
  const both = types.length > 1

  // Which poojas the yes covers. Defaults to all of them: if someone holds both
  // and the day carries both, doing them together is the normal answer.
  const [picked, setPicked] = useState(types)

  const act = async (fn, msg) => {
    setBusy(true)
    try { await fn(); onToast?.(msg); await onChanged() }
    catch (e) { onToast?.(e.message || String(e)) }
    finally { setBusy(false) }
  }

  const first = (h.full_name || '').split(' ')[0]
  const poojaWords = types.map((t) => POOJA_TYPES[t]?.label || t).join(' and the ')
  const ask = `Namaskaram ${first}, this is Isha Electronic City. Would you be able to host the ${poojaWords} at your home on ${fmtDate(date)}?`

  const listing = types.map((t) => h.listingByType?.[t]).find(Boolean) || h.listing
  const answers = types.map((t) => h.outreachByType?.[t]?.outcome).filter(Boolean)
  const allSame = answers.length === types.length && new Set(answers).size === 1
  const pill = allSame ? OUTCOME_PILL[answers[0]] : null

  return (
    <div className="card" style={{ padding: 13 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 210 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>{h.full_name || '(no name)'}</span>
            {/* What they hold — the only way to tell, now that the two lists are one. */}
            {both
              ? <span className="pill" style={{ background: 'var(--info-bg)', color: 'var(--info-fg)' }}>Sannidhi + Yantra</span>
              : <span className="pill" style={{ background: 'var(--neutral-bg)', color: 'var(--neutral-fg)' }}>{POOJA_TYPES[types[0]]?.short}</span>}
            {listing && <span className="pill" style={STATUS_PILL[listing.status] || STATUS_PILL.open}>pooja posted</span>}
            {!listing && pill && <span className="pill" style={{ background: pill.background, color: pill.color }}>{pill.label}</span>}
            {!listing && !pill && answers.length > 0 && (
              <span className="pill" style={{ background: 'var(--warning-bg)', color: 'var(--warning-fg)' }}>part answered</span>
            )}
            {!h.hasAddress && <span className="pill" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>no address</span>}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
            {h.phone || 'no number'}{h.pincode ? ` · ${h.pincode}` : ''}{h.address ? ` · ${h.address}` : ''}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {telHref(h.phone) && <a className="btn btn-ghost tap44" style={linkBtn} href={telHref(h.phone)}>Call</a>}
          {smsHref(h.phone) && <a className="btn btn-ghost tap44" style={linkBtn} href={smsHref(h.phone, ask)}>SMS</a>}
          {waHref(h.phone) && <a className="btn btn-ghost tap44" style={linkBtn} href={waHref(h.phone, ask)} target="_blank" rel="noreferrer">WhatsApp</a>}
          {/* Where the house actually is, without leaving to look it up by hand. */}
          {h.hasAddress && mapsHref([h.street, h.city, h.pincode]) && (
            <a className="btn btn-ghost tap44" style={linkBtn} target="_blank" rel="noreferrer"
              href={mapsHref([h.street, h.city, h.pincode])} title="Find this home on Google Maps">Map</a>
          )}
        </div>
      </div>

      {isCoordinator && !listing && (
        <div style={{ display: 'flex', gap: 7, marginTop: 11, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-primary tap44" disabled={busy} style={smallBtn}
            onClick={() => setMode(mode === 'confirm' ? null : 'confirm')}>They said yes</button>
          <button className="btn btn-ghost tap44" disabled={busy} style={smallBtn}
            onClick={() => act(async () => {
              for (const t of types) await recordOutreach({ date, type: t, personId: h.id, outcome: 'declined', by: me?.id })
            }, 'Marked: not this time.')}>
            Not this time
          </button>
          <button className="btn btn-ghost tap44" disabled={busy} style={smallBtn}
            onClick={() => act(async () => {
              for (const t of types) await recordOutreach({ date, type: t, personId: h.id, outcome: 'no_answer', by: me?.id })
            }, 'Marked: no answer.')}>
            No answer
          </button>
          <button className="btn btn-ghost tap44" disabled={busy} style={smallBtn}
            onClick={() => setMode(mode === 'address' ? null : 'address')}>
            {h.hasAddress ? 'Edit address' : 'Add address'}
          </button>

          {/* "Not this time" answers about one evening. This answers about being
              asked at all, and is why people were being rung again a fortnight
              later. Confirmed before it takes effect — it is a quiet button to
              press by accident and it removes them from every future list. */}
          {mode === 'optout' ? (
            <>
              <button className="btn btn-ghost tap44" disabled={busy} style={{ ...smallBtn, color: 'var(--danger-fg)' }}
                onClick={() => act(async () => {
                  await optOutOfHosting(h.id, { by: me?.id })
                  setMode(null)
                }, `Noted — we won't ask ${first} again.`)}>
                Yes, take them off the list
              </button>
              <button className="btn btn-ghost tap44" disabled={busy} style={smallBtn}
                onClick={() => setMode(null)}>Keep them</button>
            </>
          ) : (
            <button className="btn btn-ghost tap44" disabled={busy} style={smallBtn}
              title="They do not want to host at all — takes them off every future date, not just this one"
              onClick={() => setMode('optout')}>
              Rather not host
            </button>
          )}
        </div>
      )}

      {mode === 'address' && (
        <AddressEditor person={h} busy={busy}
          onCancel={() => setMode(null)}
          onSave={(patch) => act(async () => { await updatePersonAddress(h.id, patch); setMode(null) }, 'Address saved to their record.')} />
      )}

      {mode === 'confirm' && (
        <>
          {both && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <span style={label}>Both poojas fall on this day — which did they agree to?</span>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {[types, [types[0]], [types[1]]].map((opt) => {
                  const on = opt.join(',') === picked.join(',')
                  const text = opt.length > 1 ? 'Both, together' : POOJA_TYPES[opt[0]]?.label
                  return (
                    <button key={opt.join(',')} className={`btn ${on ? 'btn-primary' : 'btn-ghost'} tap44`} style={smallBtn}
                      disabled={busy} onClick={() => setPicked(opt)}>{text}</button>
                  )
                })}
              </div>
              {picked.length > 1 && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 7 }}>
                  One evening, one listing at their home — guests see a single pooja, not two.
                </div>
              )}
            </div>
          )}
          <ConfirmPanel holder={h} date={date} types={picked} centre={centre} busy={busy}
            onCancel={() => setMode(null)}
            onConfirm={(vals) => act(async () => {
              await confirmHost({ date, types: picked, person: h, ...vals, centerId: centre, by: me?.id })
              setMode(null)
            }, `Pooja posted at ${first}'s home.`)} />
        </>
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

function ConfirmPanel({ holder, date, types, centre, busy, onConfirm, onCancel }) {
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
            {types.map((t) => POOJA_TYPES[t]?.label).join(" + ")} · {fmtDate(date)}
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

function PostedPoojas({ me, isCoordinator, onToast, onCountsChanged }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [includePast, setIncludePast] = useState(false)
  const [openId, setOpenId] = useState(null)

  const load = useCallback(async () => {
    try { setErr(null); setRows(await listPoojas({ includePast })); onCountsChanged?.() }
    catch (e) { setErr(e.message || String(e)) }
  }, [includePast, onCountsChanged])
  useEffect(() => { load() }, [load])

  if (err) return <ErrorCard>{err}</ErrorCard>
  if (!rows) return <Loading />

  const waitingHere = rows.reduce((n, p) => n + (p.pending_count || 0), 0)

  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <select aria-label="Which poojas" style={filterSelect}
          value={includePast ? 'all' : 'upcoming'} onChange={(e) => setIncludePast(e.target.value === 'all')}>
          <option value="upcoming">Upcoming</option>
          <option value="all">All, including past</option>
        </select>
      </div>

      {/* One share for the whole list. A group gets told about the poojas that
          are on, not pooja-by-pooja — five separate messages is spam, and the
          volunteer would have to send them one at a time. */}
      {rows.length > 0 && <ShareAll rows={rows} onToast={onToast} />}

      {/* Guests only ever appear inside a pooja, so say plainly whether any are
          waiting rather than making someone expand rows to find out. */}
      {rows.length > 0 && (
        <div className="card" style={{
          padding: '10px 13px', marginBottom: 12, fontSize: 13,
          background: waitingHere ? 'var(--warning-bg)' : 'var(--panel)',
          color: waitingHere ? 'var(--warning-fg)' : 'var(--muted)',
          borderColor: waitingHere ? 'var(--border-strong)' : 'var(--border)',
        }}>
          {waitingHere > 0
            ? <><b>{waitingHere} guest{waitingHere === 1 ? '' : 's'} asking for a seat.</b> Open the pooja below to approve or decline — approving is what gives them the address.</>
            : 'No guests are waiting on a decision. Guests appear here when they request a seat from the public page.'}
        </div>
      )}

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

/**
 * Share every pooja on screen, in one message.
 *
 * Whatever the "Upcoming / All" filter is showing is what gets shared — what you
 * see is what the group gets. Cancelled poojas are dropped: nobody should be
 * invited to one.
 */
function ShareAll({ rows, onToast }) {
  const [text, setText] = useState(null)
  const live = rows.filter((p) => p.status !== 'cancelled')
  if (!live.length) return null

  const message = () => poojasMessage(live, {
    origin: window.location.origin + window.location.pathname.replace(/\/$/, ''),
  })

  const copy = async () => {
    const t = message()
    try {
      await navigator.clipboard.writeText(t)
      onToast?.('Copied — paste it into the group.')
      return
    } catch { /* fall through */ }
    try {
      const ta = document.createElement('textarea')
      ta.value = t
      ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      if (ok) { onToast?.('Copied — paste it into the group.'); return }
    } catch { /* fall through */ }
    setText(t)
    onToast?.('Could not reach the clipboard — copy the message below.')
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180, fontSize: 13, color: 'var(--muted)' }}>
          Share {live.length === 1 ? 'this pooja' : `all ${live.length} poojas`} with a group
        </div>
        <a className="btn btn-primary tap44" style={{ ...smallBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}
          href={`https://wa.me/?text=${encodeURIComponent(message())}`}
          target="_blank" rel="noreferrer" aria-label="Share to WhatsApp">
          <WhatsAppIcon />
          <span>Share on WhatsApp</span>
        </a>
        <button className="btn btn-ghost tap44" style={smallBtn} onClick={copy}
          title="Copy the message to paste anywhere">Copy</button>
      </div>
      {text && (
        <div style={{ marginTop: 10 }}>
          <textarea readOnly value={text} rows={10} onFocus={(e) => e.target.select()}
            aria-label="Message for the group" style={{ ...input, resize: 'vertical', fontSize: 12.5, lineHeight: 1.5 }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <button className="btn btn-ghost tap44" style={smallBtn} onClick={() => setText(null)}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}

function MapTab() {
  const [holders, setHolders] = useState(null)
  useEffect(() => {
    supabase.from('people')
      .select('id, full_name, phone, street, city, pincode')
      .or('has_sadhguru_sannidhi.eq.true,has_devi_yantra.eq.true')
      .then(({ data }) => setHolders((data || []).map((p) => ({ ...p, hasAddress: !!(p.street && p.street.trim()) }))))
  }, [])
  if (!holders) return <Loading label="Loading holders…" />
  if (!holders.length) return <Empty label="No holders on record yet — nothing to map." />
  return <HolderMap holders={holders} />
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
      {/* The whole header toggles. Hunting for a "Guests" button to read a row
          was the wrong shape — the row IS the thing you want to open. */}
      <div
        role="button" tabIndex={0} aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
        style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', cursor: 'pointer' }}
      >
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

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
          {/* No per-pooja share here — sharing is a list-level action (ShareAll),
              because a group is told about the poojas that are on, not one at a
              time. */}
          <span aria-hidden="true" style={{
            display: 'inline-block', fontSize: 12, color: 'var(--muted)', padding: '0 4px',
            transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-fast) ease',
          }}>▾</span>
        </div>
      </div>


      {expanded && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span><b>Address</b> (approved guests only): {pooja.address || <span style={{ color: 'var(--muted-2)' }}>not set — approved guests will see nothing</span>}</span>
              {mapsHref(pooja.address) && (
                <a className="btn btn-ghost tap44" style={linkBtn} target="_blank" rel="noreferrer"
                  href={mapsHref(pooja.address)}>Map</a>
              )}
            </div>
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
              <button className="btn btn-ghost tap44" style={smallBtn} disabled={busy || seatsDraft === String(pooja.seats)}
                onClick={() => act(() => setSeats(pooja.activity_id, Number(seatsDraft)), 'Seats updated.')}>Save</button>

              <span style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 4px' }} />

              <button className="btn btn-ghost tap44" style={smallBtn} disabled={busy} onClick={() => setAdding((v) => !v)}>＋ Guest</button>

              {pooja.status === 'open'
                ? <button className="btn btn-ghost tap44" style={smallBtn} disabled={busy} onClick={() => act(() => closePooja(pooja.activity_id), 'Closed — no new requests.')}>Stop requests</button>
                : pooja.status === 'closed'
                  ? <button className="btn btn-ghost tap44" style={smallBtn} disabled={busy} onClick={() => act(() => reopenPooja(pooja.activity_id), 'Open for requests again.')}>Reopen</button>
                  : null}

              {pooja.status !== 'cancelled' && (confirmCancel ? (
                <>
                  {/* Cancelling is the one irreversible thing here, so its
                      confirmation stays full-width words, not a small icon. */}
                  <button className="btn btn-ghost tap44" style={{ ...smallBtn, color: 'var(--danger-fg)' }} disabled={busy}
                    onClick={() => act(() => cancelPooja(pooja.activity_id), 'Cancelled. Ring the approved guests — nothing is sent automatically.')}>
                    Yes, cancel the pooja
                  </button>
                  <button className="btn btn-ghost tap44" style={smallBtn} disabled={busy} onClick={() => setConfirmCancel(false)}>Keep it</button>
                </>
              ) : (
                <button className="btn btn-ghost tap44" style={smallBtn} disabled={busy} onClick={() => setConfirmCancel(true)}>Cancel</button>
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
