import { useCallback, useState } from 'react'

// Selection model tied to the FILTERED SET, independent of page size.
//  - mode 'some': `included` = explicitly checked ids (accumulates across pages).
//  - mode 'all' : whole filtered set selected, minus `excluded` exceptions.
// count(total) and resolveIds(fetchAllIds) compute against the live total.
export function useTableSelection() {
  const [mode, setMode] = useState('some')
  const [included, setIncluded] = useState(() => new Set())
  const [excluded, setExcluded] = useState(() => new Set())

  const clear = useCallback(() => {
    setMode('some')
    setIncluded(new Set())
    setExcluded(new Set())
  }, [])

  const selectAllMatching = useCallback(() => {
    setMode('all')
    setIncluded(new Set())
    setExcluded(new Set())
  }, [])

  const isSelected = useCallback(
    (id) => (mode === 'all' ? !excluded.has(id) : included.has(id)),
    [mode, included, excluded],
  )

  const toggle = useCallback(
    (id) => {
      if (mode === 'all') {
        setExcluded((prev) => {
          const n = new Set(prev)
          n.has(id) ? n.delete(id) : n.add(id)
          return n
        })
      } else {
        setIncluded((prev) => {
          const n = new Set(prev)
          n.has(id) ? n.delete(id) : n.add(id)
          return n
        })
      }
    },
    [mode],
  )

  const count = useCallback(
    (total) => (mode === 'all' ? Math.max(0, total - excluded.size) : included.size),
    [mode, included, excluded],
  )

  // Header checkbox visual state: 'all' | 'partial' | 'none'
  const headerState = useCallback(
    (total) => {
      if (mode === 'all') return excluded.size === 0 ? 'all' : 'partial'
      if (included.size === 0) return 'none'
      return 'partial'
    },
    [mode, included, excluded],
  )

  // Resolve the concrete id list at submit time.
  const resolveIds = useCallback(
    async (fetchAllIds) => {
      if (mode === 'all') {
        const all = await fetchAllIds()
        return all.filter((id) => !excluded.has(id))
      }
      return [...included]
    },
    [mode, included, excluded],
  )

  return { mode, isAllMode: mode === 'all', included, excluded, clear, selectAllMatching, isSelected, toggle, count, headerState, resolveIds }
}
