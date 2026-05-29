const router = require('express').Router()
const multer = require('multer')
const XLSX = require('xlsx')
const supabase = require('../db/client')
const { requireAuth, requireRole } = require('../middleware/auth')

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

// Map Excel column names to DB field names
const COLUMN_MAP = {
  'MEETING DATE':            'meeting_date',
  'ISSUE RECEPTION DATE':    'issue_reception_date',
  'Date YYYY-MM':            'date_yyyy_mm',
  'Fiscal Year':             'fiscal_year',
  'Fiscal Month':            'fiscal_month',
  'DD':                      'dd',
  'SHIP TO':                 'ship_to',
  'DEPARTMENT':              'department',
  'STATUS':                  'status',
  'QUALITY ISSUE':           'quality_issue',
  'CATEGORIES':              'categories',
  'Cost approx (Shipping incl.)': 'cost_approx',
  'Supplier credit':         'supplier_credit',
  'AFFECTED QTY':            'affected_qty',
  'TOTAL QTY on Ref SO':     'total_qty',
  'AFFECTED %':              'affected_pct',
  'SC#':                     'sc_number',
  'REF SO':                  'ref_so',
  'ITEM':                    'item',
  'MATERIAL NUMBER  Foliot ID': 'material_number',
  'BRAND':                   'brand',
  'PLANT':                   'plant',
  'CORRECTIVE ACTION':       'corrective_action',
  'ROOT CAUSE':              'root_cause',
  'Corrective Action #':     'corrective_action_no',
  'Sold To':                 'sold_to',
  'Cortex Data':             'cortex_data',
  'LINK':                    'legacy_link',
}

const STATUS_MAP = {
  'not started': 'not_started',
  'wip':         'wip',
  'completed':   'completed',
  'cancelled':   'cancelled',
}

function excelDateToISO(val) {
  if (!val) return null
  if (typeof val === 'string' && val.includes('-')) return val.substring(0,10)
  if (typeof val === 'number') {
    const date = XLSX.SSF.parse_date_code(val)
    if (!date) return null
    const m = String(date.m).padStart(2,'0')
    const d = String(date.d).padStart(2,'0')
    return `${date.y}-${m}-${d}`
  }
  return null
}

function mapRow(row) {
  const mapped = {}
  for (const [excelCol, dbField] of Object.entries(COLUMN_MAP)) {
    if (row[excelCol] !== undefined) mapped[dbField] = row[excelCol]
  }

  // Normalize dates
  mapped.meeting_date         = excelDateToISO(mapped.meeting_date)
  mapped.issue_reception_date = excelDateToISO(mapped.issue_reception_date)

  // Normalize status
  if (mapped.status) {
    mapped.status = STATUS_MAP[String(mapped.status).toLowerCase().trim()] || 'not_started'
  } else {
    mapped.status = 'not_started'
  }

  // Clean up numeric fields
  if (mapped.cost_approx)    mapped.cost_approx    = parseFloat(mapped.cost_approx) || null
  if (mapped.supplier_credit) mapped.supplier_credit = parseFloat(mapped.supplier_credit) || null
  if (mapped.affected_qty)   mapped.affected_qty   = parseInt(mapped.affected_qty) || null
  if (mapped.total_qty)      mapped.total_qty      = parseInt(mapped.total_qty) || null
  if (mapped.affected_pct)   mapped.affected_pct   = parseFloat(mapped.affected_pct) || null
  if (mapped.dd)             mapped.dd             = parseInt(mapped.dd) || null
  if (mapped.fiscal_year)    mapped.fiscal_year    = parseInt(mapped.fiscal_year) || null
  if (mapped.fiscal_month)   mapped.fiscal_month   = parseInt(mapped.fiscal_month) || null

  return mapped
}

// POST /api/import/excel
router.post('/excel', requireAuth, requireRole('admin', 'manager'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false })

  // Try 'Data Quality' sheet first, then 'Data', then first sheet
  const sheetName =
    workbook.SheetNames.find(s => s === 'Data Quality') ||
    workbook.SheetNames.find(s => s === 'Data') ||
    workbook.SheetNames[0]

  const sheet = workbook.Sheets[sheetName]
  const rows  = XLSX.utils.sheet_to_json(sheet, { defval: null })

  const records = rows
    .map(mapRow)
    .filter(r => r.quality_issue && r.issue_reception_date)

  let imported = 0, skipped = 0, errors = []

  // Batch upsert in chunks of 100
  for (let i = 0; i < records.length; i += 100) {
    const chunk = records.slice(i, i + 100)
    const { error } = await supabase
      .from('tickets')
      .upsert(chunk, {
        onConflict: 'sc_number',
        ignoreDuplicates: req.query.skipDuplicates === 'true'
      })

    if (error) {
      errors.push({ chunk: i, message: error.message })
      skipped += chunk.length
    } else {
      imported += chunk.length
    }
  }

  res.json({
    message: 'Import complete',
    sheet: sheetName,
    total: records.length,
    imported,
    skipped,
    errors: errors.length > 0 ? errors : undefined
  })
})

// POST /api/import/preview — returns first 20 rows without saving
router.post('/preview', requireAuth, requireRole('admin', 'manager'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' })
  const sheetName =
    workbook.SheetNames.find(s => s === 'Data Quality') ||
    workbook.SheetNames.find(s => s === 'Data') ||
    workbook.SheetNames[0]

  const sheet = workbook.Sheets[sheetName]
  const rows  = XLSX.utils.sheet_to_json(sheet, { defval: null })
  const records = rows.map(mapRow).filter(r => r.quality_issue).slice(0, 20)

  res.json({
    sheet: sheetName,
    sheets: workbook.SheetNames,
    total_rows: rows.length,
    preview: records
  })
})

module.exports = router
