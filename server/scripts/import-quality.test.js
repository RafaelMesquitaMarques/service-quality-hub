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

// ── Placeholder identifiers ('-', 'N/A'…) are empty ──
const { toId, normId, contradicts } = require('./import-quality')
test("toId / normId: '-', '—', 'N/A' are empty; real values kept", () => {
  for (const v of ['-', ' - ', '—', '–', 'N/A', 'n/a', '?']) {
    assert.strictEqual(toId(v), null, `toId(${v})`)
    assert.strictEqual(normId(v), '', `normId(${v})`)
  }
  assert.strictEqual(toId('0'), '0')
  assert.strictEqual(toId(' 73196 '), '73196')
  assert.strictEqual(toId('A-1'), 'A-1')
})
test("mapRow stores a '-' SC# / ITEM / material as NULL", () => {
  const r = mapRow({ ...rawRow, 'SC#': '-', 'ITEM': '-', 'MATERIAL NUMBER\r\nFoliot ID': '-' })
  assert.strictEqual(r.sc_number, null)
  assert.strictEqual(r.item, null)
  assert.strictEqual(r.material_number, null)
  assert.strictEqual(r.ref_so, '53700')
})

// ── The two real duplicate classes of the 2026-07-08 import ──
const ship = (o) => ({ ...excelRow(o), 'SHIP TO': o.ship })
test("'-' SC# copy of an occurrence without SC# is recognised (was #2168 / #300)", () => {
  // In the platform: SC# NULL, item NULL (imported earlier).
  const existing = [{ id: 't300', occurrence_no: 300, sc_number: null, ref_so: '67850', item: null, material_number: '-',
    quality_issue: 'Damaged sofa arms', ship_to: 'Embry-Riddle Aero Univ, FL', issue_reception_date: '2025-03-06' }]
  const rep = analyze([ship({ sc: '-', ref: 67850, item: '-', mat: '-', issue: 'Damaged sofa arms',
    ship: 'Embry-Riddle Aero Univ, FL', date: '2025-03-06' })], existing, 0)
  assert.strictEqual(rep.toInsert.length, 0)
  assert.strictEqual(rep.existingSkipped, 1)
  assert.strictEqual(rep.matchedByStrategy.k4, 1)
})
test('weak key is tried when strong keys exist but none matches (was #2409 / #1633)', () => {
  // Existing ticket has no item (imported): the Excel row's strong keys cannot match it.
  const existing = [{ id: 't1633', occurrence_no: 1633, sc_number: '73152', ref_so: '71766', item: null, material_number: 'HFBRUH-109S-3',
    quality_issue: 'Damaged left side panel of left queen headboard', ship_to: 'HIEX Concordia, KS', issue_reception_date: '2026-02-03', real_cost: 112 }]
  const row = { ...ship({ sc: '73152', ref: 71766, item: '28/38', mat: 'HFBRUH-109S-3',
    issue: 'Damaged left side panel of left queen headboard', ship: 'HIEX Concordia, KS', date: '2026-02-03' }), 'Cost approx (Shipping incl.)': 112 }
  const rep = analyze([row], existing, 0)
  assert.strictEqual(rep.toInsert.length, 0)
  assert.deepStrictEqual(rep.weakFallbackMatches.map(m => m.matched), ['#1633'])
})

// ── …but never over a contradiction: another item or another cost = another defect ──
test('weak key refused when items differ — inserted and listed for review (was #2185 / #484)', () => {
  const existing = [{ id: 't484', occurrence_no: 484, sc_number: '70165', ref_so: '68062', item: '60', material_number: 'HHGIUH-406S',
    quality_issue: 'Need top panels on all king HB', ship_to: 'HGI Dover, DE', issue_reception_date: '2025-04-29', real_cost: 200 }]
  const row = { ...ship({ sc: '70165', ref: 68062, item: '10-30', mat: 'HHGIUH-401S/HHGIUH-406S',
    issue: 'Need top panels on all king HB', ship: 'HGI Dover, DE', date: '2025-04-29' }), 'Cost approx (Shipping incl.)': 2000 }
  const rep = analyze([row], existing, 0)
  assert.strictEqual(rep.toInsert.length, 1)
  assert.deepStrictEqual(rep.possibleDuplicates.map(p => p.existing), ['#484'])
})
test('weak key refused when costs differ, even without item on the ticket (was #2283 / #1927)', () => {
  const existing = [{ id: 't1927', occurrence_no: 1927, sc_number: '73929', ref_so: '72855', item: null, material_number: 'HFBRCB-129S',
    quality_issue: 'Damaged refreshment centers', ship_to: 'HIEX Stillwater, OK', issue_reception_date: '2026-04-27', real_cost: 418 }]
  const row = { ...ship({ sc: '73929', ref: 72855, item: '31/41', mat: 'HFBRCB-129S',
    issue: 'Damaged refreshment centers', ship: 'HIEX Stillwater, OK', date: '2026-04-27' }), 'Cost approx (Shipping incl.)': 981 }
  const rep = analyze([row], existing, 0)
  assert.strictEqual(rep.toInsert.length, 1)
  assert.strictEqual(rep.existingSkipped, 0)
  assert.strictEqual(rep.possibleDuplicates.length, 1)
})
test('contradicts(): empty sides and placeholders contradict nothing; cost compared on real_cost', () => {
  assert.strictEqual(contradicts({ item: '-', cost_approx: null }, { item: '60', cost_approx: 5 }), false)
  assert.strictEqual(contradicts({ item: '61', cost_approx: 249 }, { item: null, real_cost: 249, cost_approx: 586 }), false)
  assert.strictEqual(contradicts({ item: '61', cost_approx: 249 }, { item: null, real_cost: 1499 }), true)
  assert.strictEqual(contradicts({ item: '61' }, { item: ' 61 ' }), false)
})
test('a cost edited in the app after import is not a contradiction (was #2003: $373 → $2,963)', () => {
  // Re-importing the same Excel row (header $373) must still recognise the ticket.
  assert.strictEqual(contradicts({ item: null, cost_approx: 373 }, { item: null, cost_approx: 373, real_cost: 2963 }), false)
  const existing = [{ id: 't2003', occurrence_no: 2003, sc_number: '74259', item: null, quality_issue: 'Stones they received',
    ship_to: 'H2S Peoria, AZ', issue_reception_date: '2026-05-21', cost_approx: 373, real_cost: 2963 }]
  const row = { 'SC#': '74259', 'ISSUE RECEPTION DATE': '2026-05-21', 'QUALITY ISSUE': 'Stones they received',
    'SHIP TO': 'H2S Peoria, AZ', 'Cost approx (Shipping incl.)': 373 }
  assert.strictEqual(analyze([row], existing, 0).toInsert.length, 0)
})

// ── A weak key accounts for ONE existing ticket ──
const P = { ship: 'Boise State University, ID', date: '2026-02-03', issue: 'Damaged tomeo sofa' }
test('weak match consumes the existing ticket: a second look-alike row is inserted', () => {
  const existing = [{ id: 'e1', sc_number: '73196', item: null, quality_issue: P.issue, ship_to: P.ship, issue_reception_date: P.date }]
  const rows = [ship({ ...P, sc: '73196', ref: 68264, item: 61, mat: 'DTMUS-208S' }),
    ship({ ...P, sc: '73196', ref: 68264, item: 62, mat: 'DTMUS-101S' })]
  const rep = analyze(rows, existing, 0)
  assert.strictEqual(rep.existingSkipped, 1)
  assert.strictEqual(rep.toInsert.length, 1)
  assert.strictEqual(rep.toInsert[0].rec.item, '62')
})
test('a ticket matched by a strong key is not reused by the weak key of another row', () => {
  const existing = [mapRow(ship({ ...P, sc: '73196', ref: 68264, item: 61, mat: 'DTMUS-208S' }))]
  const rows = [ship({ ...P, sc: '73196', ref: 68264, item: 61, mat: 'DTMUS-208S' }),
    ship({ ...P, sc: '73196', ref: 68264, item: 62, mat: 'DTMUS-101S' })]
  const rep = analyze(rows, existing, 0)
  assert.strictEqual(rep.matchedByStrategy.k1, 1)
  assert.strictEqual(rep.toInsert.length, 1)
  assert.strictEqual(rep.toInsert[0].rec.item, '62')
})
test('existing app occurrences match on project_name (ship_to is no longer entered)', () => {
  const existing = [{ id: 'app', sc_number: '75908', item: null, quality_issue: 'Scratched desk frame', ship_to: null,
    project_name: 'Tru Cedar Rapids', issue_reception_date: '2026-10-30' }]
  const rep = analyze([ship({ sc: '75908', ref: 1, item: 5, mat: 'X', issue: 'Scratched desk frame', ship: 'Tru Cedar Rapids', date: '2026-10-30' })], existing, 0)
  assert.strictEqual(rep.toInsert.length, 0)
})
test('two rows without strong keys that differ only by cost are both inserted', () => {
  const base = { 'SC#': '74000', 'ISSUE RECEPTION DATE': '2026-03-02', 'QUALITY ISSUE': 'Missing hardware', 'SHIP TO': 'Site A', 'DEPARTMENT': 'Supplier' }
  const rep = analyze([{ ...base, 'Cost approx (Shipping incl.)': 120 }, { ...base, 'Cost approx (Shipping incl.)': 340 }], [], 0)
  assert.strictEqual(rep.toInsert.length, 2)
  assert.strictEqual(rep.intraFileDup, 0)
})
test('idempotency with weak-only rows: re-running inserts zero', () => {
  const rows = [ship({ sc: '-', ref: '-', item: '-', mat: '-', issue: 'Loose drawer', ship: 'Site B', date: '2026-01-05' }),
    ship({ sc: '74001', ref: 9, item: 3, mat: 'M', issue: 'Loose drawer', ship: 'Site B', date: '2026-01-05' })]
  const first = analyze(rows, [], 0)
  assert.strictEqual(first.toInsert.length, 2)
  const second = analyze(rows, first.toInsert.map(x => x.rec), 0)
  assert.strictEqual(second.toInsert.length, 0)
})

console.log(`\n${passed} tests passed.`)
