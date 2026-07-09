import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// A comment thread scoped to a record. `scope` is either { block_id } (a team) or
// { activity_id, subject_person_id } (a person within an event). RLS on `comments`
// enforces visibility per the attached record — this component just reads/writes it.
export default function CommentThread({ scope, me, onToast, compact = false }) {
  const [rows, setRows] = useState(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const key = scope.block_id || `${scope.activity_id}:${scope.subject_person_id}`
  const load = useCallback(async () => {
    let q = supabase.from('comments').select('id, body, created_at, author_id').order('created_at')
    if (scope.block_id) q = q.eq('block_id', scope.block_id)
    else q = q.eq('activity_id', scope.activity_id).eq('subject_person_id', scope.subject_person_id)
    const { data, error } = await q
    if (error) { setRows([]); return }
    const ids = [...new Set((data || []).map((c) => c.author_id).filter(Boolean))]
    let names = {}
    if (ids.length) {
      const { data: pf } = await supabase.from('profiles').select('id, full_name, email').in('id', ids)
      names = Object.fromEntries((pf || []).map((p) => [p.id, p.full_name || p.email || 'Someone']))
    }
    setRows((data || []).map((c) => ({ ...c, author: names[c.author_id] || 'Someone' })))
  }, [key]) // eslint-disable-line
  useEffect(() => { load() }, [load])

  async function add() {
    const text = body.trim()
    if (!text) return
    setBusy(true)
    try {
      const { error } = await supabase.from('comments').insert({ ...scope, author_id: me?.id || null, body: text })
      if (error) throw error
      setBody(''); load()
    } catch (e) { onToast && onToast('Could not add comment: ' + (e.message || e)) } finally { setBusy(false) }
  }

  async function remove(id) {
    if (!window.confirm('Delete this comment?')) return
    const { error } = await supabase.from('comments').delete().eq('id', id)
    if (error) return onToast && onToast('Could not delete: ' + error.message)
    load()
  }

  const fmt = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

  return (
    <div style={{ marginTop: compact ? 6 : 10 }}>
      {rows === null ? (
        <div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>No comments yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {rows.map((c) => (
            <div key={c.id} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px' }}>
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', whiteSpace: 'pre-wrap' }}>{c.body}</div>
              <div style={{ fontSize: 10.5, color: 'var(--muted-2)', marginTop: 3, display: 'flex', gap: 6 }}>
                {c.author} · {fmt(c.created_at)}
                {c.author_id === me?.id && <button onClick={() => remove(c.id)} style={{ background: 'none', border: 'none', color: '#B5532F', cursor: 'pointer', fontSize: 10.5, padding: 0 }}>delete</button>}
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add a comment…"
          style={{ flex: 1, fontSize: 12.5, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 8, background: '#fff', color: 'var(--ink)' }} />
        <button className="btn btn-ghost" disabled={busy || !body.trim()} onClick={add} style={{ fontSize: 12, padding: '7px 12px' }}>Post</button>
      </div>
    </div>
  )
}
