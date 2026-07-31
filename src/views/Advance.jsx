import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePagedQuery, fetchAllMatchingIds } from '../lib/usePagedQuery'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { pill, initials, avatarFor } from '../lib/ui'
import { Pad, ErrorCard, Loading, Empty, Chip, Checkbox, Pager } from '../components/View'
import { useTableSelection } from '../lib/useTableSelection'
import { useBreakpoint } from '../lib/useBreakpoint'
import CampaignForm from '../components/CampaignForm'
import PersonProfile from '../components/PersonProfile'

const PROGRAMS = [
  { key: 'bsp', label: 'Bhava Spandana', tone: '#3D6E60' },
  { key: 'shoonya', label: 'Shoonya', tone: '#2F6E5E' },
  { key: 'samyama', label: 'Samyama', tone: '#9C4A14' },
  { key: 'guru_puja', label: 'Guru Puja', tone: '#7A5230' },
]
const FUNNEL = [
  { key: 'new', label: 'Interested' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'registered', label: 'Registered' },
  { key: 'done', label: 'Done' },
]
const STATUS_PILL = {
  new: pill('var(--info-bg)', 'var(--info-fg)'),
  contacted: pill('var(--pill-warm-bg)', 'var(--pill-warm-fg)'),
  registered: pill('var(--success-bg)', 'var(--success-fg)'),
  done: pill('var(--neutral-bg)', 'var(--neutral-fg)'),
  dropped: pill('var(--danger-bg)', 'var(--danger-fg)'),
}
function ago(d) {
  if (!d) return '—'
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days < 30) return `${days}d ago`
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default function Advance({ me, onToast }) {
  const { isPhone } = useBreakpoint()
  const [prog, setProg] = useState('bsp')
  const [summary, setSummary] = useState([]) // {program, status} for all rows (small table)
  const [busy, setBusy] = useState(null)
  const sel = useTableSelection()
  const [showForm, setShowForm] = useState(false)
  const [formIds, setFormIds] = useState([])
  const [resolving, setResolving] = useState(false)
  const [profileId, setProfileId] = useState(null)

  // small summary for tab totals + funnel (advanced_interest is a small table)
  useEffect(() => {
    supabase.from('advanced_interest').select('program, status').then(({ data }) => setSummary(data || []))
  }, [])

  // One person can register interest in the same programme twice, so the id walk
  // is deduped before it becomes a campaign audience.
  const fetchAllIds = useCallback(
    async () => [...new Set(await fetchAllMatchingIds(
      () => supabase.from('advanced_interest').select('person_id').eq('program', prog),
      'person_id',
    ))],
    [prog],
  )

  const buildPage = useCallback(
    () => supabase
      .from('advanced_interest')
      .select('id, person_id, program, status, interest_date, source, person:people!advanced_interest_person_id_fkey(full_name, phone)', { count: 'exact' })
      .eq('program', prog)
      .order('interest_date', { ascending: false }),
    [prog],
  )

  const { rows, total, page, pageSize, loading, err, setPage, setPageSize, setRows, pageCount, reload: loadPage } =
    usePagedQuery(buildPage)

  // A new programme is a new list: back to page 1, selection dropped. (Rows-per-page
  // resets the page inside usePagedQuery, so it is not repeated here.)
  useEffect(() => {
    setPage(0)
    sel.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prog, setPage])

  const counts = useMemo(() => {
    const c = {}
    for (const r of summary) if (r.program === prog) c[r.status] = (c[r.status] || 0) + 1
    return c
  }, [summary, prog])
  const progTotals = useMemo(() => {
    const t = {}
    for (const r of summary) t[r.program] = (t[r.program] || 0) + 1
    return t
  }, [summary])

  async function markContacted(r) {
    setBusy(r.id)
    try {
      const { error } = await supabase.from('advanced_interest').update({ status: 'contacted' }).eq('id', r.id)
      if (error) throw error
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: 'contacted' } : x)))
      setSummary((prev) => prev.concat()) // noop keep ref; recompute not critical
      onToast(`${r.person?.full_name || 'Contact'} marked contacted.`)
    } catch (e) {
      onToast('Could not update: ' + (e.message || e))
    } finally {
      setBusy(null)
    }
  }

  async function openCampaign() {
    if (sel.count(total) === 0) {
      setFormIds([])
      setShowForm(true)
      return
    }
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

  const cur = PROGRAMS.find((p) => p.key === prog)
  const selCount = sel.count(total)
  const grid = '34px 2fr 1.2fr 1fr 0.9fr 1fr'

  return (
    <Pad>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
        <p className="mobile-hide" style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)', maxWidth: 560 }}>
          Bhava Spandana, Shoonya, Samyama &amp; Guru Puja — track interest through to registration.
        </p>
        {/* On mobile this becomes the sticky bottom CTA below instead of wrapping to two lines here.
            Both are hidden while a selection is active — the pagination pill's own
            Create-campaign action takes over then. */}
        {!isPhone && selCount === 0 && <button className="btn" disabled={resolving} onClick={openCampaign}>{Icon.campaigns(16)} {resolving ? 'Preparing…' : 'Create campaign'}</button>}
      </div>
      {err && <ErrorCard>Couldn't load advance programmes: {err}</ErrorCard>}

      <div className="scroll-tabs" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {PROGRAMS.map((p) => (<Chip key={p.key} on={prog === p.key} label={p.label} count={progTotals[p.key] || 0} onClick={() => setProg(p.key)} />))}
      </div>

      <div className={isPhone ? undefined : 'dash-grid'} style={{ display: 'grid', gridTemplateColumns: isPhone ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {FUNNEL.map((f) => (
          <div key={f.key} className="card" style={{ padding: 18 }}>
            <div style={{ fontFamily: "'Newsreader',serif", fontSize: 28, fontWeight: 600, lineHeight: 1, color: cur.tone }}>{counts[f.key] || 0}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 6 }}>{f.label}</div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 12px' }}>{cur.label} — {total} candidate{total === 1 ? '' : 's'}</h3>

      <div className="card" style={{ overflow: 'hidden' }}>
        {isPhone ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
            <Checkbox state={sel.headerState(total)} onClick={() => (selCount > 0 ? sel.clear() : sel.selectAllMatching())} />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--muted)' }}>{selCount > 0 ? `${selCount} selected` : 'Select all'}</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '13px 20px', background: 'var(--panel)', borderBottom: '1px solid var(--border)', fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700, alignItems: 'center' }}>
            <Checkbox state={sel.headerState(total)} onClick={() => (selCount > 0 ? sel.clear() : sel.selectAllMatching())} />
            <span>Person</span>
            <span>Phone</span>
            <span>Added</span>
            <span>Status</span>
            <span>Action</span>
          </div>
        )}
        {loading && <Loading label="Loading…" />}
        {!loading && rows.length === 0 && <Empty label="No interest recorded for this programme yet." />}

        {!loading && isPhone &&
          rows.map((r, i) => (
            <div key={r.id} className="rowhover" onClick={() => r.person_id && setProfileId(r.person_id)} style={{ display: 'flex', gap: 12, padding: 14, borderBottom: '1px solid #F1E9DB', alignItems: 'flex-start', cursor: 'pointer', background: profileId === r.person_id ? '#FBF1E6' : undefined }}>
              <div style={{ minHeight: 44, display: 'flex', alignItems: 'center' }}>
                <Checkbox state={sel.isSelected(r.person_id)} onClick={(e) => { e.stopPropagation(); sel.toggle(r.person_id) }} />
              </div>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{initials(r.person?.full_name || '?')}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.person?.full_name || 'Unknown'}</div>
                  <span className="pill" style={STATUS_PILL[r.status] || STATUS_PILL.new}>{r.status}</span>
                </div>
                <div style={{ fontSize: 12.5, color: r.person?.phone ? 'var(--muted)' : '#B5532F', marginTop: 2 }}>{r.person?.phone || 'No phone'}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Added {ago(r.interest_date)}</div>
                {r.status === 'new' && (
                  <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 8 }}>
                    <button className="btn btn-ghost" disabled={busy === r.id} style={{ padding: '9px 14px', fontSize: 12.5, minHeight: 40 }} onClick={() => markContacted(r)}>{busy === r.id ? '…' : 'Mark contacted'}</button>
                  </div>
                )}
              </div>
            </div>
          ))}

        {!loading && !isPhone &&
          rows.map((r, i) => (
            <div key={r.id} className="rowhover" onClick={() => r.person_id && setProfileId(r.person_id)} style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '13px 20px', borderBottom: '1px solid #F1E9DB', alignItems: 'center', cursor: 'pointer', background: profileId === r.person_id ? '#FBF1E6' : undefined }}>
              <Checkbox state={sel.isSelected(r.person_id)} onClick={(e) => { e.stopPropagation(); sel.toggle(r.person_id) }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(r.person?.full_name || '?')}</div>
                <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.person?.full_name || 'Unknown'}</div>
              </div>
              <div style={{ fontSize: 12.5, color: r.person?.phone ? 'var(--ink-soft)' : '#B5532F' }}>{r.person?.phone || 'No phone'}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{ago(r.interest_date)}</div>
              <div><span className="pill" style={STATUS_PILL[r.status] || STATUS_PILL.new}>{r.status}</span></div>
              <div onClick={(e) => e.stopPropagation()}>
                {r.status === 'new' ? (
                  <button className="btn btn-ghost" disabled={busy === r.id} style={{ padding: '6px 11px', fontSize: 12 }} onClick={() => markContacted(r)}>{busy === r.id ? '…' : 'Mark contacted'}</button>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>—</span>
                )}
              </div>
            </div>
          ))}
      </div>
      {!loading && total > 0 && (
        <Pager page={page} pageCount={pageCount} total={total} onPage={setPage} pageSize={pageSize} onPageSize={setPageSize} noun="candidates"
          bottomOffset={isPhone && selCount === 0 ? 84 : 12}
          selection={selCount > 0 ? {
            count: selCount, total, isFullySelected: sel.isAllMode, onClear: sel.clear,
            actions: [{ label: resolving ? 'Preparing…' : 'Create campaign', onClick: openCampaign, disabled: resolving, primary: true }],
          } : null} />
      )}

      {showForm && (
        <CampaignForm
          audience="meditator"
          personIds={formIds}
          segmentLabel={formIds.length ? `${formIds.length} ${cur.label} candidates` : `${cur.label} candidates`}
          onClose={() => setShowForm(false)}
          onToast={onToast}
          onCreated={() => sel.clear()}
        />
      )}
      {profileId && <PersonProfile personId={profileId} me={me} onClose={() => setProfileId(null)} onToast={onToast} onChanged={loadPage} />}

      {isPhone && selCount === 0 && (
        <>
          <div style={{ height: 68 }} />
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: '10px 14px calc(10px + env(safe-area-inset-bottom))', background: 'var(--bg)', borderTop: '1px solid var(--border)', zIndex: 120 }}>
            <button
              className="btn btn-primary"
              disabled={resolving}
              onClick={openCampaign}
              style={{ width: '100%', height: 48, justifyContent: 'center', fontSize: 15 }}
            >
              {Icon.campaigns(16)} {resolving ? 'Preparing…' : 'Create campaign'}
            </button>
          </div>
        </>
      )}
    </Pad>
  )
}
