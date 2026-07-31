import { useCallback, useEffect, useRef, useState } from 'react'

// The paging state machine, once.
//
// WHY IT EXISTS
// Volunteers, Meditators, Interest and Advance each carried their own copy of
// the same eight things: rows/total/page/pageSize/loading/err state, a
// cancel-in-flight sequence guard, `.range(page * pageSize, …)` arithmetic, a
// reset-to-page-0 on pageSize change, and `Math.ceil(total / pageSize)`. Four
// copies meant four places for an off-by-one to hide, and the cancel guard was
// already subtly different between them (Volunteers returned early WITHOUT
// clearing `loading`, leaving the list spinning forever when a resolver was
// still pending — see `ready` below, which is the fix).
//
// WHAT IT DELIBERATELY DOES NOT DO
// It does not render anything. An earlier plan called for a <DataTable> to go
// with it; none of these four screens actually renders a table — they render
// card rows with per-screen affordances (stage chips, expandable programme
// history, a side panel, inline status buttons). A component generic enough to
// serve all four would be larger than the markup it replaced. Paging logic is
// genuinely identical across screens; paging *presentation* is not.

/**
 * @param buildQuery () => PostgREST query, already carrying .select(…, { count: 'exact' })
 *                   and its .order(…) clauses. The hook appends .range() and nothing else,
 *                   so a screen keeps full control of its columns and sort while paging
 *                   arithmetic stays in one place. MUST be a useCallback.
 * @param opts.ready false while a filter is still resolving to ids. A not-ready hook
 *                   holds the previous rows and shows loading — it never fires a query
 *                   it knows is wrong, and never strands `loading` on.
 * @param opts.mapRows optional (rows) => rows, applied before state is set. May be async —
 *                   Volunteers enriches the page with tags/skills/attendance in a second
 *                   round trip, and the sequence guard is re-checked after the await so a
 *                   superseded page can never win the race by finishing its enrichment first.
 */
export function usePagedQuery(buildQuery, { ready = true, mapRows = null, pageSize: initialPageSize = 25 } = {}) {
  const [rows, setRows] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSizeRaw] = useState(initialPageSize)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const seqRef = useRef(0)

  // Changing rows-per-page while on page 7 of 8 would land past the end of the
  // new pagination, so it always returns to the first page.
  const setPageSize = useCallback((n) => { setPageSizeRaw(n); setPage(0) }, [])

  const mapRef = useRef(mapRows)
  mapRef.current = mapRows

  useEffect(() => {
    if (!ready) { setLoading(true); return }
    let alive = true
    const seq = ++seqRef.current
    setLoading(true)
    setErr(null)
    ;(async () => {
      try {
        const { data, count, error } = await buildQuery().range(page * pageSize, page * pageSize + pageSize - 1)
        if (error) throw error
        if (!alive || seq !== seqRef.current) return
        const list = data || []
        const out = mapRef.current ? await mapRef.current(list) : list
        if (!alive || seq !== seqRef.current) return
        setRows(out)
        setTotal(count ?? 0)
      } catch (e) {
        if (!alive || seq !== seqRef.current) return
        setErr(e.message || String(e))
        setRows([])
      } finally {
        if (alive && seq === seqRef.current) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [buildQuery, page, pageSize, ready, reloadKey])

  return {
    rows, total, page, pageSize, loading, err,
    setPage, setPageSize, setRows,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    reload: useCallback(() => setReloadKey((k) => k + 1), []),
  }
}

// Debounced mirror of a search box. Three screens had the same 300ms timeout
// written out by hand; one of them used 250ms, which is the kind of drift that
// makes two lists feel like two products.
export function useDebounced(value, ms = 300) {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setOut(typeof value === 'string' ? value.trim() : value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return out
}

export const ID_CHUNK = 1000
// PostgREST caps a response; "every id matching this filter" therefore needs a
// walk. The guard bounds it at 50 chunks — 50,000 ids, ~7x the whole database —
// so a filter that somehow never terminates fails loudly rather than looping.
export const ID_CHUNK_GUARD = 50

/**
 * Every id matching a filter, across all pages. Feeds "select all N matching"
 * and campaign recipient resolution.
 * @param buildQuery () => PostgREST query already carrying .select('<column>')
 */
export async function fetchAllMatchingIds(buildQuery, column) {
  const ids = []
  for (let g = 0, from = 0; g < ID_CHUNK_GUARD; g++, from += ID_CHUNK) {
    const { data, error } = await buildQuery()
      .order(column, { ascending: true })
      .range(from, from + ID_CHUNK - 1)
    if (error) throw error
    const batch = (data || []).map((r) => r[column])
    ids.push(...batch)
    if (batch.length < ID_CHUNK) break
  }
  return ids
}
