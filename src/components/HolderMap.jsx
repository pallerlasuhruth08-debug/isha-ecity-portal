import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { placeMissing, markAsked, clearPin } from '../lib/poojaHosts'

// Where the holders are. VOLUNTEER-ONLY — this screen is never reachable
// without a login, and no guest-facing page imports it.
//
// A pin at a house IS the address: anyone can read the location off the map and
// walk to the door. So the popup carries the person's name and number and
// nothing else — a volunteer already has the address on the person's record, and
// printing it here would only create a second place for it to leak from. If this
// map is ever wanted for guests, it has to become pincode-level, not exact.
//
// Coordinates live in `person_geo`, not in `people`, so they cannot ride along
// on a query that reaches a guest, and turning the map off means dropping one
// table.
//
// THIS COMPONENT DOES NOT GEOCODE IN BULK. It used to: it walked every holder
// without a pin and called a geocoder once a second from the browser. That
// failed twice over — the RLS policy on `person_geo` only let a full-access
// account write, so for an ordinary volunteer every result was silently
// discarded, and even where it worked it needed somebody to sit on this tab for
// two minutes. Addresses are geocoded once now, when they are saved (see
// updatePersonAddress), so the pins exist before the map opens.
//
// What remains here is the part no geocoder can do: a volunteer who knows the
// area putting a pin where the house actually is. Search by name of the
// apartment or layout, or just click the roof.

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
// Electronic City, roughly — where the map opens before any pin is placed, and
// the point every search is biased towards.
const EC = [12.8452, 77.6602]
// How wide "somewhere in Electronic City" is. Not a guess about one person —
// it is the whole area, and it is drawn that way so nobody mistakes it for one.
const EC_UNKNOWN = 4000

// Everything the geocoder is ever going to place, it places the first time it is
// asked. Re-asking on every page load would spend a minute a time to change
// nothing, so a miss has to be remembered — and there is nowhere to record one
// except `geocoded_at`, which a miss now stamps while leaving the placement
// alone. Rows written before this shipped carry an older stamp (or none), so
// this constant is the line between "never asked with this code" and "asked, and
// the answer was no". Move it only to force a re-sweep of everybody.
const SWEPT_AFTER = '2026-08-28T13:00:00Z'
const asked = (g) => !!(g?.geocoded_at && g.geocoded_at > SWEPT_AFTER)

// How far off a pin can be, in metres. `radius_m` on the row is the real answer
// where we have it — a BBMP ward is 450m to 1.5km across, a postal area three or
// four — and it is drawn as a circle so it never passes for a doorstep. The
// fallback is for older rows written before that column existed. Zero means a
// point: a building-level match, or a pin a volunteer placed by hand, which is
// the most trustworthy thing on this map.
const spreadOf = (g) => (
  g?.radius_m != null ? g.radius_m
    : /-pincode$/.test(g?.source || '') ? 1800
      : /-area$/.test(g?.source || '') ? 700 : 0
)

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L)
  return new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const l = document.createElement('link')
      l.rel = 'stylesheet'; l.href = LEAFLET_CSS
      document.head.appendChild(l)
    }
    let s = document.querySelector(`script[src="${LEAFLET_JS}"]`)
    if (!s) {
      s = document.createElement('script')
      s.src = LEAFLET_JS
      document.head.appendChild(s)
    }
    s.addEventListener('load', () => resolve(window.L))
    s.addEventListener('error', () => reject(new Error('Could not load the map library')))
    if (window.L) resolve(window.L)
  })
}

const safe = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))

// Photon: OpenStreetMap data behind a search-as-you-type engine, no API key.
// The lat/lon bias is why it is here rather than Nominatim — a bare name like
// "Sobha Silicon Oasis" has to resolve to the one near this centre.
async function searchPlaces(q) {
  const url = `https://photon.komoot.io/api/?limit=6&lat=${EC[0]}&lon=${EC[1]}&q=${encodeURIComponent(q)}`
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error('Search is not answering right now.')
  return ((await r.json())?.features || []).map((f) => {
    const [lng, lat] = f.geometry.coordinates
    const p = f.properties || {}
    return {
      lat, lng,
      label: [p.name, p.street, p.district, p.city, p.state].filter(Boolean).join(', '),
    }
  })
}

export default function HolderMap({ holders, onToast }) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const draftRef = useRef(null)
  const highlightRef = useRef(null)
  const fixingRef = useRef(null)
  const [geo, setGeo] = useState(null)
  const [err, setErr] = useState(null)
  const [fixing, setFixing] = useState(null)   // the holder whose pin is being set
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [draft, setDraft] = useState(null)     // {lat,lng} not yet saved
  const [saving, setSaving] = useState(false)
  const [bulk, setBulk] = useState(null)      // {done,total,placed} while the sweep runs
  const aliveRef = useRef(true)
  const sweptRef = useRef(false)
  const fittedRef = useRef(null)
  const geoRef = useRef(null)
  const holdersRef = useRef(null)
  const startFixingRef = useRef(null)
  useEffect(() => { geoRef.current = geo }, [geo])
  useEffect(() => { holdersRef.current = holders }, [holders])
  useEffect(() => () => { aliveRef.current = false }, [])

  useEffect(() => { fixingRef.current = fixing }, [fixing])

  useEffect(() => {
    let alive = true
    supabase.from('person_geo').select('person_id, lat, lng, source, radius_m, geocoded_at').then(({ data, error }) => {
      if (!alive) return
      if (error) { setErr(error.message); return }
      const m = {}
      for (const g of data || []) m[g.person_id] = g
      setGeo(m)
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!geo || !boxRef.current) return
    let alive = true
    loadLeaflet().then((L) => {
      if (!alive || !boxRef.current) return
      if (!mapRef.current) {
        mapRef.current = L.map(boxRef.current).setView(EC, 12)
        // Three ways of looking at the same streets, because placing a pin on
        // the right roof is a different job from seeing where people cluster.
        // All three are free and keyless; none of them is satellite, because no
        // sub-metre imagery is free to use without an account.
        //   Standard   — the most building detail, best for finding a block.
        //   Humanitarian — heavier on named landmarks and footpaths, which is
        //                  how these addresses are actually written ("behind
        //                  the CMC building", "opposite SBI").
        //   Muted      — labels and little else, for reading the badges when
        //                three of them overlap.
        const bases = {
          Standard: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19, attribution: '© OpenStreetMap contributors',
          }),
          Humanitarian: L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
            maxZoom: 19, attribution: '© OpenStreetMap contributors · style by Humanitarian OSM Team, hosted by OSM France',
          }),
          Muted: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            maxZoom: 19, attribution: '© OpenStreetMap contributors © CARTO',
          }),
        }
        bases.Standard.addTo(mapRef.current)
        L.control.layers(bases, null, { position: 'topright' }).addTo(mapRef.current)
        // Clicking the map only means anything while a pin is being set.
        mapRef.current.on('click', (e) => {
          if (!fixingRef.current) return
          setDraft({ lat: e.latlng.lat, lng: e.latlng.lng })
        })
        // Registered once, here. Hanging this off the redraw effect instead
        // added a fresh listener every time the centre filter changed.
        mapRef.current.on('popupclose', () => {
          if (highlightRef.current) { highlightRef.current.remove(); highlightRef.current = null }
        })
        // Popup content is an HTML string, so its button has to be wired when
        // the popup opens. Registered once, here, like the handler above.
        mapRef.current.on('popupopen', (e) => {
          const el = e.popup.getElement()
          if (!el) return
          for (const b of el.querySelectorAll('[data-fix]')) {
            b.addEventListener('click', () => {
              const h = (holdersRef.current || []).find((x) => String(x.id) === b.dataset.fix)
              if (h) { mapRef.current.closePopup(); startFixingRef.current?.(h) }
            })
          }
        })
      }
      const map = mapRef.current
      if (layerRef.current) layerRef.current.remove()
      if (highlightRef.current) { highlightRef.current.remove(); highlightRef.current = null }
      layerRef.current = L.layerGroup().addTo(map)

      // Several holders share one apartment complex, and everyone placed by
      // locality alone shares one point exactly. Stacked markers hide each
      // other, so a point is drawn once and its popup names everybody on it.
      const spots = new Map()
      const unplaced = []
      for (const h of holders || []) {
        const g = geo[h.id]
        if (!g) { unplaced.push(h); continue }
        const key = `${g.lat.toFixed(5)},${g.lng.toFixed(5)},${g.source}`
        const spot = spots.get(key) || { lat: g.lat, lng: g.lng, source: g.source, spread: spreadOf(g), people: [] }
        spot.people.push(h)
        spots.set(key, spot)
      }

      const pts = []
      for (const spot of spots.values()) {
        pts.push([spot.lat, spot.lng])
        const spread = spot.spread
        // Name and number only. No address line — see the note at the top.
        const lines = spot.people
          .map((h) => `<b>${safe(h.full_name)}</b> · ${safe(h.phone || 'no number')}`)
          .join('<br/>')

        if (!spread) {
          // A confirmed location. The ordinary pin means exactly one thing on
          // this map: somebody's home is here — which is why a wrong one has to
          // be challengeable from the pin itself. Until this button existed a
          // bad pin could not be removed by anybody: one holder sat sixty
          // kilometres east of Electronic City with no way to say so.
          const body = spot.people
            .map((h) => `<div style="margin:2px 0">${safe(h.full_name)} · ${safe(h.phone || 'no number')}`
              + ` <button data-fix="${safe(h.id)}" style="margin-left:4px;border:0;background:none;`
              + `color:#b06a1f;text-decoration:underline;cursor:pointer;font:inherit;font-size:11.5px">not here?</button></div>`)
            .join('')
          L.marker([spot.lat, spot.lng]).addTo(layerRef.current).bindPopup(body)
          continue
        }

        // Everyone else. Painting the extent as a filled circle was honest and
        // unreadable: four postal areas overlapping is a wash of orange with the
        // streets hidden underneath, and thirty-four people look the same as
        // three. So the default mark is a badge that says how many are in there
        // and, by being obviously not a pin, that nobody has said where. The
        // circle is still the truth — it is one click away, on the badge.
        const km = Math.round(spread * 2 / 100) / 10
        const n = spot.people.length
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:34px;height:34px;border-radius:50% 50% 50% 4px;transform:rotate(-45deg);
            border:2px dashed #b06a1f;background:rgba(232,160,74,.28);
            display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(60,40,20,.25)">
            <span style="transform:rotate(45deg);font:700 13px/1 system-ui,sans-serif;color:#7a4610">${n}</span>
          </div>`,
          iconSize: [34, 34], iconAnchor: [17, 32], popupAnchor: [0, -30],
        })
        const where = spot.source === 'pincode-area' ? 'postal area' : 'neighbourhood'
        const marker = L.marker([spot.lat, spot.lng], { icon }).addTo(layerRef.current)
          .bindPopup(`<i>${n} ${n === 1 ? 'holder' : 'holders'} somewhere in this ${km}km ${where} — not at this point.</i>
            <br/>Their addresses are on record; nobody has placed them yet.<br/><br/>${lines}`)
        marker.on('click', () => {
          if (highlightRef.current) highlightRef.current.remove()
          highlightRef.current = L.circle([spot.lat, spot.lng], {
            radius: spread, color: '#b06a1f', weight: 1, dashArray: '4 4',
            fillColor: '#e8a04a', fillOpacity: 0.12,
          }).addTo(map)
        })
      }
      // Everyone with no point at all: an address nothing could place, or no
      // address to place. They were a number in the caption and nothing on the
      // map, which let the map look finished while a third of the pool was
      // missing from it. Grey, not amber, because amber means "we know roughly"
      // and this means "nobody knows" — and over the whole of Electronic City,
      // which is honestly the extent of what is known.
      if (unplaced.length) {
        pts.push(EC)
        const n = unplaced.length
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:34px;height:34px;border-radius:50% 50% 50% 4px;transform:rotate(-45deg);
            border:2px dashed #6b7280;background:rgba(156,163,175,.30);
            display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(30,30,35,.22)">
            <span style="transform:rotate(45deg);font:700 13px/1 system-ui,sans-serif;color:#374151">${n}</span>
          </div>`,
          iconSize: [34, 34], iconAnchor: [17, 32], popupAnchor: [0, -30],
        })
        const lines = unplaced
          .map((h) => `<b>${safe(h.full_name)}</b> · ${safe(h.phone || 'no number')}`
            + ` — <i>${h.hasAddress ? 'address on record, nothing could place it' : 'no address on record'}</i>`)
          .join('<br/>')
        const marker = L.marker(EC, { icon }).addTo(layerRef.current)
          .bindPopup(`<i>${n} ${n === 1 ? 'holder' : 'holders'} somewhere in Electronic City — nobody knows where.</i>`
            + `<div style="max-height:170px;overflow:auto;margin-top:6px">${lines}</div>`)
        marker.on('click', () => {
          if (highlightRef.current) highlightRef.current.remove()
          highlightRef.current = L.circle(EC, {
            radius: EC_UNKNOWN, color: '#6b7280', weight: 1, dashArray: '4 4',
            fillColor: '#9ca3af', fillOpacity: 0.10,
          }).addTo(map)
        })
      }

      // Frame the pins ONCE for a given set of holders. This used to run on
      // every redraw, and the redraw runs once per person while the lookup
      // sweeps — so zooming in was undone a second later, over and over, and
      // the zoom button looked like it was zooming out. Changing the centre
      // filter hands down a new array, which is the one time a refit is wanted.
      if (pts.length && !fixingRef.current && fittedRef.current !== holders) {
        fittedRef.current = holders
        map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 })
      }
    }).catch((e) => setErr(e.message))
    return () => { alive = false }
  }, [geo, holders])

  // The pin being dragged into place. Separate from the drawn layer so that
  // moving it does not redraw ninety other markers.
  useEffect(() => {
    const L = window.L
    const map = mapRef.current
    if (!L || !map) return
    if (draftRef.current) { draftRef.current.remove(); draftRef.current = null }
    if (!draft) return
    draftRef.current = L.marker([draft.lat, draft.lng], { draggable: true, opacity: 0.85 })
      .addTo(map)
      .bindPopup('Drag me onto the house, then save.')
      .openPopup()
    draftRef.current.on('dragend', (e) => {
      const p = e.target.getLatLng()
      setDraft({ lat: p.lat, lng: p.lng })
    })
    map.setView([draft.lat, draft.lng], Math.max(map.getZoom(), 16))
  }, [draft])

  useEffect(() => () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }, [])

  const runSearch = useCallback(async (e) => {
    e?.preventDefault?.()
    const q = query.trim()
    if (q.length < 3) { setResults([]); return }
    setSearching(true); setErr(null)
    try { setResults(await searchPlaces(q)) }
    catch (ex) { setErr(ex.message) }
    finally { setSearching(false) }
  }, [query])

  const startFixing = useCallback((h) => {
    setFixing(h)
    setResults(null)
    setDraft(geo?.[h.id] ? { lat: geo[h.id].lat, lng: geo[h.id].lng } : null)
    // The address is the best possible search, and it is already on the record.
    setQuery([h.street, h.city].filter(Boolean).join(', ').slice(0, 120))
  }, [geo])

  // The map's popup handler is registered once and would otherwise close over
  // the first startFixing it ever saw.
  useEffect(() => { startFixingRef.current = startFixing }, [startFixing])

  const stopFixing = useCallback(() => {
    setFixing(null); setDraft(null); setResults(null); setQuery('')
  }, [])

  const savePin = useCallback(async () => {
    if (!fixing || !draft) return
    setSaving(true)
    const row = {
      person_id: fixing.id, lat: draft.lat, lng: draft.lng,
      // A hand-placed pin is a point. Clearing the radius is what turns the
      // circle into a marker — leaving it would keep drawing the old guess.
      source: 'manual', radius_m: null, geocoded_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('person_geo').upsert(row, { onConflict: 'person_id' })
    setSaving(false)
    if (error) { setErr('Could not save the pin: ' + error.message); return }
    setGeo((g) => ({ ...(g || {}), [fixing.id]: row }))
    onToast?.(`${fixing.full_name} is on the map.`)
    stopFixing()
  }, [fixing, draft, onToast, stopFixing])

  const removePin = useCallback(async () => {
    if (!fixing) return
    setSaving(true)
    try {
      await clearPin(fixing.id)
      setGeo((g) => { const n = { ...(g || {}) }; delete n[fixing.id]; return n })
      onToast?.(`${fixing.full_name}'s pin is gone. They are in the Electronic City circle until someone places them.`)
      stopFixing()
    } catch (e) { setErr('Could not remove the pin: ' + (e.message || e)) }
    finally { setSaving(false) }
  }, [fixing, onToast, stopFixing])

  // Ask the geocoder about every address that has never been through it. Almost
  // everyone here is in a ward or postal circle because the street line was
  // skipped and they were placed from the pincode alone — not because the
  // address is vague. One request a second, pins appear as they land, and
  // anything that does not resolve to a building keeps the circle it has.
  const runSweep = useCallback(async (list) => {
    setErr(null)
    setBulk({ done: 0, total: list.length, placed: 0 })
    try {
      const placed = await placeMissing(list, {
        alive: () => aliveRef.current,
        onProgress: async ({ done, total, placed: n, person, hit }) => {
          if (!aliveRef.current) return
          setBulk({ done, total, placed: n })
          const stamp = new Date().toISOString()
          if (hit) {
            setGeo((g) => ({ ...(g || {}), [person.id]: { lat: hit.lat, lng: hit.lng, source: hit.source, radius_m: hit.radius_m ?? null, geocoded_at: stamp } }))
            return
          }
          // A miss. Record that we asked, so tomorrow's page load does not ask
          // again — the whole point of doing this without a button.
          if (!geoRef.current?.[person.id]) return  // nothing to stamp; retried next session
          try { await markAsked(person.id) } catch { /* the circle is still right */ }
          if (aliveRef.current) setGeo((g) => ({ ...(g || {}), [person.id]: { ...g[person.id], geocoded_at: stamp } }))
        },
      })
      if (!aliveRef.current) return
      if (placed) onToast?.(`${placed} of ${list.length} placed at the building. The rest need someone who has been there.`)
    } catch (e) {
      // A refused write, not a miss. Say so: an earlier version of this swept
      // the whole list, had every result discarded by RLS, and looked fine.
      setErr(e.message || String(e))
    } finally {
      if (aliveRef.current) setBulk(null)
    }
  }, [onToast])

  // Run it on open, not on a button. Only people never asked with this code are
  // in the list, so the first load after this ships does one pass and every load
  // after it does nothing at all. The map is already drawn by the time this
  // starts — pins drop in behind it, and nothing waits on it.
  useEffect(() => {
    if (!geo || !holders || sweptRef.current) return
    const todo = holders.filter((h) => h.hasAddress && !asked(geo[h.id]) && (!geo[h.id] || spreadOf(geo[h.id])))
    if (!todo.length) return
    sweptRef.current = true
    runSweep(todo)
  }, [geo, holders, runSweep])

  const all = holders || []
  const exact = geo ? all.filter((h) => geo[h.id] && !spreadOf(geo[h.id])).length : 0
  const rough = geo ? all.filter((h) => geo[h.id] && spreadOf(geo[h.id])).length : 0
  const noAddress = all.filter((h) => !h.hasAddress).length
  const unplaced = all.length - exact - rough - noAddress

  // Who is worth a volunteer's minute: nobody has a pin, or the pin is only a
  // neighbourhood. Someone with no address at all needs a phone call, not a map.
  const needsPin = geo
    ? all.filter((h) => h.hasAddress && (!geo[h.id] || spreadOf(geo[h.id])))
      // Widest guess first: a four-kilometre circle is the one most worth a minute.
      .sort((a, b) => (spreadOf(geo[b.id]) || 1e9) - (spreadOf(geo[a.id]) || 1e9) || String(a.full_name).localeCompare(String(b.full_name)))
    : []

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 3px' }}>Where the holders are</h3>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          {geo ? `${exact} placed exactly` : 'Loading pins…'}
          {rough > 0 && ` · ${rough} only to the neighbourhood`}
          {unplaced + noAddress > 0 && ` · ${unplaced + noAddress} only "in Electronic City"`}
          {noAddress > 0 && ` (${noAddress} with no address at all)`}
        </div>
      </div>

      {err && <div className="field-error" role="alert" style={{ marginBottom: 10 }}>{err}</div>}

      {fixing && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, marginBottom: 12, background: 'var(--surface-2, #fafafa)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 8 }}>
            <strong style={{ fontSize: 14 }}>Placing {fixing.full_name}</strong>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              Search the apartment or layout, or click the roof on the map.
            </span>
          </div>
          <form onSubmit={runSearch} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Sobha Silicon Oasis, Electronic City"
              style={{ flex: 1, minWidth: 0, border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit' }}
            />
            <button type="submit" className="btn btn-ghost" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
          </form>
          {results && !results.length && (
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>
              Nothing found by that name. Click the house on the map instead — that works everywhere.
            </div>
          )}
          {results?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8, maxHeight: 150, overflowY: 'auto' }}>
              {results.map((r, i) => (
                <button key={i} type="button" className="btn btn-ghost"
                  onClick={() => setDraft({ lat: r.lat, lng: r.lng })}
                  style={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 12.5, padding: '7px 10px' }}>
                  {r.label}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={!draft || saving} onClick={savePin}>
              {saving ? 'Saving…' : draft ? 'Save this spot' : 'Pick a spot first'}
            </button>
            <button className="btn btn-ghost" onClick={stopFixing}>Cancel</button>
            {geo?.[fixing.id] && (
              <button className="btn btn-ghost" disabled={saving} onClick={removePin}
                style={{ marginLeft: 'auto', color: '#b3261e' }}
                title="Take this pin off the map — better nothing than a pin on the wrong house">
                Remove this pin
              </button>
            )}
          </div>
        </div>
      )}

      <div ref={boxRef} style={{ height: 420, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }} />

      {!fixing && needsPin.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>
            {needsPin.length} {needsPin.length === 1 ? 'holder is' : 'holders are'} not placed properly.
            The geocoder has already been asked about these and could not find them — a door number and a
            landmark is not something it can resolve. Someone who has been there can, in one click each.
          </div>
          {bulk && (
            <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginBottom: 8 }}>
              Looking up {bulk.done} of {bulk.total} in the background · {bulk.placed} placed.
              One a second — that is the geocoder&apos;s rule. Nothing here is waiting on it.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 190, overflowY: 'auto' }}>
            {needsPin.map((h) => (
              <div key={h.id} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', padding: '6px 2px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{h.full_name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {geo?.[h.id] ? `within ${Math.round(spreadOf(geo[h.id]) * 2 / 100) / 10}km` : 'no pin'} · {[h.street, h.city].filter(Boolean).join(', ')}
                  </div>
                </div>
                <button className="btn btn-ghost" onClick={() => startFixing(h)}>Place</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 8, lineHeight: 1.5 }}>
        Volunteers only — guests never see this. Pins show a name and number; the address stays on the person's record.
        A plain pin is a confirmed home. An amber dashed badge is a count of people whose address is on record but whose
        location nobody has confirmed — click it to see how wide that guess really is. A grey badge over Electronic City
        holds everyone with no location at all; click it for the list, and who among them still needs an address. Those extents are BBMP ward and
        postal-area boundaries from <a href="https://github.com/datameet" target="_blank" rel="noreferrer">DataMeet</a>, CC BY-SA 2.5 IN.
      </div>
    </div>
  )
}
