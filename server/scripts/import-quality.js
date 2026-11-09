#!/usr/bin/env node
/*
 * Idempotent importer for legacy quality occurrences from an Excel file.
 *
 * SAFETY: inserts ONLY rows missing from the platform. Never updates, never
 * overwrites, never deletes. Default mode is --dry-run (read-only).
 *
 * Usage:
 *   node server/scripts/import-quality.js --file "Quality Meeting (Data).xlsx"            # dry-run
 *   node server/scripts/import-quality.js --file "Quality Meeting (Data).xlsx" --commit    # inserts
 *   optional: --sheet Data  --out report.json  --limit N
 *
 * Or via npm (from repo root):
 *   npm run quality:import -- --file "./Quality Meeting (Data).xlsx"
 *   npm run quality:import -- --file "./Quality Meeting (Data).xlsx" --commit
 */
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const XLSX = require('xlsx')
const { createClient } = require('@supabase/supabase-js')

// Load server/.env without a dependency (dotenv-free), only if not already set.
function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
}
loadEnv(path.join(__dirname, '..', '.env'))

// ─── Normalization ──────────────────────────────────────────────────────────
function norm(v) {
  if (v === null || v === undefined) return ''
  return String(v)
    .replace(/\r?\n/g, ' ')   // remove line breaks inside text
    .replace(/\s+/g, ' ')      // collapse multiple spaces
    .trim()
    .toLowerCase()
}
function normHeader(h) {
  return String(h).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
}
// Excel serial (or already-a-date string) → 'YYYY-MM-DD' (date-only, no TZ shift)
function excelSerialToISO(val) {
  if (val === null || val === undefined || val === '') return null
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val)
    if (!d || !d.y) return null
    const mm = String(d.m).padStart(2, '0')
    const dd = String(d.d).padStart(2, '0')
    return `${d.y}-${mm}-${dd}`
  }
  const s = String(val).trim()
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}
function toNumber(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}
function toStr(v) {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
  return s === '' ? null : s
}

// Placeholder identifiers typed in the Excel when the value is unknown ('-',
// 'N/A'…). They mean "empty": stored as NULL and never used in a key. The
// 2026-07-08 import inserted 11 copies with SC# '-' of occurrences whose SC# is
// NULL — the '-' built strong keys that could not match the original.
const PLACEHOLDER_IDS = new Set(['-', '--', '---', '—', '–', '_', '.', '?', 'n/a', 'na', 'n.a.', 'none', 'null'])
function toId(v) {
  const s = toStr(v)
  return s && PLACEHOLDER_IDS.has(s.toLowerCase()) ? null : s
}
function normId(v) {
  const s = norm(v)
  return PLACEHOLDER_IDS.has(s) ? '' : s
}

// Fiscal calendar: December = month 1 of the NEXT fiscal year (mirrors api.js)
function getFiscalYear(yyyymm) {
  if (!yyyymm) return null
  const [y, m] = yyyymm.split('-').map(Number)
  return m === 12 ? y + 1 : y
}
function getFiscalMonth(yyyymm) {
  if (!yyyymm) return null
  const [, m] = yyyymm.split('-').map(Number)
  return m === 12 ? 1 : m + 1
}

const STATUS_MAP = {
  'not started': 'not_started',
  'new': 'not_started',
  'requested': 'not_started',
  'hold': 'not_started',
  'waiting on customer': 'not_started',
  'wip': 'wip',
  'in progress': 'wip',
  'completed': 'completed',
  'complete': 'completed',
  'closed': 'completed',
  'cancelled': 'cancelled',
  'canceled': 'cancelled',
}

// Excel header (normalized) → tickets column
const COLUMN_MAP = {
  'link': 'legacy_link',
  'meeting date': 'meeting_date',
  'issue reception date': 'issue_reception_date',
  'dd': 'dd',
  'ship to': 'ship_to',
  'department': 'department',
  'status': 'status',
  'quality issue': 'quality_issue',
  'categories': 'categories',
  'cost approx (shipping incl.)': 'cost_approx',
  'supplier credit': 'supplier_credit',
  'affected qty': 'affected_qty',
  'total qty on ref so': 'total_qty',
  'affected %': 'affected_pct',
  'sc#': 'sc_number',
  'ref so': 'ref_so',
  'item': 'item',
  'material number foliot id': 'material_number',
  'brand': 'brand',
  'plant': 'plant',
  'cortex data': 'cortex_data',
  'corrective action': 'corrective_action',
  'root cause': 'root_cause',
  'corrective action #': 'corrective_action_no',
  'sold to': 'sold_to',
}

// tickets varchar limits — over-length values are clamped so an insert never
// fails on length. Key fields (sc_number/ref_so/item/material_number) are well
// within these in the data, so clamping them is a no-op → idempotency preserved.
const COL_LIMIT = {
  sc_number: 50, ref_so: 50, item: 50, material_number: 100, sold_to: 200,
  ship_to: 200, department: 50, brand: 50, plant: 20, categories: 100, corrective_action_no: 50,
}
function clamp(v, n) { return v == null ? v : (String(v).length > n ? String(v).slice(0, n) : v) }

// Raw Excel row object (header→value) → normalized ticket record for insert.
function mapRow(rawRow) {
  const r = {}
  for (const [rawKey, val] of Object.entries(rawRow)) {
    const field = COLUMN_MAP[normHeader(rawKey)]
    if (field) r[field] = val
  }
  const meeting = excelSerialToISO(r.meeting_date)
  const reception = excelSerialToISO(r.issue_reception_date)
  const yyyymm = reception ? reception.slice(0, 7) : null

  const rec = {
    meeting_date: meeting,
    issue_reception_date: reception,
    date_yyyy_mm: yyyymm,
    fiscal_year: getFiscalYear(yyyymm),
    fiscal_month: getFiscalMonth(yyyymm),
    ship_to: toStr(r.ship_to),
    dd: r.dd != null && r.dd !== '' ? (parseInt(r.dd, 10) || null) : null,
    ref_so: toId(r.ref_so),
    sc_number: toId(r.sc_number),
    item: toId(r.item),
    material_number: toId(r.material_number),
    sold_to: toStr(r.sold_to),
    department: toStr(r.department),
    brand: toStr(r.brand),
    plant: toStr(r.plant),
    categories: toStr(r.categories),
    status: STATUS_MAP[norm(r.status)] || 'not_started',
    quality_issue: toStr(r.quality_issue),
    root_cause: toStr(r.root_cause),
    corrective_action: toStr(r.corrective_action),
    corrective_action_no: toStr(r.corrective_action_no),
    cortex_data: toStr(r.cortex_data),
    affected_qty: r.affected_qty != null ? (parseInt(r.affected_qty, 10) || null) : null,
    total_qty: r.total_qty != null ? (parseInt(r.total_qty, 10) || null) : null,
    affected_pct: toNumber(r.affected_pct),
    cost_approx: toNumber(r.cost_approx),
    supplier_credit: toNumber(r.supplier_credit),
    legacy_link: toStr(r.legacy_link),
  }
  for (const [f, n] of Object.entries(COL_LIMIT)) rec[f] = clamp(rec[f], n)
  return rec
}

// Composite keys (strongest first). Each returned only when all its parts exist.
// Identifiers go through normId: a placeholder ('-') counts as absent, on the
// Excel row AND on the existing ticket. The customer is ship_to, or project_name
// for occurrences created in the app (ship_to is no longer entered since 2026-06-25).
function buildKeys(rec) {
  const sc = normId(rec.sc_number)
  const refso = normId(rec.ref_so)
  const item = normId(rec.item)
  const mat = normId(rec.material_number)
  const issue = norm(rec.quality_issue)
  const ship = norm(rec.ship_to || rec.project_name)
  const month = rec.issue_reception_date ? rec.issue_reception_date.slice(0, 7) : ''
  const strong = []
  if (sc && refso && item && mat && issue) strong.push(`k1|${sc}|${refso}|${item}|${mat}|${issue}`)
  if (sc && refso && item && issue)        strong.push(`k2|${sc}|${refso}|${item}|${issue}`)
  if (refso && item && mat && issue)       strong.push(`k3|${refso}|${item}|${mat}|${issue}`)
  const weak = []
  if (ship && month && issue)              weak.push(`k4|${ship}|${month}|${issue}`)
  return { strong, weak }
}
// Does an existing ticket contradict the Excel row? Both have an item and they
// differ, or the row's cost matches NEITHER the ticket's header cost (the value
// imported from the Excel, no longer editable) NOR its current cost (real_cost:
// lines, edited in the app — #2003 went from $373 to $2,963). An empty side
// contradicts nothing (imported tickets have no item; '-' is empty).
function contradicts(rec, t) {
  const ia = normId(rec.item), ib = normId(t.item)
  if (ia && ib && ia !== ib) return true
  const costs = [t.cost_approx, t.real_cost].filter(v => v != null).map(Number)
  if (rec.cost_approx != null && costs.length && !costs.some(c => Math.abs(Number(rec.cost_approx) - c) <= 0.005)) return true
  return false
}

// Identity of a row with no strong key, for duplicates WITHIN the Excel file.
// Cost and affected qty are part of it: same SC# + date + issue with different
// costs are distinct occurrences (several defects on one service call — 30 such
// groups in the data, see the 2026-09-08 duplicate audit).
function rowHash(rec) {
  const basis = [rec.sc_number, rec.ref_so, rec.item, rec.material_number,
    rec.issue_reception_date, rec.quality_issue, rec.ship_to, rec.department,
    rec.cost_approx, rec.affected_qty].map(norm).join('¦')
  return 'h|' + crypto.createHash('sha1').update(basis).digest('hex')
}

// ─── CLI ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { file: null, sheet: 'Data', commit: false, out: null, limit: 0 }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t === '--file') a.file = argv[++i]
    else if (t === '--sheet') a.sheet = argv[++i]
    else if (t === '--commit') a.commit = true
    else if (t === '--dry-run') a.commit = false
    else if (t === '--out') a.out = argv[++i]
    else if (t === '--limit') a.limit = parseInt(argv[++i], 10) || 0
  }
  return a
}

function readExcel(file, sheetName) {
  const buf = fs.readFileSync(file)
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false })
  const sheet = wb.Sheets[sheetName] || wb.Sheets[wb.SheetNames.find(s => s.toLowerCase() === 'data')] || wb.Sheets[wb.SheetNames[0]]
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found. Sheets: ${wb.SheetNames.join(', ')}`)
  return XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true })
}

// Pull every existing ticket's key-relevant fields (paginated; RLS bypassed by service key).
// All statuses, cancelled included: a cancelled duplicate still "exists".
// Read through tickets_with_cost for real_cost (the occurrence's cost from its
// lines, else the header), used to tell a re-typed copy from a distinct defect.
// ORDER BY id is required with .range(): without it Postgres returns pages in
// an arbitrary order — rows repeated, others missed, and a missed ticket would
// be re-inserted as "new".
async function loadExistingTickets(supabase) {
  const cols = 'id, occurrence_no, sc_number, ref_so, item, material_number, quality_issue, ship_to, project_name, '
    + 'issue_reception_date, department, cost_approx, real_cost'
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('tickets_with_cost').select(cols).order('id', { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw new Error('loadExistingTickets: ' + error.message)
    all.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return all
}

function analyze(excelRows, existing, limit) {
  // Index existing tickets by key. Each existing ticket can account for ONE Excel
  // row: once matched it is consumed, so a weak key (customer + month + issue)
  // never swallows a second, genuinely new row that merely looks alike.
  const byStrong = new Map()
  const byWeak = new Map()
  const index = (map, key, i) => { const a = map.get(key); if (a) a.push(i); else map.set(key, [i]) }
  const fieldCounts = { sc_number: 0, ref_so: 0, item: 0, material_number: 0, quality_issue: 0 }
  existing.forEach((t, i) => {
    for (const f of Object.keys(fieldCounts)) if (f === 'quality_issue' ? norm(t[f]) : normId(t[f])) fieldCounts[f]++
    const k = buildKeys(t)
    k.strong.forEach(x => index(byStrong, x, i))
    k.weak.forEach(x => index(byWeak, x, i))
  })
  const consumed = new Set()
  // `accept` filters candidates: for the weak key, an existing ticket that
  // CONTRADICTS the row (another item, another cost) is a different defect of
  // the same service call, not the same occurrence. Replay of the 2026-07-08
  // import: 9 rows sharing customer + month + issue with an existing ticket but
  // with other items or costs (#2185 items 10-30 $2,000 vs #484 item 60 $200)
  // are legitimate — a bare weak key would have dropped them.
  const take = (map, keys, accept = () => true) => {
    for (const k of keys) {
      const free = (map.get(k) || []).find(i => !consumed.has(i) && accept(existing[i]))
      if (free !== undefined) { consumed.add(free); return { key: k, ticket: existing[free] } }
    }
    return null
  }

  const report = {
    totalExcelRows: excelRows.length,
    existingTickets: existing.length,
    existingFieldCoverage: fieldCounts,
    emptyRows: 0, rejected: [], existingSkipped: 0, intraFileDup: 0,
    matchedByStrategy: { k1: 0, k2: 0, k3: 0, k4: 0 }, toInsertWeakKeyOnly: 0,
    // Rows that HAD strong keys but were recognised only by the weak key —
    // listed in the dry-run so they can be eyeballed before --commit.
    weakFallbackMatches: [],
    // Rows inserted although an existing ticket shares their weak key, because
    // item or cost differ — most are distinct defects, a few may be re-typed
    // copies (#2295 vs #2003: $2,963 vs $373). Listed for review, never skipped.
    possibleDuplicates: [],
    toInsert: [],
  }
  const seenStrong = new Set()
  const seenHash = new Set()

  let processed = 0
  excelRows.forEach((raw, idx) => {
    const rowNo = idx + 2 // +1 header, +1 to 1-based
    const isEmpty = Object.values(raw).every(v => v === null || String(v).trim() === '')
    if (isEmpty) { report.emptyRows++; return }
    if (limit && processed >= limit) return
    processed++

    const rec = mapRow(raw)
    if (!rec.quality_issue || !rec.issue_reception_date) {
      report.rejected.push({ rowNo, reason: !rec.quality_issue ? 'QUALITY ISSUE manquant' : 'ISSUE RECEPTION DATE invalide',
        sc_number: rec.sc_number, quality_issue: rec.quality_issue })
      return
    }
    const keys = buildKeys(rec)

    // Duplicate within the Excel file itself? Checked first: a repeated row must
    // not fall through to "new" once its existing ticket has been consumed.
    const dupKey = keys.strong[0] || rowHash(rec)
    if (keys.strong.some(k => seenStrong.has(k)) || seenHash.has(dupKey)) {
      report.intraFileDup++
      return
    }
    keys.strong.forEach(k => seenStrong.add(k))
    seenHash.add(dupKey)

    // Already in platform? Strong keys first, then the weak key whenever NO
    // strong key matched — not only when the row has none. Existing tickets
    // often lack `item` (moved to the lines since 2026-06-25, NULL on imported
    // rows), so a row with an item builds strong keys that can never match:
    // the 2026-07-08 import re-inserted 87 occurrences that way (#2295 too).
    const match = take(byStrong, keys.strong) || take(byWeak, keys.weak, t => !contradicts(rec, t))
    if (match) {
      report.existingSkipped++
      report.matchedByStrategy[match.key.slice(0, 2)]++
      if (match.key.startsWith('k4') && keys.strong.length) {
        report.weakFallbackMatches.push({ rowNo, sc_number: rec.sc_number, quality_issue: rec.quality_issue,
          matched: match.ticket.occurrence_no != null ? `#${match.ticket.occurrence_no}` : match.ticket.id || null })
      }
      return
    }

    const lookAlike = keys.weak.map(k => (byWeak.get(k) || []).find(i => !consumed.has(i))).find(i => i !== undefined)
    if (lookAlike !== undefined) {
      const t = existing[lookAlike]
      report.possibleDuplicates.push({ rowNo, sc_number: rec.sc_number, item: rec.item, cost_approx: rec.cost_approx,
        quality_issue: rec.quality_issue, existing: t.occurrence_no != null ? `#${t.occurrence_no}` : t.id || null,
        existingItem: t.item || null, existingCost: t.real_cost ?? t.cost_approx ?? null })
    }

    if (keys.strong.length === 0) report.toInsertWeakKeyOnly++
    report.toInsert.push({ rowNo, rec, weakKeyOnly: keys.strong.length === 0 })
  })
  return report
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.file) { console.error('ERROR: --file is required'); process.exit(1) }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY missing (server/.env)'); process.exit(1)
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } })

  console.log(`\n▶ Reading ${args.file} (sheet "${args.sheet}") …`)
  const excelRows = readExcel(args.file, args.sheet)
  console.log(`▶ Loading existing tickets from the platform …`)
  const existing = await loadExistingTickets(supabase)

  const report = analyze(excelRows, existing, args.limit)

  console.log('\n================ DRY-RUN REPORT ================')
  console.log('Excel rows read (incl. blanks) :', report.totalExcelRows)
  console.log('Blank rows skipped             :', report.emptyRows)
  console.log('Existing tickets in platform   :', report.existingTickets)
  console.log('  field coverage              :', JSON.stringify(report.existingFieldCoverage))
  console.log('Rejected (missing required)    :', report.rejected.length)
  console.log('Already existing → skipped     :', report.existingSkipped, '  by strategy:', JSON.stringify(report.matchedByStrategy))
  console.log('  of which weak key only       :', report.weakFallbackMatches.length, '(strong keys present but unmatched — listed below)')
  console.log('Look-alikes inserted (review)  :', report.possibleDuplicates.length, '(same customer + month + issue, other item or cost)')
  console.log('Duplicates within Excel        :', report.intraFileDup)
  console.log('NEW → would insert             :', report.toInsert.length, `(dont ${report.toInsertWeakKeyOnly} sans clé forte)`)
  console.log('===============================================')
  console.log('\nSample of first 20 rows that would be inserted:')
  report.toInsert.slice(0, 20).forEach(({ rowNo, rec, weakKeyOnly }) => {
    console.log(`  #${rowNo} ${weakKeyOnly ? '[weak] ' : ''}SC=${rec.sc_number || '-'} REF=${rec.ref_so || '-'} ITEM=${rec.item || '-'} ` +
      `date=${rec.issue_reception_date} dept=${rec.department || '-'} $${rec.cost_approx ?? '-'} :: ${String(rec.quality_issue).slice(0, 60)}`)
  })
  if (report.weakFallbackMatches.length) {
    console.log(`\nRecognised by the weak key only (customer + month + issue) — check before --commit:`)
    report.weakFallbackMatches.slice(0, 20).forEach(m =>
      console.log(`  #${m.rowNo} SC=${m.sc_number || '-'} → existing ${m.matched} :: ${String(m.quality_issue).slice(0, 60)}`))
  }
  if (report.possibleDuplicates.length) {
    console.log(`\nInserted although an existing ticket looks alike (other item or cost) — review:`)
    report.possibleDuplicates.slice(0, 20).forEach(p =>
      console.log(`  #${p.rowNo} SC=${p.sc_number || '-'} item=${p.item || '-'} $${p.cost_approx ?? '-'} vs ${p.existing} ` +
        `item=${p.existingItem || '-'} $${p.existingCost ?? '-'} :: ${String(p.quality_issue).slice(0, 50)}`))
  }
  if (report.rejected.length) {
    console.log(`\nFirst 10 rejected rows:`)
    report.rejected.slice(0, 10).forEach(r => console.log(`  #${r.rowNo} ${r.reason} (SC=${r.sc_number || '-'})`))
  }

  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify({ ...report, toInsert: report.toInsert.map(x => ({ rowNo: x.rowNo, ...x.rec })) }, null, 2))
    console.log(`\nFull report written to ${args.out}`)
  }

  if (!args.commit) {
    console.log('\nDRY-RUN only. No data was written. Re-run with --commit to insert.')
    return
  }

  // ── COMMIT ──
  console.log(`\n▶ COMMIT: inserting ${report.toInsert.length} new tickets …`)
  const payload = report.toInsert.map(x => x.rec)
  let inserted = 0
  const errors = []
  const insertedIds = []
  const BATCH = 100
  for (let i = 0; i < payload.length; i += BATCH) {
    const batch = payload.slice(i, i + BATCH)
    const { data, error } = await supabase.from('tickets').insert(batch).select('id')
    if (error) {
      // A batch is all-or-nothing in Postgres; retry row-by-row so one bad row
      // doesn't block the rest, and we can report the exact offending row.
      console.error(`  ! batch @row ${report.toInsert[i]?.rowNo} failed (${error.message}); retrying row-by-row…`)
      for (let j = 0; j < batch.length; j++) {
        const { data: d1, error: e1 } = await supabase.from('tickets').insert(batch[j]).select('id')
        if (e1) {
          errors.push({ rowNo: report.toInsert[i + j]?.rowNo, message: e1.message })
          console.error(`    ✗ row #${report.toInsert[i + j]?.rowNo}: ${e1.message}`)
        } else {
          inserted++
          ;(d1 || []).forEach(r => r && r.id && insertedIds.push(r.id))
        }
      }
    } else {
      inserted += (data || batch).length
      ;(data || []).forEach(r => r && r.id && insertedIds.push(r.id))
    }
  }
  // Persist inserted IDs for a precise rollback (delete exactly these rows).
  const idFile = path.join(process.cwd(), `import-inserted-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(idFile, JSON.stringify({ insertedIds, count: inserted, errors }, null, 2))
  console.log(`\nInserted IDs saved to ${idFile}`)
  console.log(`Rollback if needed: DELETE FROM tickets WHERE id IN (…ids from that file…);`)
  console.log('\n================ COMMIT REPORT ================')
  console.log('Inserted        :', inserted)
  console.log('Skipped existing :', report.existingSkipped)
  console.log('Rejected/dupes   :', report.rejected.length + report.intraFileDup)
  console.log('Batch errors     :', errors.length)
  errors.forEach(e => console.log(`  @row ${e.rowNo}: ${e.message}`))
  console.log('==============================================')
  console.log('\nRe-run the dry-run to confirm idempotency (NEW should now be 0).')
}

module.exports = { norm, normHeader, excelSerialToISO, toNumber, toStr, toId, normId, PLACEHOLDER_IDS, contradicts,
  getFiscalYear, getFiscalMonth, mapRow, buildKeys, rowHash, analyze, COLUMN_MAP, STATUS_MAP }

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1) })
}
