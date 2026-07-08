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

  return {
    meeting_date: meeting,
    issue_reception_date: reception,
    date_yyyy_mm: yyyymm,
    fiscal_year: getFiscalYear(yyyymm),
    fiscal_month: getFiscalMonth(yyyymm),
    ship_to: toStr(r.ship_to),
    dd: r.dd != null && r.dd !== '' ? (parseInt(r.dd, 10) || null) : null,
    ref_so: toStr(r.ref_so),
    sc_number: toStr(r.sc_number),
    item: toStr(r.item),
    material_number: toStr(r.material_number),
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
}

// Composite keys (strongest first). Each returned only when all its parts exist.
function buildKeys(rec) {
  const sc = norm(rec.sc_number)
  const refso = norm(rec.ref_so)
  const item = norm(rec.item)
  const mat = norm(rec.material_number)
  const issue = norm(rec.quality_issue)
  const ship = norm(rec.ship_to)
  const month = rec.issue_reception_date ? rec.issue_reception_date.slice(0, 7) : ''
  const strong = []
  if (sc && refso && item && mat && issue) strong.push(`k1|${sc}|${refso}|${item}|${mat}|${issue}`)
  if (sc && refso && item && issue)        strong.push(`k2|${sc}|${refso}|${item}|${issue}`)
  if (refso && item && mat && issue)       strong.push(`k3|${refso}|${item}|${mat}|${issue}`)
  const weak = []
  if (ship && month && issue)              weak.push(`k4|${ship}|${month}|${issue}`)
  return { strong, weak }
}
function rowHash(rec) {
  const basis = [rec.sc_number, rec.ref_so, rec.item, rec.material_number,
    rec.issue_reception_date, rec.quality_issue, rec.ship_to, rec.department].map(norm).join('¦')
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
async function loadExistingTickets(supabase) {
  const cols = 'id, sc_number, ref_so, item, material_number, quality_issue, ship_to, issue_reception_date, department'
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('tickets').select(cols).range(from, from + PAGE - 1)
    if (error) throw new Error('loadExistingTickets: ' + error.message)
    all.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return all
}

function analyze(excelRows, existing, limit) {
  // Index existing keys by strategy.
  const existingStrong = new Set()
  const existingWeak = new Set()
  const fieldCounts = { sc_number: 0, ref_so: 0, item: 0, material_number: 0, quality_issue: 0 }
  for (const t of existing) {
    for (const f of Object.keys(fieldCounts)) if (norm(t[f])) fieldCounts[f]++
    const k = buildKeys(t)
    k.strong.forEach(x => existingStrong.add(x))
    k.weak.forEach(x => existingWeak.add(x))
  }

  const report = {
    totalExcelRows: excelRows.length,
    existingTickets: existing.length,
    existingFieldCoverage: fieldCounts,
    emptyRows: 0, rejected: [], existingSkipped: 0, intraFileDup: 0,
    matchedByStrategy: { k1: 0, k2: 0, k3: 0, k4: 0 }, toInsertWeakKeyOnly: 0,
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

    // Already in platform?
    let matchStrategy = null
    for (const k of keys.strong) if (existingStrong.has(k)) { matchStrategy = k.slice(0, 2); break }
    if (!matchStrategy && keys.strong.length === 0) {
      for (const k of keys.weak) if (existingWeak.has(k)) { matchStrategy = k.slice(0, 2); break }
    }
    if (matchStrategy) {
      report.existingSkipped++
      report.matchedByStrategy[matchStrategy]++
      return
    }

    // Duplicate within the Excel file itself?
    const dupKey = keys.strong[0] || rowHash(rec)
    if (keys.strong.some(k => seenStrong.has(k)) || seenHash.has(dupKey)) {
      report.intraFileDup++
      return
    }
    keys.strong.forEach(k => seenStrong.add(k))
    seenHash.add(dupKey)

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
  console.log('Duplicates within Excel        :', report.intraFileDup)
  console.log('NEW → would insert             :', report.toInsert.length, `(dont ${report.toInsertWeakKeyOnly} sans clé forte)`)
  console.log('===============================================')
  console.log('\nSample of first 20 rows that would be inserted:')
  report.toInsert.slice(0, 20).forEach(({ rowNo, rec, weakKeyOnly }) => {
    console.log(`  #${rowNo} ${weakKeyOnly ? '[weak] ' : ''}SC=${rec.sc_number || '-'} REF=${rec.ref_so || '-'} ITEM=${rec.item || '-'} ` +
      `date=${rec.issue_reception_date} dept=${rec.department || '-'} $${rec.cost_approx ?? '-'} :: ${String(rec.quality_issue).slice(0, 60)}`)
  })
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
  const BATCH = 100
  for (let i = 0; i < payload.length; i += BATCH) {
    const batch = payload.slice(i, i + BATCH)
    const { data, error } = await supabase.from('tickets').insert(batch).select('id')
    if (error) {
      errors.push({ batchStart: report.toInsert[i]?.rowNo, size: batch.length, message: error.message })
      console.error(`  ✗ batch @row ${report.toInsert[i]?.rowNo}: ${error.message}`)
    } else {
      inserted += (data || batch).length
    }
  }
  console.log('\n================ COMMIT REPORT ================')
  console.log('Inserted        :', inserted)
  console.log('Skipped existing :', report.existingSkipped)
  console.log('Rejected/dupes   :', report.rejected.length + report.intraFileDup)
  console.log('Batch errors     :', errors.length)
  errors.forEach(e => console.log(`  @row ${e.batchStart} (${e.size}): ${e.message}`))
  console.log('==============================================')
  console.log('\nRe-run the dry-run to confirm idempotency (NEW should now be 0).')
}

module.exports = { norm, normHeader, excelSerialToISO, toNumber, toStr,
  getFiscalYear, getFiscalMonth, mapRow, buildKeys, rowHash, analyze, COLUMN_MAP, STATUS_MAP }

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1) })
}
