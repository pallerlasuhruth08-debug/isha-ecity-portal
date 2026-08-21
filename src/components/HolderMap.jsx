import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

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
// THIS COMPONENT DOES NOT GEOCODE. It used to: it walked every holder without a
// pin and called Nominatim once a second from the browser. That failed twice
// over — the RLS policy on `person_geo` only let a full-access account write, so
// for an ordinary volunteer every result was silently discarded, and even where
// it worked it needed somebody to sit on this tab for two minutes. Addresses are
// now geocoded once, at the moment they are saved (see updatePersonAddress), so
// by the time the map opens the pins already exist. Drawing is all that is left.

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
// Electronic City, roughly — where the map opens before any pin is placed.
const EC = [12.8452, 77.6602]

// How far off a pin can be. A geocoder that only recognised the pincode has put
// the pin at the middle of a whole postal area, which is not where anybody
// lives — drawn as a circle so it never passes for a doorstep.
const SPREAD = { nominatim: 0, 'nominatim-area': 700, 'nominatim-pincode': 1800 }

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

export default function HolderMap({ holders }) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const [geo, setGeo] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    supabase.from('person_geo').select('person_id, lat, lng, source').then(({ data, error }) => {
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
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18, attribution: '© OpenStreetMap contributors',
        }).addTo(mapRef.current)
      }
      const map = mapRef.current
      if (layerRef.current) layerRef.current.remove()
      layerRef.current = L.layerGroup().addTo(map)

      // Several holders share one apartment complex, and everyone who could only
      // be placed by pincode shares one point exactly. Stacked markers hide each
      // other, so a point is drawn once and its popup names everybody on it.
      const spots = new Map()
      for (const h of holders || []) {
        const g = geo[h.id]
        if (!g) continue
        const key = `${g.lat.toFixed(5)},${g.lng.toFixed(5)},${g.source}`
        const spot = spots.get(key) || { lat: g.lat, lng: g.lng, source: g.source, people: [] }
        spot.people.push(h)
        spots.set(key, spot)
      }

      const pts = []
      for (const spot of spots.values()) {
        pts.push([spot.lat, spot.lng])
        const spread = SPREAD[spot.source] ?? 0
        // Name and number only. No address line — see the note at the top.
        const lines = spot.people
          .map((h) => `<b>${safe(h.full_name)}</b> · ${safe(h.phone || 'no number')}`)
          .join('<br/>')
        const note = spread
          ? `<br/><i>Somewhere in this circle — the address was only precise enough for the ${spot.source === 'nominatim-pincode' ? 'pincode' : 'locality'}.</i>`
          : ''
        if (spread) {
          L.circle([spot.lat, spot.lng], {
            radius: spread, color: '#b06a1f', weight: 1, fillColor: '#e8a04a', fillOpacity: 0.15,
          }).addTo(layerRef.current).bindPopup(lines + note)
        } else {
          L.marker([spot.lat, spot.lng]).addTo(layerRef.current).bindPopup(lines)
        }
      }
      if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 })
    }).catch((e) => setErr(e.message))
    return () => { alive = false }
  }, [geo, holders])

  useEffect(() => () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }, [])

  const all = holders || []
  const exact = geo ? all.filter((h) => geo[h.id] && !SPREAD[geo[h.id].source]).length : 0
  const rough = geo ? all.filter((h) => geo[h.id] && SPREAD[geo[h.id].source]).length : 0
  const noAddress = all.filter((h) => !h.hasAddress).length
  const unplaced = all.length - exact - rough - noAddress

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 3px' }}>Where the holders are</h3>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          {geo ? `${exact} placed at the building` : 'Loading pins…'}
          {rough > 0 && ` · ${rough} only to the neighbourhood`}
          {unplaced > 0 && ` · ${unplaced} the map could not find`}
          {noAddress > 0 && ` · ${noAddress} with no address yet`}
        </div>
      </div>
      {err && <div className="field-error" role="alert" style={{ marginBottom: 10 }}>{err}</div>}
      <div ref={boxRef} style={{ height: 420, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }} />
      <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 8, lineHeight: 1.5 }}>
        Volunteers only — guests never see this. Pins show a name and number; the address stays on the person's record.
        A shaded circle means the address was too vague to place exactly — the person is somewhere inside it, not at its centre.
      </div>
    </div>
  )
}
