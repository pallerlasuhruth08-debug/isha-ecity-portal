import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// lib/calllog.js imports './ui' extensionless (Vite resolves it; bare node does not),
// so the pure outcome-vocabulary half is evaluated here with a stubbed pill().
const src = readFileSync(new URL('../src/lib/calllog.js', import.meta.url), 'utf8')
  .replace("import { pill } from './ui'", 'const pill = (bg, fg) => ({ bg, fg })')
const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))
const { labelForOutcome, pillForAnyOutcome, NURTURE_OUTCOMES, LOG_OUTCOMES, STATUS_PILL } = mod

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name) }

// The whole point: four screens wrote four vocabularies into one column, and the
// profile's history rendered whatever came back. Every outcome either screen can
// write must map to a DELIBERATE pill, not land on the fallback by accident.
// (Asserting the exact pill, not "not the default" — 'No answer' legitimately maps
// to the same neutral swatch as 'To call', so an identity check would be a lie.)
const EXPECTED_PILL = {
  Enrolled: 'Enrolled', Interested: 'Replied', 'Call back later': 'Call back',
  'No answer': 'Attempted', 'Not now': 'Not now',
  Reached: 'Replied', 'Call back': 'Call back', 'Doing well': 'Enrolled', 'Needs support': 'Call back',
}
t('every outcome either screen can write maps to its intended pill', () => {
  for (const o of [...LOG_OUTCOMES, ...NURTURE_OUTCOMES]) {
    const want = EXPECTED_PILL[o]
    assert.ok(want, `${o} has no declared pill intent — add it`)
    assert.deepEqual(pillForAnyOutcome(o), STATUS_PILL[want], `${o} should read as ${want}`)
  }
})

t('legacy snake_case rows already in the database read as words', () => {
  assert.equal(labelForOutcome('answered'), 'Reached')
  assert.equal(labelForOutcome('will_call_back'), 'Call back')
  assert.equal(labelForOutcome('not_reachable'), 'No answer')
})

t('legacy rows get the same pill as the words they now read as', () => {
  assert.deepEqual(pillForAnyOutcome('answered'), pillForAnyOutcome('Reached'))
  assert.deepEqual(pillForAnyOutcome('will_call_back'), pillForAnyOutcome('Call back'))
  assert.deepEqual(pillForAnyOutcome('not_reachable'), pillForAnyOutcome('No answer'))
})

t('an unknown value degrades to itself and the neutral pill, never a crash', () => {
  assert.equal(labelForOutcome('Something nobody has written yet'), 'Something nobody has written yet')
  assert.deepEqual(pillForAnyOutcome('Something nobody has written yet'), STATUS_PILL['To call'])
})

t('an empty outcome reads as a dash, not "undefined"', () => {
  assert.equal(labelForOutcome(null), '—')
  assert.equal(labelForOutcome(''), '—')
})

t('the two vocabularies stay distinct — they are different conversations', () => {
  assert.ok(LOG_OUTCOMES.includes('Enrolled'))
  assert.ok(NURTURE_OUTCOMES.includes('Doing well'))
  assert.ok(!NURTURE_OUTCOMES.includes('Enrolled'))
})

console.log(`\n${pass}/${pass} passed`)
