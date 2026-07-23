import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { STAGE_PILL, initials, avatarFor, pill } from '../lib/ui'
import { Pad, ErrorCard, Loading, Empty, Checkbox, PagerPill } from '../components/View'
import { useTableSelection } from '../lib/useTableSelection'
import { useBreakpoint } from '../lib/useBreakpoint'
import { multiFieldOr, PEOPLE_SEARCH_FIELDS } from '../lib/searchFilter'
import MobileFilterSheet from '../components/MobileFilterSheet'
import CampaignForm from '../components/CampaignForm'
import PersonProfile from '../components/PersonProfile'
import AssignNurturerDialog from '../components/AssignNurturerDialog'
import { fetchActivityTypes } from '../lib/activityTypes'
import { addRecipientsToCampaign } from '../lib/campaignRecipients'

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

export default function Volunteers({ me, onToast, campaignDraft = null, onClearCampaignDraft, onDone, recipientDraft = null, onRecipientsDone }) {
  const { isPhone } = useBreakpoint()
  const [rows, setRows] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [fil, setFil] = useState({ stage: '', centre: '', ie: '', program: '', last: '', tag: '', event: '', atype: '', skill: '', nurt: '' })
  const [tagIds, setTagIds] = useState(null) // manual-tag filter -> person ids
  const [eventIds, setEventIds] = useState(null) // event filter -> person ids who attended that event
  const [atypeIds, setAtypeIds] = useState(null) // activity-type filter -> person ids who attended that type
  const [skillIds, setSkillIds] = useState(null) // skill filter -> person ids who have that skill
  const [coveredIds, setCoveredIds] = useState(null) // 'needs nurturer' -> person ids WITH an active nurturer (to exclude)

  const sel = useTableSelection()
  const reqSeq = useRef(0)
  const [showForm, setShowForm] = useState(false)
  const [showAssign, setShowAssign] = useState(false)
  const [assignIds, setAssignIds] = useState([])
  const [formIds, setFormIds] = useState([])
  const [resolving, setResolving] = useState(false)
  const [profileId, setProfileId] = useState(null)
  const [tagRow, setTagRow] = useState(null)
  const [tagInput, setTagInput] = useState('')

  const [opts, setOpts] = useState({ centres: [], ieYears: [], tags: [], atypes: [], skills: [], events: [] })

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    setPage(0)
    sel.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, fil])
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
      const [centres, ieRes, atypes, inUseRes, skillRows, eventsRes] = await Promise.all([
        supabase.from('centers').select('id, name').order('name'),
        supabase.from('people').select('ie_date').eq('is_volunteer', true).not('ie_date', 'is', null).order('ie_date', { ascending: true }).limit(1),
        fetchActivityTypes().catch(() => []),
        supabase.from('activity_types_in_use').select('id'),
        supabase.from('person_skills').select('skill:skills(id, label)').limit(5000),
        supabase.from('events_with_attendance').select('id, name, activity_date').order('activity_date', { ascending: false }),
      ])
      if (!alive) return
      // Only offer activity types that have captured ATTENDANCE — the rest can only
      // ever return an empty list, so they're hidden. (Team assignment isn't enough:
      // assigned people may not have shown up, so it's not who actually did it.)
      const inUse = new Set((inUseRes.data || []).map((r) => r.id))
      // Skill filter offers only skills actually assigned to someone.
      const skillMap = new Map()
      for (const r of skillRows.data || []) if (r.skill?.id) skillMap.set(r.skill.id, r.skill.label)
      const skills = [...skillMap.entries()].map(([v, label]) => ({ v, label })).sort((a, b) => a.label.localeCompare(b.label))
      const events = (eventsRes.data || []).map((e) => ({ v: e.id, label: e.name || 'Untitled event' }))
      const minYear = ieRes.data?.[0]?.ie_date ? new Date(ieRes.data[0].ie_date).getFullYear() : 2010
      const nowY = new Date().getFullYear()
      const ieYears = []
      for (let y = nowY; y >= minYear; y--) ieYears.push(String(y))
      setOpts((o) => ({ ...o, centres: (centres.data || []).filter((c) => c.name !== 'All Centers').map((c) => ({ v: c.id, label: c.name || c.id })), ieYears, atypes: (atypes || []).filter((t) => inUse.has(t.id)).map((t) => ({ v: t.id, label: t.label })), skills, events }))
      loadTagOptions()
    })()
    return () => {
      alive = false
    }
  }, [loadTagOptions])

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

  // Event filter -> person_ids who attended that event (attendance.activity_id).
  // When an activity type is ALSO chosen, scope to THAT type AT THIS event — so
  // "Guru Pooja + class support" means class support done at Guru Pooja, not
  // "attended Guru Pooja AND did class support at some other event".
  useEffect(() => {
    if (!fil.event) {
      setEventIds(null)
      return
    }
    let alive = true
    setEventIds('loading')
    let q = supabase.from('attendance').select('person_id').eq('activity_id', fil.event).not('person_id', 'is', null)
    if (fil.atype) q = q.eq('activity_type_id', fil.atype)
    q.then(({ data }) => {
      if (alive) setEventIds([...new Set((data || []).map((r) => r.person_id))])
    })
    return () => {
      alive = false
    }
  }, [fil.event, fil.atype])

  // Skill filter -> person_ids who have that skill (person_skills).
  useEffect(() => {
    if (!fil.skill) {
      setSkillIds(null)
      return
    }
    let alive = true
    setSkillIds('loading')
    supabase.from('person_skills').select('person_id').eq('skill_id', fil.skill).then(({ data }) => {
      if (alive) setSkillIds([...new Set((data || []).map((r) => r.person_id))])
    })
    return () => {
      alive = false
    }
  }, [fil.skill])

  // Activity-TYPE filter -> people whose ATTENDANCE was captured for that type
  // (people_for_activity_type = attendance only). Team assignment is deliberately
  // NOT counted: assigned volunteers may not have shown up (rosters get shuffled on
  // the day), so only recorded attendance proves they did the activity.
  useEffect(() => {
    if (!fil.atype) {
      setAtypeIds(null)
      return
    }
    let alive = true
    setAtypeIds('loading')
    supabase
      .rpc('people_for_activity_type', { p_type: fil.atype })
      .then(({ data }) => {
        if (alive) setAtypeIds([...new Set((data || []).map((r) => r.person_id))])
      })
    return () => {
      alive = false
    }
  }, [fil.atype])

  // 'Needs a nurturer' (unassigned OR orphaned) = people NOT in the set with an active
  // nurturer. Load the covered set (active assignment WITH a nurturer) to exclude.
  useEffect(() => {
    if (fil.nurt !== 'needs') { setCoveredIds(null); return }
    let alive = true
    setCoveredIds('loading')
    supabase.from('nurturing_assignments').select('cared_person_id').eq('active', true).not('nurturer_person_id', 'is', null).then(({ data }) => {
      if (alive) setCoveredIds([...new Set((data || []).map((r) => r.cared_person_id))])
    })
    return () => { alive = false }
  }, [fil.nurt])

  const applyFilters = useCallback(
    (q) => {
      if (Array.isArray(tagIds)) q = q.in('person_id', tagIds.length ? tagIds : [NIL])
      if (Array.isArray(eventIds)) q = q.in('person_id', eventIds.length ? eventIds : [NIL])
      if (Array.isArray(atypeIds)) q = q.in('person_id', atypeIds.length ? atypeIds : [NIL])
      if (Array.isArray(skillIds)) q = q.in('person_id', skillIds.length ? skillIds : [NIL])
      if (fil.nurt === 'needs' && Array.isArray(coveredIds) && coveredIds.length) q = q.not('person_id', 'in', `(${coveredIds.join(',')})`)
      if (fil.centre) q = q.eq('center_id', fil.centre)
      if (fil.ie) q = q.gte('ie_date', `${fil.ie}-01-01`).lte('ie_date', `${fil.ie}-12-31`)
      const PROG_COL = { ie: 'ie_date', bsp: 'bsp_date', shoonya: 'shoonya_date', samyama: 'samyama_date' }
      if (PROG_COL[fil.program]) q = q.not(PROG_COL[fil.program], 'is', null)
      if (fil.last === '30') q = q.gte('last_active_date', daysAgoISO(30))
      if (fil.last === '90') q = q.gte('last_active_date', daysAgoISO(90))
      if (fil.last === 'quiet') q = q.lt('last_active_date', daysAgoISO(90))
      const searchOr = multiFieldOr(debounced, PEOPLE_SEARCH_FIELDS) // name|phone|email|pincode, sanitized
      if (searchOr) q = q.or(searchOr)
      return q
    },
    [fil, debounced, tagIds, eventIds, atypeIds, skillIds, coveredIds],
  )

  const fetchAllIds = useCallback(async () => {
    const ids = []
    let from = 0
    const CHUNK = 1000
    for (let g = 0; g < 50; g++) {
      let q = applyFilters(supabase.from('volunteer_list').select('person_id'))
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
    if ((fil.tag && !Array.isArray(tagIds)) || (fil.event && !Array.isArray(eventIds)) || (fil.atype && !Array.isArray(atypeIds)) || (fil.skill && !Array.isArray(skillIds)) || (fil.nurt === 'needs' && !Array.isArray(coveredIds))) return
    const seq = ++reqSeq.current // cancel-in-flight: only the newest request applies
    try {
      let q = applyFilters(
        supabase.from('volunteer_list').select('id, person_id, status, languages, full_name, phone, pincode, area, center_id, ie_date, bsp_date, shoonya_date, samyama_date, last_active_date, tags, last_activity_at', { count: 'exact' }),
      )
      // Query-level sort over the FULL dataset: most-recent activity first (nulls last),
      // person_id as a stable tiebreak — so page 1 is globally most-recent.
      q = q
        .order('last_activity_at', { ascending: false, nullsFirst: false })
        .order('person_id', { ascending: true })
        .range(page * pageSize, page * pageSize + pageSize - 1)
      const { data, count, error } = await q
      if (error) throw error

      const mapped = (data || [])
        .filter((r) => r.id)
        .map((r) => {
          const isCore = (r.tags || []).includes('core_team')
          return {
            id: r.id,
            name: r.full_name || 'Unknown',
            phone: r.phone || '',
            stage: isCore ? 'Core Group' : STATUS_TO_STAGE[r.status] || 'New',
            programs: [r.ie_date && 'IE', r.bsp_date && 'BSP', r.shoonya_date && 'Shoonya', r.samyama_date && 'Samyama'].filter(Boolean),
            where: [r.area, r.pincode].filter(Boolean).join(' · ') || r.center_id || '—',
            last: lastActiveLabel(r.last_activity_at),
            attended: 0,
            derivedTags: [],
            manualTags: [],
            skills: [],
          }
        })

      const ids = mapped.map((m) => m.id)
      if (ids.length) {
        const [attRes, mtRes, skRes] = await Promise.all([
          supabase.from('attendance').select('person_id, atype:activity_types(label)').in('person_id', ids),
          supabase.from('manual_tags').select('person_id, tag').in('person_id', ids),
          supabase.from('person_skills').select('person_id, skill:skills(label)').in('person_id', ids),
        ])
        const att = {}
        for (const a of attRes.data || []) {
          const b = (att[a.person_id] ||= { count: 0, types: new Set() })
          b.count += 1
          const t = a.atype?.label
          if (t) b.types.add(t)
        }
        const mtags = {}
        for (const m of mtRes.data || []) (mtags[m.person_id] ||= []).push(m.tag)
        const sks = {}
        for (const s of skRes.data || []) { const l = s.skill?.label; if (l) (sks[s.person_id] ||= []).push(l) }
        for (const m of mapped) {
          const b = att[m.id]
          if (b) { m.attended = b.count; m.derivedTags = [...b.types] }
          m.manualTags = mtags[m.id] || []
          m.skills = sks[m.id] || []
        }
      }

      if (seq !== reqSeq.current) return // a newer search superseded this one
      setRows(mapped)
      setTotal(count ?? 0)
    } catch (e) {
      if (seq !== reqSeq.current) return
      setErr(e.message || String(e))
      setRows([])
    } finally {
      if (seq === reqSeq.current) setLoading(false)
    }
  }, [applyFilters, page, pageSize, fil.tag, fil.event, fil.atype, fil.skill, fil.nurt, tagIds, eventIds, atypeIds, skillIds, coveredIds])

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

  // Add-to-existing-campaign mode: resolve the selection to person ids and append them
  // to the campaign we arrived from (deduped), then return to that campaign.
  async function addSelectedToCampaign() {
    if (!recipientDraft || sel.count(total) === 0) return
    setResolving(true)
    try {
      const ids = await sel.resolveIds(fetchAllIds)
      const { added, skipped } = await addRecipientsToCampaign(recipientDraft.campaignId, ids)
      onToast(`Added ${added} to “${recipientDraft.campaignName}”${skipped ? ` · ${skipped} already in it` : ''}.`)
      sel.clear()
      onRecipientsDone?.()
    } catch (e) {
      onToast('Could not add: ' + (e.message || e))
    } finally {
      setResolving(false)
    }
  }

  async function openAssign() {
    if (sel.count(total) === 0) return
    setResolving(true)
    try {
      setAssignIds(await sel.resolveIds(fetchAllIds))
      setShowAssign(true)
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
    setFil({ stage: '', centre: '', ie: '', bsp: '', last: '', tag: '', event: '', atype: '', skill: '', nurt: '' })
    setSearch('')
  }
  const filterActive = !!(debounced || Object.values(fil).some(Boolean))
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const selCount = sel.count(total)
  const isFullySelected = sel.headerState(total) === 'all'

  // Header checkbox = stage 1 of two-stage select-all: selects/deselects the CURRENT
  // PAGE only. Stage 2 ("Select all N matching this filter") lives in the pagination pill.
  const pageIds = rows ? rows.map((r) => r.id) : []
  const pageSelectedCount = pageIds.filter((id) => sel.isSelected(id)).length
  const pageHeaderState = pageIds.length === 0 ? 'none' : pageSelectedCount === 0 ? 'none' : pageSelectedCount === pageIds.length ? 'all' : 'partial'
  const togglePage = () => (pageSelectedCount === pageIds.length && pageIds.length > 0 ? sel.deselectIds(pageIds) : sel.selectIds(pageIds))

  const selStyle ={ padding: isPhone ? '11px' : '8px 11px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12, fontFamily: 'inherit', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', minHeight: isPhone ? 44 : undefined, flex: isPhone ? '1 1 calc(50% - 4px)' : undefined }
  const selectDefs = [
    { k: 'program', all: 'All programmes', opts: [{ v: 'ie', label: 'Inner Engineering' }, { v: 'bsp', label: 'Bhava Spandana' }, { v: 'shoonya', label: 'Shoonya' }, { v: 'samyama', label: 'Samyama' }] },
    { k: 'event', all: 'Any event', opts: opts.events },
    { k: 'atype', all: 'Any activity type', opts: opts.atypes },
    { k: 'skill', all: 'Any skill', opts: opts.skills },
    { k: 'tag', all: 'Any tag', opts: opts.tags },
    { k: 'centre', all: 'All centres', opts: opts.centres },
    { k: 'ie', all: 'Any IE year', opts: opts.ieYears },
    { k: 'last', all: 'Active · any time', opts: [{ v: '30', label: 'Active · 30 days' }, { v: '90', label: 'Active · 90 days' }, { v: 'quiet', label: 'Quiet · 90+ days' }] },
    { k: 'nurt', all: 'Nurturer · any', opts: [{ v: 'needs', label: 'Needs a nurturer' }] },
  ]
  const grid = '34px 2fr 1.15fr 1.4fr 1.1fr 1.1fr 0.85fr'

  return (
    <Pad>
      {campaignDraft && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: 14, background: '#FBF1E4', borderColor: '#E7C9B8', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, color: 'var(--rust)', fontWeight: 600 }}>Building the call list for “{campaignDraft.eventName}” — select people, then Create campaign.</div>
          <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 12, padding: '5px 10px' }} onClick={() => onClearCampaignDraft && onClearCampaignDraft()}>Cancel</button>
        </div>
      )}
      {recipientDraft && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: 14, background: '#FBF1E4', borderColor: '#E7C9B8', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, color: 'var(--rust)', fontWeight: 600 }}>Adding volunteers to “{recipientDraft.campaignName}” — select people, then Add to campaign.</div>
          <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 12, padding: '5px 10px' }} onClick={() => onRecipientsDone && onRecipientsDone()}>Cancel</button>
        </div>
      )}
      <div style={{ marginBottom: 16, fontSize: 14, color: 'var(--muted)' }}>
        {loading ? 'Loading…' : (
          <>
            {total} volunteer{total === 1 ? '' : 's'}
            <span className="mobile-hide"> · click a row to open the profile; use checkboxes to build a campaign.</span>
          </>
        )}
      </div>

      {err && <ErrorCard>Couldn't load volunteers: {err}</ErrorCard>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid var(--border)', borderRadius: 9, padding: isPhone ? '11px 12px' : '8px 12px', minWidth: 190, flexBasis: isPhone ? '100%' : undefined }}>
          {Icon.search(15)}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone, email or pincode…" style={{ border: 'none', outline: 'none', fontSize: 14, fontFamily: 'inherit', background: 'transparent', width: '100%', color: 'var(--ink)' }} />
        </div>
        <MobileFilterSheet count={Object.values(fil).filter(Boolean).length}>
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
          {filterActive && <button onClick={clearFil} style={{ background: 'none', border: 'none', color: '#B85C1E', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Clear filters</button>}
        </MobileFilterSheet>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        {/* Header: grid column labels on desktop/tablet; a compact select-all
            bar on phone (there are no columns to label in card mode). Checkbox here
            selects only the CURRENT PAGE — "select all matching" lives in the pagination pill. */}
        {isPhone ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel)' }}>
            <Checkbox state={pageHeaderState} onClick={(e) => { e.stopPropagation(); togglePage() }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>{selCount > 0 ? `${selCount} selected` : 'Select this page'}</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, padding: '13px 20px', borderBottom: '1px solid var(--border)', fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700, background: 'var(--panel)', alignItems: 'center' }}>
            <Checkbox state={pageHeaderState} onClick={(e) => { e.stopPropagation(); togglePage() }} />
            <span>Volunteer</span>
            <span>Programmes</span>
            <span>Past activities</span>
            <span>Skill</span>
            <span>Where</span>
            <span>Attended</span>
          </div>
        )}

        {loading && <Loading label="Loading volunteers…" />}
        {!loading && rows.length === 0 && <Empty label="No volunteers match these filters." />}

        {!loading && isPhone &&
          rows.map((v, i) => (
            <div key={v.id} className="rowhover" onClick={() => setProfileId(v.id)} style={{ display: 'flex', gap: 12, padding: 14, borderBottom: '1px solid #F1E9DB', alignItems: 'flex-start', cursor: 'pointer', background: profileId === v.id ? '#FBF1E6' : undefined }}>
              <div style={{ paddingTop: 2, minHeight: 44, display: 'flex', alignItems: 'center' }}>
                <Checkbox state={sel.isSelected(v.id)} onClick={(e) => { e.stopPropagation(); sel.toggle(v.id) }} />
              </div>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(v.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.name}</div>
                </div>
                <div style={{ fontSize: 12, color: v.phone ? 'var(--muted)' : 'var(--red)', marginTop: 2 }}>{v.phone || 'No phone on record'}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>{v.where}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {v.attended > 0 ? <span style={{ color: '#4E7C3F', fontWeight: 600 }}>{v.attended} attended</span> : 'No attendance'} · {v.last}
                </div>
                {v.programs.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                    {v.programs.map((p) => (<span key={p} style={{ fontSize: 12, fontWeight: 600, color: '#6A4CA0', background: '#F0EAF7', padding: '2px 7px', borderRadius: 6 }}>{p}</span>))}
                  </div>
                )}
                {v.derivedTags.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                    {v.derivedTags.map((t) => (<span key={'d' + t} style={{ fontSize: 12, fontWeight: 600, color: '#7A5230', background: '#F3EADB', padding: '2px 7px', borderRadius: 6 }}>{t}</span>))}
                  </div>
                )}
                {v.skills.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                    {v.skills.map((s) => (<span key={s} style={{ fontSize: 12, fontWeight: 600, color: '#33507D', background: '#E7EEF7', padding: '2px 7px', borderRadius: 6 }}>{s}</span>))}
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                  {v.manualTags.map((t) => (<span key={'m' + t} style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: 'var(--rust)', padding: '2px 7px', borderRadius: 6 }}>{t}</span>))}
                  {tagRow === v.id ? (
                    <input autoFocus value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addRowTag(v.id); if (e.key === 'Escape') setTagRow(null) }} onBlur={() => addRowTag(v.id)} placeholder="tag…" style={{ width: 90, fontSize: 12, border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', outline: 'none' }} />
                  ) : (
                    <span onClick={() => { setTagRow(v.id); setTagInput('') }} title="Add tag" style={{ fontSize: 12, fontWeight: 700, color: '#B85C1E', cursor: 'pointer', border: '1px dashed #E2C9A8', borderRadius: 6, padding: '3px 8px' }}>＋ tag</span>
                  )}
                </div>
              </div>
            </div>
          ))}

        {!loading && !isPhone &&
          rows.map((v, i) => (
            <div key={v.id} className="rowhover" onClick={() => setProfileId(v.id)} style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, padding: '13px 20px', borderBottom: '1px solid #F1E9DB', alignItems: 'center', cursor: 'pointer', background: profileId === v.id ? '#FBF1E6' : undefined }}>
              <Checkbox state={sel.isSelected(v.id)} onClick={(e) => { e.stopPropagation(); sel.toggle(v.id) }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(v.name)}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.name}</div>
                  <div style={{ fontSize: 12, color: v.phone ? 'var(--muted)' : 'var(--red)', marginTop: 1 }}>{v.phone || 'No phone on record'}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                    {v.manualTags.map((t) => (<span key={'m' + t} style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: 'var(--rust)', padding: '2px 7px', borderRadius: 6 }}>{t}</span>))}
                    {tagRow === v.id ? (
                      <input autoFocus value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addRowTag(v.id); if (e.key === 'Escape') setTagRow(null) }} onBlur={() => addRowTag(v.id)} placeholder="tag…" style={{ width: 90, fontSize: 12, border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', outline: 'none' }} />
                    ) : (
                      <span onClick={() => { setTagRow(v.id); setTagInput('') }} title="Add tag" style={{ fontSize: 12, fontWeight: 700, color: '#B85C1E', cursor: 'pointer', border: '1px dashed #E2C9A8', borderRadius: 6, padding: '3px 8px' }}>＋ tag</span>
                    )}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignContent: 'flex-start' }}>
                {v.programs.length
                  ? v.programs.map((p) => (<span key={p} style={{ fontSize: 12, fontWeight: 600, color: '#6A4CA0', background: '#F0EAF7', padding: '2px 7px', borderRadius: 6 }}>{p}</span>))
                  : <span style={{ fontSize: 14, color: 'var(--muted-2)' }}>—</span>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignContent: 'flex-start' }}>
                {v.derivedTags.length
                  ? v.derivedTags.map((t) => (<span key={t} style={{ fontSize: 12, fontWeight: 600, color: '#7A5230', background: '#F3EADB', padding: '2px 7px', borderRadius: 6 }}>{t}</span>))
                  : <span style={{ fontSize: 14, color: 'var(--muted-2)' }}>—</span>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignContent: 'flex-start' }}>
                {v.skills.length
                  ? v.skills.map((s) => (<span key={s} style={{ fontSize: 12, fontWeight: 600, color: '#33507D', background: '#E7EEF7', padding: '2px 7px', borderRadius: 6 }}>{s}</span>))
                  : <span style={{ fontSize: 14, color: 'var(--muted-2)' }}>—</span>}
              </div>
              <div style={{ fontSize: 14, color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.where}</div>
              <div style={{ fontSize: 14, color: 'var(--muted)' }}>
                {v.attended > 0 ? <span style={{ color: '#4E7C3F', fontWeight: 600 }}>{v.attended} attended</span> : '—'}
                <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>{v.last}</div>
              </div>
            </div>
          ))}

      </div>
      {!loading && total > 0 && (
        <PagerPill page={page} pageCount={pageCount} onPage={setPage} pageSize={pageSize} onPageSize={setPageSize}
          selection={{
            count: selCount, total, isFullySelected, onSelectAll: sel.selectAllMatching, onClear: sel.clear,
            actions: [
              ...(recipientDraft ? [] : [{ label: 'Assign to nurturer', onClick: openAssign, disabled: resolving }]),
              { label: recipientDraft ? (resolving ? 'Adding…' : 'Add to campaign') : (resolving ? 'Preparing…' : 'Create campaign'), onClick: recipientDraft ? addSelectedToCampaign : openCampaign, disabled: resolving, primary: true },
            ],
          }} />
      )}

      {showForm && (
        <CampaignForm audience="volunteer" personIds={formIds} eventId={campaignDraft?.eventId || null}
          segmentLabel={campaignDraft ? `Recruiting for ${campaignDraft.eventName}` : formIds.length ? `${formIds.length} selected volunteers` : filterActive ? 'Filtered volunteers' : ''}
          onClose={() => setShowForm(false)} onToast={onToast}
          onCreated={() => { sel.clear(); if (campaignDraft) onDone?.() }} />
      )}
      {showAssign && (
        <AssignNurturerDialog personIds={assignIds} label="volunteers" me={me} onClose={() => setShowAssign(false)} onToast={onToast} onDone={() => { setShowAssign(false); sel.clear(); loadPage() }} />
      )}
      {profileId && (
        <PersonProfile personId={profileId} me={me} onClose={() => setProfileId(null)} onToast={onToast} onChanged={() => { loadPage(); loadTagOptions() }} />
      )}
    </Pad>
  )
}
