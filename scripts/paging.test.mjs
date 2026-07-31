import assert from 'node:assert/strict'
import { fetchAllMatchingIds, ID_CHUNK, ID_CHUNK_GUARD } from '../src/lib/usePagedQuery.js'

let pass = 0
const t = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name) }

// Minimal stand-in for a PostgREST query builder: records the ranges asked for and
// serves slices out of a fixed id list, so the chunk walk can be tested without a
// network or a database.
function fakeTable(ids, { column = 'id', failOn = -1 } = {}) {
  const ranges = []
  const build = () => ({
    order: () => build(),
    range: async (from, to) => {
      ranges.push([from, to])
      if (ranges.length - 1 === failOn) return { data: null, error: { message: 'boom' } }
      return { data: ids.slice(from, to + 1).map((v) => ({ [column]: v })), error: null }
    },
  })
  return { build, ranges }
}

const seq = (n, prefix = 'p') => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

await t('a short result set is one request, not two', async () => {
  const f = fakeTable(seq(7))
  const out = await fetchAllMatchingIds(f.build, 'id')
  assert.deepEqual(out, seq(7))
  assert.equal(f.ranges.length, 1)
  assert.deepEqual(f.ranges[0], [0, ID_CHUNK - 1])
})

await t('an empty result set returns [] and stops', async () => {
  const f = fakeTable([])
  assert.deepEqual(await fetchAllMatchingIds(f.build, 'id'), [])
  assert.equal(f.ranges.length, 1)
})

// The boundary that a hand-written loop gets wrong: exactly one full chunk looks
// identical to "there may be more", so it MUST ask again and get nothing back.
await t('exactly one full chunk asks a second time', async () => {
  const f = fakeTable(seq(ID_CHUNK))
  const out = await fetchAllMatchingIds(f.build, 'id')
  assert.equal(out.length, ID_CHUNK)
  assert.equal(f.ranges.length, 2)
  assert.deepEqual(f.ranges[1], [ID_CHUNK, ID_CHUNK * 2 - 1])
})

await t('multiple chunks are walked in order, with no gap or overlap', async () => {
  const ids = seq(ID_CHUNK * 2 + 13)
  const f = fakeTable(ids)
  const out = await fetchAllMatchingIds(f.build, 'id')
  assert.deepEqual(out, ids)
  assert.equal(f.ranges.length, 3)
  assert.deepEqual(f.ranges.map(([from]) => from), [0, ID_CHUNK, ID_CHUNK * 2])
})

// A filter that never runs dry must stop rather than loop for ever.
await t('the guard bounds a non-terminating walk', async () => {
  const f = fakeTable(seq(ID_CHUNK * (ID_CHUNK_GUARD + 10)))
  const out = await fetchAllMatchingIds(f.build, 'id')
  assert.equal(f.ranges.length, ID_CHUNK_GUARD)
  assert.equal(out.length, ID_CHUNK * ID_CHUNK_GUARD)
})

await t('an error is thrown, never swallowed into a short list', async () => {
  const f = fakeTable(seq(ID_CHUNK * 2), { failOn: 1 })
  await assert.rejects(() => fetchAllMatchingIds(f.build, 'id'))
})

await t('the id column is honoured', async () => {
  const f = fakeTable(seq(3, 'k'), { column: 'person_id' })
  assert.deepEqual(await fetchAllMatchingIds(f.build, 'person_id'), ['k0', 'k1', 'k2'])
})

console.log(`\n${pass}/${pass} passed`)
