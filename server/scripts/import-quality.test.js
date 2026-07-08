/* Tests for the quality importer. Run: node server/scripts/import-quality.test.js
 * No DB access — pure logic (serial dates, normalization, keys, dedup, idempotency). */
const assert = require('assert')
const {
  norm, excelSerialToISO, toStr, getFiscalYear, getFiscalMonth,
  mapRow, buildKeys, analyze,
} = require('./import-quality')

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

// ── Excel serial date conversion ──
test('excel serial 45629 → 2024-12-03', () => {
  assert.strictEqual(excelSerialToISO(45629), '2024-12-03')
})
test('excel serial 45623 → 2024-11-27', () => {
  assert.strictEqual(excelSerialToISO(45623), '2024-11-27')
})
test('date-only string passes through', () => {
  assert.strictEqual(excelSerialToISO('2025-03-14'), '2025-03-14')
})
test('empty / invalid date → null', () => {
  assert.strictEqual(excelSerialToISO(null), null)
  assert.strictEqual(excelSerialToISO(''), null)
  assert.strictEqual(excelSerialToISO('nope'), null)
})

// ── Normalization ──
test('norm trims, collapses spaces, strips newlines, lowercases', () => {
  assert.strictEqual(norm('  Ottomans\r\n  splitting   SEAM '), 'ottomans splitting seam')
})
test('norm coerces numbers to strings', () => {
  assert.strictEqual(norm(53700), '53700')
  assert.strictEqual(norm(0), '0')
})
test('norm empty-ish → empty string', () => {
  assert.strictEqual(norm(null), '')
  assert.strictEqual(norm(undefined), '')
})
test('toStr coerces number REF SO / ITEM to trimmed string', () => {
  assert.strictEqual(toStr(53700), '53700')
  assert.strictEqual(toStr('  '), null)
})

// ── Fiscal calendar (December = month 1 of next FY) ──
test('fiscal: December rolls to next year, month 1', () => {
  assert.strictEqual(getFiscalYear('2024-12'), 2025)
  assert.strictEqual(getFiscalMonth('2024-12'), 1)
})
test('fiscal: November stays same year, month 12', () => {
  assert.strictEqual(getFiscalYear('2024-11'), 2024)
  assert.strictEqual(getFiscalMonth('2024-11'), 12)
})

// ── mapRow (header with line break, status mapping, numbers) ──
const rawRow = {
  'SC#': '68487', 'REF SO': 53700, 'ITEM': 2380, 'MATERIAL NUMBER\r\nFoliot ID': 'HHMUS-038S',
  'ISSUE RECEPTION DATE': 45623, 'MEETING DATE': 45629, 'QUALITY ISSUE': 'Ottomans splitting on the seam',
  'DEPARTMENT': 'Product Dev.', 'STATUS': 'Not started', 'CATEGORIES': 'Upholstery',
  'Cost approx (Shipping incl.)': 1400, 'AFFECTED QTY': 9, 'TOTAL QTY on Ref SO': 91,
  'AFFECTED %': 0.0989010989, 'SHIP TO': 'H2S Rockford, IL', 'BRAND': 'HOME 2', 'PLANT': 'QS',
}
test('mapRow maps line-break header + serial dates + status + numbers', () => {
  const r = mapRow(rawRow)
  assert.strictEqual(r.material_number, 'HHMUS-038S')
  assert.strictEqual(r.issue_reception_date, '2024-11-27')
  assert.strictEqual(r.date_yyyy_mm, '2024-11')
  assert.strictEqual(r.fiscal_year, 2024)
  assert.strictEqual(r.status, 'not_started')
  assert.strictEqual(r.ref_so, '53700')
  assert.strictEqual(r.item, '2380')
  assert.strictEqual(r.cost_approx, 1400)
})
test('unknown/blank status → not_started', () => {
  assert.strictEqual(mapRow({ ...rawRow, STATUS: 'Waiting on customer' }).status, 'not_started')
  assert.strictEqual(mapRow({ ...rawRow, STATUS: null }).status, 'not_started')
})
test('status WIP / Completed / Cancelled map correctly', () => {
  assert.strictEqual(mapRow({ ...rawRow, STATUS: 'WIP' }).status, 'wip')
  assert.strictEqual(mapRow({ ...rawRow, STATUS: 'Completed' }).status, 'completed')
  assert.strictEqual(mapRow({ ...rawRow, STATUS: 'Cancelled' }).status, 'cancelled')
})

// ── Composite key generation ──
test('buildKeys emits strong keys when fields present', () => {
  const { strong } = buildKeys(mapRow(rawRow))
  assert.ok(strong.some(k => k.startsWith('k1|')))
  assert.ok(strong.some(k => k.startsWith('k2|')))
})
test('buildKeys same data (number vs string) yields identical key', () => {
  const a = buildKeys(mapRow(rawRow)).strong[0]
  const b = buildKeys(mapRow({ ...rawRow, 'REF SO': '53700', 'ITEM': '2380' })).strong[0]
  assert.strictEqual(a, b)
})

// ── Dedup / existing-skip / idempotency (analyze, no DB) ──
const excelRow = (o) => ({
  'SC#': o.sc, 'REF SO': o.ref, 'ITEM': o.item, 'MATERIAL NUMBER\r\nFoliot ID': o.mat,
  'ISSUE RECEPTION DATE': o.date ?? 45623, 'QUALITY ISSUE': o.issue, 'DEPARTMENT': o.dept || 'Client',
})
const A = { sc: '100', ref: 500, item: 10, mat: 'MX', issue: 'Broken leg' }
const B = { sc: '200', ref: 600, item: 20, mat: 'MY', issue: 'Torn seam' }

test('existing platform ticket is skipped, never re-inserted', () => {
  const existing = [mapRow(excelRow(A))]                    // A already in DB
  const rep = analyze([excelRow(A), excelRow(B)], existing, 0)
  assert.strictEqual(rep.existingSkipped, 1)               // A matched
  assert.strictEqual(rep.toInsert.length, 1)               // only B
  assert.strictEqual(rep.toInsert[0].rec.sc_number, '200')
})
test('duplicate rows within the Excel file insert only once', () => {
  const rep = analyze([excelRow(A), excelRow(A), excelRow(B)], [], 0)
  assert.strictEqual(rep.toInsert.length, 2)
  assert.strictEqual(rep.intraFileDup, 1)
})
test('rows missing required fields are rejected, not inserted', () => {
  const bad = { 'SC#': '999', 'REF SO': 1, 'ITEM': 1, 'QUALITY ISSUE': null, 'ISSUE RECEPTION DATE': 45623 }
  const rep = analyze([bad, excelRow(A)], [], 0)
  assert.strictEqual(rep.rejected.length, 1)
  assert.strictEqual(rep.toInsert.length, 1)
})
test('idempotency: re-running against inserted data inserts zero', () => {
  const first = analyze([excelRow(A), excelRow(B)], [], 0)
  const nowExisting = first.toInsert.map(x => x.rec)        // pretend those got inserted
  const second = analyze([excelRow(A), excelRow(B)], nowExisting, 0)
  assert.strictEqual(second.toInsert.length, 0)
  assert.strictEqual(second.existingSkipped, 2)
})

console.log(`\n${passed} tests passed.`)
