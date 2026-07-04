import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { STAGE_PILL, initials, avatarFor, pill } from '../lib/ui'
import { Pad, ErrorCard, Loading, Empty, Checkbox, PagerBar, SelectionBar } from '../components/View'
import { useTableSelection } from '../lib/useTableSelection'
import CampaignForm from '../components/CampaignForm'
import PersonProfile from '../components/PersonProfile'

const STAGE_TO_STATUS = { New: 'new', 'Reached out': 'contacted', Oriented: 'matched', Active: 'active' }
const STATUS_TO_STAGE = { new: 'New', contacted: 'Reached out', matched: 'Oriented', active: 'active', inactive: 'New' }

const lastActiveLabel = (d) => {
  if (!d) return '—'
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
const daysAgoISO = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)
const todayISO = () => new Date().toISOString().slice(0, 10)
const uniq = (a) => [...new Set(a.filter(Boolean))]
const NIL = '00000000-0000-0000-0000-000000000000'

export default function Volunteers({ onToast }) {
  const [rows, setRows] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [fil, setFil] = useState({ stage: '', lang: '', centre: '', ie: '', bsp: '', last: '', group: '', tag: '' })
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [progIds, setProgIds] = useState(null) // group filter -> person ids ('loading'|array|null)
  const [tagIds, setTagIds] = useState(null) // manual-tag filter -> person ids

  const sel = useTableSelection()
  const [showForm, setShowForm] = useState(false)
  const [formIds, setFormIds] = useState([])
  const [resolving, setResolving] = useState(false)
  const [profileId, setProfileId] = useState(null)
  const [tagRow, setTagRow] = useState(null)
  const [tagInput, setTagInput] = useState('')

  const [opts, setOpts] = useState({ centres: [], langs: [], ieYears: [], groups: [], tags: [] })
  const [groupMap, setGroupMap] = useState({}) // raw_value -> group_name
  const [rawValues, setRawValues] = useState([]) // distinct volunteer_history.activity

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    setPage(0)
    sel.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, fil, dateFrom, dateTo])
  useEffect(() => {
    setPage(0)
  }, [pageSize])

  const loadTagOptions = useCallback(async () => {
    const { data } = await supabase.from('manual_tags').select('tag').limit(4000)
    setOpts((o) => ({ ...o, tags: uniq((data || []).map((r) => r.tag)).sort() }))
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [centres, langsRes, ieRes, rawRes, agRes] = await Promise.all([
        supabase.from('centers').select('id, name').order('name'),
        supabase.from('volunteer_profiles').select('languages').not('languages', 'is', null).limit(2000),
        supabase.from('people').select('ie_date').eq('is_volunteer', true).not('ie_date', 'is', null).order('ie_date', { ascending: true }).limit(1),
        supabase.from('volunteer_history').select('activity').not('activity', 'is', null).limit(4000),
        supabase.from('activity_groups').select('raw_value, group_name'),
      ])
      if (!alive) return
      const langs = uniq((langsRes.data || []).map((r) => r.languages)).sort()
      const raws = uniq((rawRes.data || []).map((r) => r.activity))
      const map = Object.fromEntries((agRes.data || []).map((r) => [r.raw_value, r.group_name]))
      const groups = uniq(Object.values(map)).sort().concat('Uncategorized')
      const minYear = ieRes.data?.[0]?.ie_date ? new Date(ieRes.data[0].ie_date).getFullYear() : 2010
      const nowY = new Date().getFullYear()
      const ieYears = []
      for (let y = nowY; y >= minYear; y--) ieYears.push(String(y))
      setGroupMap(map)
      setRawValues(raws)
      setOpts((o) => ({ ...o, centres: (centres.data || []).map((c) => ({ v: c.id, label: c.name || c.id })), langs, ieYears, groups }))
      loadTagOptions()
    })()
    return () => {
      alive = false
    }
  }, [loadTagOptions])

  // Activity GROUP (+ optional date range) -> person_ids from volunteer_history.
  useEffect(() => {
    if (!fil.group) {
      setProgIds(null)
      return
    }
    let alive = true
    setProgIds('loading')
    const raws = fil.group === 'Uncategorized' ? rawValues.filter((r) => !groupMap[r]) : rawValues.filter((r) => groupMap[r] === fil.group)
    ;(async () => {
      if (!raws.length) {
        if (alive) setProgIds([])
        return
      }
      let q = supabase.from('volunteer_history').select('person_id').in('activity', raws)
      if (dateFrom) q = q.gte('happened_on', dateFrom)
      if (dateTo) q = q.lte('happened_on', dateTo)
      const { data } = await q
      if (alive) setProgIds([...new Set((data || []).map((r) => r.person_id))])
    })()
    return () => {
      alive = false
    }
  }, [fil.group, dateFrom, dateTo, groupMap, rawValues])

  // Manual-tag filter -> person_ids from manual_tags.
  useEffect(() => {
    if (!fil.tag) {
      setTagIds(null)
      return
    }
    let alive = true
    setTagIds('loading')
    supabase.from('manual_tags').select('person_id').eq('tag', fil.tag).then(({ data }) => {
      if (alive) setTagIds([...new Set((data || []).map((r) => r.person_id))])
    })
    return () => {
      alive = false
    }
  }, [fil.tag])

  const applyFilters = useCallback(
    (q) => {
      if (Array.isArray(progIds)) q = q.in('person_id', progIds.length ? progIds : [NIL])
      if (Array.isArray(tagIds)) q = q.in('person_id', tagIds.length ? tagIds : [NIL])
      if (fil.stage && STAGE_TO_STATUS[fil.stage]) q = q.eq('status', STAGE_TO_STATUS[fil.stage])
      if (fil.stage === 'Core Group') q = q.contains('people.tags', ['core_team'])
      if (fil.lang) q = q.eq('languages', fil.lang)
      if (fil.centre) q = q.eq('people.center_id', fil.centre)
      if (fil.ie) q = q.gte('people.ie_date', `${fil.ie}-01-01`).lte('people.ie_date', `${fil.ie}-12-31`)
      if (fil.bsp === 'done') q = q.not('people.bsp_date', 'is', null)
      if (fil.bsp === 'no') q = q.is('people.bsp_date', null)
      if (fil.last === '30') q = q.gte('people.last_active_date', daysAgoISO(30))
      if (fil.last === '90') q = q.gte('people.last_active_date', daysAgoISO(90))
      if (fil.last === 'quiet') q = q.lt('people.last_active_date', daysAgoISO(90))
      if (debounced) q = q.or(`full_name.ilike.%${debounced}%,pincode.ilike.%${debounced}%`, { referencedTable: 'people' })
      return q
    },
    [fil, debounced, progIds, tagIds],
  )

  const fetchAllIds = useCallback(async () => {
    const ids = []
    let from = 0
    const CHUNK = 1000
    for (let g = 0; g < 50; g++) {
      let q = applyFilters(supabase.from('volunteer_profiles').select('person_id, people!inner(id)'))
      q = q.order('person_id', { ascending: true }).range(from, from + CHUNK - 1)
      const { data, error } = await q
      if (error) throw error
      const batch = (data || []).map((r) => r.person_id)
      ids.push(...batch)
      if (batch.length < CHUNK) break
      from += CHUNK
    }
    return ids
  }, [applyFilters])

  const loadPage = useCallback(async () => {
    setLoading(true)
    setErr(null)
    if ((fil.group && !Array.isArray(progIds)) || (fil.tag && !Array.isArray(tagIds))) return
    try {
      let q = applyFilters(
        supabase.from('volunteer_profiles').select('person_id, status, languages, people!inner(id, full_name, phone, pincode, area, center_id, ie_date, bsp_date, last_active_date, tags)', { count: 'exact' }),
      )
      q = q.order('person_id', { ascending: true }).range(page * pageSize, page * pageSize + pageSize - 1)
      const { data, count, error } = await q
      if (error) throw error

      const mapped = (data || [])
        .filter((r) => r.people)
        .map((r) => {
          const p = r.people
          const isCore = (p.tags || []).includes('core_team')
          return {
            id: p.id,
            name: p.full_name || 'Unknown',
            phone: p.phone || '',
            stage: isCore ? 'Core Group' : STATUS_TO_STAGE[r.status] || 'New',
            programs: [p.ie_date && 'IE', p.bsp_date && 'BSP'].filter(Boolean).join(' · ') || '—',
            where: [p.area, p.pincode].filter(Boolean).join(' · ') || p.center_id || '—',
            last: lastActiveLabel(p.last_active_date),
            attended: 0,
            derivedTags: [],
            manualTags: [],
          }
        })

      const ids = mapped.map((m) => m.id)
      if (ids.length) {
        const [attRes, mtRes] = await Promise.all([
          supabase.from('attendance').select('person_id, activities!attendance_activity_id_fkey(activity_type)').in('person_id', ids),
          supabase.from('manual_tags').select('person_id, tag').in('person_id', ids),
        ])
        const att = {}
        for (const a of attRes.data || []) {
          const b = (att[a.person_id] ||= { count: 0, types: new Set() })
          b.count += 1
          const t = a.activities?.activity_type
          if (t && t !== 'general') b.types.add(t)
        }
        const mtags = {}
        for (const m of mtRes.data || []) (mtags[m.person_id] ||= []).push(m.tag)
        for (const m of mapped) {
          const b = att[m.id]
          if (b) { m.attended = b.count; m.derivedTags = [...b.types] }
          m.manualTags = mtags[m.id] || []
        }
      }

      setRows(mapped)
      setTotal(count ?? 0)
    } catch (e) {
      setErr(e.message || String(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [applyFilters, page, pageSize, fil.group, fil.tag, progIds, tagIds])

  useEffect(() => {
    loadPage()
  }, [loadPage])

  async function openCampaign() {
    if (sel.count(total) === 0) { setFormIds([]); setShowForm(true); return }
    setResolving(true)
    try {
      setFormIds(await sel.resolveIds(fetchAllIds))
      setShowForm(true)
    } catch (e) {
      onToast('Could not resolve selection: ' + (e.message || e))
    } finally {
      setResolving(false)
    }
  }

  async function addRowTag(id) {
    const tag = tagInput.trim()
    if (!tag) { setTagRow(null); return }
    setTagInput('')
    setTagRow(null)
    const { error } = await supabase.from('manual_tags').insert({ person_id: id, tag })
    if (error) return onToast(error.message.includes('duplicate') ? 'Tag already exists.' : 'Could not add tag.')
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, manualTags: uniq([...r.manualTags, tag]) } : r)))
    onToast(`Tag "${tag}" added.`)
    loadTagOptions()
  }

  const setF = (k) => (e) => setFil((f) => ({ ...f, [k]: e.target.value }))
  const clearFil = () => {
    setFil({ stage: '', lang: '', centre: '', ie: '', bsp: '', last: '', group: '', tag: '' })
    setSearch(''); setDateFrom(''); setDateTo('')
  }
  const filterActive = !!(debounced || Object.values(fil).some(Boolean) || dateFrom || dateTo)
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const selCount = sel.count(total)

  const preset = (kind) => () => {
    if (kind === 'year') { setDateFrom(`${new Date().getFullYear()}-01-01`); setDateTo(todayISO()) }
    else if (kind === '6mo') { setDateFrom(daysAgoISO(182)); setDateTo(todayISO()) }
    else if (kind === '30d') { setDateFrom(daysAgoISO(30)); setDateTo(todayISO()) }
    else { setDateFrom(''); setDateTo('') }
  }

  const selStyle = { padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer' }
  const selectDefs = [
    { k: 'stage', all: 'All stages', opts: ['New', 'Reached out', 'Oriented', 'Active', 'Core Group'] },
    { k: 'group', all: 'Any activity group', opts: opts.groups },
    { k: 'tag', all: 'Any tag', opts: opts.tags },
    { k: 'lang', all: 'Any language', opts: opts.langs },
    { k: 'centre', all: 'All centres', opts: opts.centres },
    { k: 'ie', all: 'Any IE year', opts: opts.ieYears },
    { k: 'bsp', all: 'BSP · any', opts: [{ v: 'done', label: 'BSP completed' }, { v: 'no', label: 'No BSP yet' }] },
    { k: 'last', all: 'Active · any time', opts: [{ v: '30', label: 'Active · 30 days' }, { v: '90', label: 'Active · 90 days' }, { v: 'quiet', label: 'Quiet · 90+ days' }] },
  ]
  const grid = '34px 2.3fr 1.1fr 1fr 1.3fr 0.9fr'

  return (
    <Pad>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 3px' }}>Volunteers</h2>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          {loading ? 'Loading…' : `${total} total · click a row to open the profile; use checkboxes to build a campaign.`}
        </div>
      </div>

      {err && <ErrorCard>Couldn't load volunteers: {err}</ErrorCard>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 12px', minWidth: 190 }}>
          {Icon.search(15)}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or pincode…" style={{ border: 'none', outline: 'none', fontSize: 13, fontFamily: 'inherit', background: 'transparent', width: '100%', color: 'var(--ink)' }} />
        </div>
        {selectDefs.map((d) => (
          <select key={d.k} value={fil[d.k]} onChange={setF(d.k)} style={selStyle}>
            <option value="">{d.all}</option>
            {d.opts.map((o) => {
              const v = typeof o === 'string' ? o : o.v
              const label = typeof o === 'string' ? o : o.label
              return <option key={v} value={v}>{label}</option>
            })}
          </select>
        ))}
        {filterActive && <button onClick={clearFil} style={{ background: 'none', border: 'none', color: '#B85C1E', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Clear filters</button>}
      </div>

      {/* Date constraint — only meaningful once an activity group is chosen */}
      {fil.group && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12, background: '#FBF6EC', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{fil.group} performed:</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={selStyle} />
          <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>to</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={selStyle} />
          <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={preset('year')}>This year</button>
          <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={preset('6mo')}>Last 6 months</button>
          <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={preset('30d')}>Last 30 days</button>
          <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={preset('all')}>All time</button>
        </div>
      )}

      <SelectionBar isAllMode={sel.isAllMode} count={selCount} onCreate={openCampaign} onClear={sel.clear} />

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, padding: '13px 20px', borderBottom: '1px solid var(--border)', fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700, background: 'var(--panel)', alignItems: 'center' }}>
          <Checkbox state={sel.headerState(total)} onClick={(e) => { e.stopPropagation(); selCount > 0 ? sel.clear() : sel.selectAllMatching() }} />
          <span>Volunteer</span>
          <span>Stage</span>
          <span>Programmes</span>
          <span>Where</span>
          <span>Attended</span>
        </div>

        {loading && <Loading label="Loading volunteers…" />}
        {!loading && rows.length === 0 && <Empty label="No volunteers match these filters." />}

        {!loading &&
          rows.map((v, i) => (
            <div key={v.id} className="rowhover" onClick={() => setProfileId(v.id)} style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, padding: '13px 20px', borderBottom: '1px solid #F1E9DB', alignItems: 'center', cursor: 'pointer', background: profileId === v.id ? '#FBF1E6' : undefined }}>
              <Checkbox state={sel.isSelected(v.id)} onClick={(e) => { e.stopPropagation(); sel.toggle(v.id) }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{initials(v.name)}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.name}</div>
                  <div style={{ fontSize: 11.5, color: v.phone ? 'var(--muted)' : '#B5532F', marginTop: 1 }}>{v.phone || 'No phone on record'}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                    {v.manualTags.map((t) => (<span key={'m' + t} style={{ fontSize: 10.5, fontWeight: 600, color: '#fff', background: '#9C4A14', padding: '2px 7px', borderRadius: 6 }}>{t}</span>))}
                    {v.derivedTags.filter((d) => !v.manualTags.includes(d)).map((t) => (<span key={'d' + t} style={{ fontSize: 10.5, fontWeight: 600, color: '#7A5230', background: '#F3EADB', padding: '2px 7px', borderRadius: 6 }}>{t}</span>))}
                    {tagRow === v.id ? (
                      <input autoFocus value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addRowTag(v.id); if (e.key === 'Escape') setTagRow(null) }} onBlur={() => addRowTag(v.id)} placeholder="tag…" style={{ width: 80, fontSize: 10.5, border: '1px solid var(--border)', borderRadius: 6, padding: '1px 5px', outline: 'none' }} />
                    ) : (
                      <span onClick={() => { setTagRow(v.id); setTagInput('') }} title="Add tag" style={{ fontSize: 10.5, fontWeight: 700, color: '#B85C1E', cursor: 'pointer', border: '1px dashed #E2C9A8', borderRadius: 6, padding: '1px 6px' }}>＋ tag</span>
                    )}
                  </div>
                </div>
              </div>
              <div><span className="pill" style={STAGE_PILL[v.stage] || pill('#F1EADD', '#8C7E6B')}>{v.stage}</span></div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{v.programs}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.where}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                {v.attended > 0 ? <span style={{ color: '#4E7C3F', fontWeight: 600 }}>{v.attended} attended</span> : '—'}
                <div style={{ fontSize: 11, color: 'var(--muted-2)' }}>{v.last}</div>
              </div>
            </div>
          ))}

        {!loading && total > 0 && <PagerBar page={page} pageCount={pageCount} total={total} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />}
      </div>

      {showForm && (
        <CampaignForm audience="volunteer" personIds={formIds} segmentLabel={formIds.length ? `${formIds.length} selected volunteers` : filterActive ? 'Filtered volunteers' : ''} onClose={() => setShowForm(false)} onToast={onToast} onCreated={() => sel.clear()} />
      )}
      {profileId && (
        <PersonProfile personId={profileId} onClose={() => setProfileId(null)} onToast={onToast} onChanged={() => { loadPage(); loadTagOptions() }} />
      )}
    </Pad>
  )
}
