import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { initials, avatarFor, healthPill, pill } from '../lib/ui'
import { Pad, ErrorCard, Loading, Empty, PagerBar } from '../components/View'
import PersonProfile from '../components/PersonProfile'
import SidePanel, { PanelHeader } from '../components/SidePanel'

function healthFrom(activePct, members) {
  if (members === 0) return 'Needs care'
  if (activePct >= 0.7) return 'Strong'
  if (activePct >= 0.4) return 'Steady'
  return 'Needs care'
}
const waNum = (p) => (p || '').replace(/\D/g, '').replace(/^0+/, '').slice(-10)
const lastActive = (d) => {
  if (!d) return 'No recent activity'
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  if (days <= 0) return 'Active today'
  if (days < 30) return `Active ${days}d ago`
  return `Quiet ${Math.round(days / 30)}mo`
}

export default function Nurturing({ onToast }) {
  const [groups, setGroups] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null) // nurturer detail panel
  const [profileId, setProfileId] = useState(null) // a circle member's PersonProfile

  useEffect(() => { setPage(0) }, [pageSize])

  const loadPage = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const { data: nurturers, count, error } = await supabase
        .from('nurturers')
        .select('id, full_name, phone, center_id', { count: 'exact' })
        .order('full_name', { ascending: true })
        .range(page * pageSize, page * pageSize + pageSize - 1)
      if (error) throw error
      const ids = (nurturers || []).map((n) => n.id)
      const byN = {}
      if (ids.length) {
        const { data: asg, error: e2 } = await supabase
          .from('nurturer_assignments')
          .select('nurturer_id, meditator:people!nurturer_assignments_meditator_id_fkey(id, full_name, phone, last_active_date)')
          .in('nurturer_id', ids)
        if (e2) throw e2
        for (const row of asg || []) {
          const g = (byN[row.nurturer_id] ||= { members: [], active: 0 })
          if (row.meditator) {
            g.members.push(row.meditator)
            const la = row.meditator.last_active_date
            if (la && Date.now() - new Date(la).getTime() < 30 * 86400000) g.active += 1
          }
        }
      }
      const list = (nurturers || []).map((n) => {
        const a = byN[n.id] || { members: [], active: 0 }
        const count2 = a.members.length
        const pct = count2 ? a.active / count2 : 0
        return { id: n.id, name: n.full_name, phone: n.phone || '', center: n.center_id, members: a.members, memberCount: count2, activePct: Math.round(pct * 100), health: healthFrom(pct, count2) }
      })
      setGroups(list)
      setTotal(count ?? 0)
    } catch (e) { setErr(e.message || String(e)); setGroups([]) } finally { setLoading(false) }
  }, [page, pageSize])

  useEffect(() => { loadPage() }, [loadPage])

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const open = openId ? (groups || []).find((g) => g.id === openId) : null

  const callBtns = (phone, size = 'sm') => {
    const has = !!phone
    const s = size === 'sm' ? { padding: '5px 10px', fontSize: 11.5 } : { padding: '9px 13px', fontSize: 12.5 }
    return (
      <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
        <a className="btn btn-primary" href={has ? `tel:${phone}` : undefined} style={{ ...s, textDecoration: 'none', opacity: has ? 1 : 0.45, pointerEvents: has ? 'auto' : 'none' }}>Call</a>
        <a className="btn btn-ghost" href={has ? `https://wa.me/91${waNum(phone)}` : undefined} target="_blank" rel="noreferrer" style={{ ...s, textDecoration: 'none', opacity: has ? 1 : 0.45, pointerEvents: has ? 'auto' : 'none' }}>Message</a>
      </div>
    )
  }

  return (
    <Pad>
      <div style={{ marginBottom: 18 }}>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)', maxWidth: 560 }}>
          Volunteer core groups &amp; nurturers. Click a nurturer to see their circle. Health is an <strong>estimate</strong> from 30-day activity. {loading ? '' : `${total} nurturers.`}
        </p>
      </div>

      {err && <ErrorCard>Couldn't load nurturing groups: {err}</ErrorCard>}
      {loading && <Loading label="Loading core groups…" />}
      {!loading && (groups || []).length === 0 && <Empty label="No nurturers yet." />}

      {!loading && (groups || []).length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(310px,1fr))', gap: 16 }}>
            {groups.map((g, i) => (
              <div key={g.id} className="card rowhover" onClick={() => setOpenId(g.id)} style={{ padding: 20, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 42, height: 42, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, flexShrink: 0 }}>{initials(g.name)}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</div>
                    <div style={{ fontSize: 11.5, color: g.phone ? 'var(--muted)' : '#B5532F' }}>{g.phone || 'No phone on record'}</div>
                  </div>
                  <span className="pill" style={healthPill(g.health)}>{g.health}</span>
                </div>
                <div style={{ display: 'flex', gap: 22, paddingTop: 12, borderTop: '1px solid #F2EBDD', marginBottom: 12 }}>
                  <div><div style={{ fontFamily: "'Newsreader',serif", fontSize: 22, fontWeight: 600, lineHeight: 1 }}>{g.memberCount}</div><div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 3 }}>in circle</div></div>
                  <div><div style={{ fontFamily: "'Newsreader',serif", fontSize: 22, fontWeight: 600, lineHeight: 1, color: '#4E7C3F' }}>{g.activePct}%</div><div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 3 }}>active 30d</div></div>
                </div>
                {callBtns(g.phone)}
              </div>
            ))}
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <PagerBar page={page} pageCount={pageCount} total={total} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
          </div>
        </>
      )}

      {/* nurturer detail — shared side panel */}
      {open && (
        <SidePanel onClose={() => setOpenId(null)} width={520}>
          <PanelHeader onClose={() => setOpenId(null)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: avatarFor(1), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 600 }}>{initials(open.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 2px' }}>{open.name}</h2>
                <div style={{ fontSize: 12.5, color: open.phone ? 'var(--muted)' : '#B5532F' }}>{open.phone || 'No phone on record'} · {open.memberCount} in circle</div>
              </div>
              {callBtns(open.phone)}
            </div>
          </PanelHeader>
          <div style={{ padding: '20px 26px' }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 10px' }}>Circle — meditators in care</h3>
            <div className="card" style={{ overflow: 'hidden' }}>
              {open.members.length === 0 && <Empty label="No one assigned to this nurturer yet." />}
              {open.members.map((m, i) => (
                <div key={m.id} className="rowhover" onClick={() => setProfileId(m.id)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 16px', borderBottom: i < open.members.length - 1 ? '1px solid #F1E9DB' : 'none', cursor: 'pointer', background: profileId === m.id ? '#FBF1E6' : 'transparent' }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>{initials(m.full_name)}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.full_name}</div>
                    <div style={{ fontSize: 11.5, color: m.phone ? 'var(--muted)' : '#B5532F' }}>{m.phone || 'No phone on record'} · {lastActive(m.last_active_date)}</div>
                  </div>
                  {callBtns(m.phone)}
                </div>
              ))}
            </div>
          </div>
        </SidePanel>
      )}
      {profileId && <PersonProfile personId={profileId} onClose={() => setProfileId(null)} onToast={onToast} onChanged={loadPage} />}
    </Pad>
  )
}
