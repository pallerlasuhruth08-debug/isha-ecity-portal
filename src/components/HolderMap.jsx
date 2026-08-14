import { useCallback, useEffect, useRef, useState } from 'react'
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

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
// Electronic City, roughly — where the map opens before any pin is placed.
const EC = [12.8452, 77.6602]

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

// OpenStreetMap's geocoder: no API key, and it is the only third party any of
// this touches. One request per second is its published limit, hence the wait.
async function geocodeOne(person) {
  const q = [person.street, person.city, person.pincode, 'India'].filter(Boolean).join(', ')
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q)
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) return null
  const j = await r.json()
  if (!j?.length) return null
  return { lat: Number(j[0].lat), lng: Number(j[0].lon) }
}

export default function HolderMap({ holders, onToast }) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const [geo, setGeo] = useState(null)
  const [placing, setPlacing] = useState(false)
  const [err, setErr] = useState(null)

  const withAddress = (holders || []).filter((h) => h.hasAddress)

  useEffect(() => {
    let alive = true
    supabase.from('person_geo').select('person_id, lat, lng').then(({ data, error }) => {
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

      const pts = []
      for (const h of holders || []) {
        const g = geo[h.id]
        if (!g) continue
        pts.push([g.lat, g.lng])
        // Name and number only. No address line — see the note at the top.
        const safe = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
        L.marker([g.lat, g.lng]).addTo(layerRef.current)
          .bindPopup(`<b>${safe(h.full_name)}</b><br/>${safe(h.phone || 'no number')}`)
      }
      if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 })
    }).catch((e) => setErr(e.message))
    return () => { alive = false }
  }, [geo, holders])

  useEffect(() => () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }, [])

  const placeMissing = useCallback(async () => {
    const missing = withAddress.filter((h) => !geo?.[h.id])
    if (!missing.length) { onToast?.('Every holder with an address is already on the map.'); return }
    setPlacing(true)
    let done = 0
    try {
      for (const h of missing) {
        const hit = await geocodeOne(h)
        if (hit) {
          const { error } = await supabase.from('person_geo').upsert({
            person_id: h.id, lat: hit.lat, lng: hit.lng, source: 'nominatim', geocoded_at: new Date().toISOString(),
          }, { onConflict: 'person_id' })
          if (!error) { setGeo((g) => ({ ...(g || {}), [h.id]: hit })); done++ }
        }
        // Nominatim asks for no more than one request a second. Honour it.
        await new Promise((res) => setTimeout(res, 1100))
      }
      onToast?.(`${done} of ${missing.length} placed on the map.`)
    } catch (e) {
      onToast?.('Could not finish placing: ' + (e.message || e))
    } finally { setPlacing(false) }
  }, [withAddress, geo, onToast])

  const placed = geo ? Object.keys(geo).length : 0
  const missing = withAddress.filter((h) => !geo?.[h.id]).length
  const noAddress = (holders || []).length - withAddress.length

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 3px' }}>Where the holders are</h3>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {placed} on the map · {missing} with an address still to place
            {noAddress > 0 && ` · ${noAddress} with no address yet`}
          </div>
        </div>
        <button className="btn btn-ghost" disabled={placing || !missing} onClick={placeMissing}>
          {placing ? 'Placing…' : `Place ${missing} on the map`}
        </button>
      </div>
      {err && <div className="field-error" role="alert" style={{ marginBottom: 10 }}>{err}</div>}
      <div ref={boxRef} style={{ height: 420, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }} />
      <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 8, lineHeight: 1.5 }}>
        Volunteers only — guests never see this. Pins show a name and number; the address stays on the person's record.
        Placing sends the address to OpenStreetMap's geocoder once, then it is remembered.
      </div>
    </div>
  )
}
