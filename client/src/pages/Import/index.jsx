import { useState, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { useTranslation } from 'react-i18next'
import { PageHeader, Spinner } from '../../components/ui'
import { supabase } from '../../services/supabase'
import { getFiscalYear, getFiscalMonth } from '../../services/api'
import toast from 'react-hot-toast'

// ── SAP S/4HANA column mapping ─────────────────────────────────────────────
// Maps common SAP export column names → SQH field names
const SAP_MAP = {
  // Sales Order
  'vbeln':                    'sc_number',
  'sales order':              'sc_number',
  'sales document':           'sc_number',
  'so number':                'sc_number',
  'sc#':                      'sc_number',
  'sc number':                'sc_number',
  // Date
  'erdat':                    'date_yyyy_mm',
  'creation date':            'date_yyyy_mm',
  'date':                     'date_yyyy_mm',
  'issue date':               'date_yyyy_mm',
  'reception date':           'date_yyyy_mm',
  'date reception':           'date_yyyy_mm',
  'issue_reception_date':     'date_yyyy_mm',
  // Ship To
  'kunnr':                    'ship_to',
  'ship-to party':            'ship_to',
  'ship to':                  'ship_to',
  'ship_to':                  'ship_to',
  'customer':                 'ship_to',
  'sold-to party':            'sold_to',
  'sold to':                  'sold_to',
  'sold_to':                  'sold_to',
  // Issue
  'quality issue':            'quality_issue',
  'quality_issue':            'quality_issue',
  'issue':                    'quality_issue',
  'problem':                  'quality_issue',
  'description':              'quality_issue',
  'problème':                 'quality_issue',
  'probleme':                 'quality_issue',
  // Brand
  'brand':                    'brand',
  'marque':                   'brand',
  'division':                 'brand',
  // Department
  'department':               'department',
  'département':              'department',
  'dept':                     'department',
  'cost center':              'department',
  // Plant
  'plant':                    'plant',
  'werks':                    'plant',
  'usine':                    'plant',
  // Cost
  'netwr':                    'cost_approx',
  'net value':                'cost_approx',
  'cost':                     'cost_approx',
  'cost_approx':              'cost_approx',
  'coût':                     'cost_approx',
  'cout':                     'cost_approx',
  'amount':                   'cost_approx',
  'montant':                  'cost_approx',
  // Status
  'status':                   'status',
  'statut':                   'status',
  // Category
  'category':                 'categories',
  'catégorie':                'categories',
  'categorie':                'categories',
  // REF SO
  'ref so':                   'ref_so',
  'ref_so':                   'ref_so',
  'reference':                'ref_so',
  // Qty
  'qty':                      'affected_qty',
  'quantity':                 'affected_qty',
  'quantité':                 'affected_qty',
  'affected qty':             'affected_qty',
}

const STATUS_MAP = {
  'open':         'not_started',
  'ouvert':       'not_started',
  'not started':  'not_started',
  'new':          'not_started',
  'in progress':  'wip',
  'en cours':     'wip',
  'wip':          'wip',
  'closed':       'completed',
  'completed':    'completed',
  'complété':     'completed',
  'complete':     'completed',
  'cancelled':    'cancelled',
  'canceled':     'cancelled',
  'annulé':       'cancelled',
}

function normalizeKey(k) {
  return String(k).toLowerCase().trim().replace(/_/g, ' ')
}

function parseDate(val) {
  if (!val) return null
  // Excel serial number
  if (typeof val === 'number' && val > 40000) {
    const d = XLSX.SSF.parse_date_code(val)
    if (d) {
      const mm = String(d.m).padStart(2,'0')
      return `${d.y}-${mm}`
    }
  }
  const s = String(val).trim()
  // YYYY-MM-DD or YYYY-MM
  const m1 = s.match(/^(\d{4})-(\d{2})/)
  if (m1) return `${m1[1]}-${m1[2]}`
  // DD/MM/YYYY or MM/DD/YYYY
  const m2 = s.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})/)
  if (m2) {
    const y = m2[3], a = m2[1], b = m2[2]
    const month = Number(a) > 12 ? b : a
    return `${y}-${month.padStart(2,'0')}`
  }
  // YYYYMMDD
  const m3 = s.match(/^(\d{4})(\d{2})(\d{2})/)
  if (m3) return `${m3[1]}-${m3[2]}`
  return null
}

function parseCost(val) {
  if (!val) return null
  const n = Number(String(val).replace(/[$,\s]/g,''))
  return isNaN(n) ? null : Math.round(n * 100) / 100
}

function mapRow(row, colMap) {
  const mapped = {}
  Object.entries(row).forEach(([k, v]) => {
    const nk = normalizeKey(k)
    const field = colMap[nk] || SAP_MAP[nk]
    if (field && v !== undefined && v !== null && v !== '') {
      mapped[field] = v
    }
  })
  // Normalise fields
  if (mapped.date_yyyy_mm) mapped.date_yyyy_mm = parseDate(mapped.date_yyyy_mm)
  if (mapped.cost_approx)  mapped.cost_approx  = parseCost(mapped.cost_approx)
  if (mapped.status)       mapped.status       = STATUS_MAP[String(mapped.status).toLowerCase().trim()] || 'not_started'
  if (mapped.sc_number)    mapped.sc_number    = String(mapped.sc_number).trim()
  // Fiscal year/month from date
  if (mapped.date_yyyy_mm) {
    mapped.fiscal_year  = getFiscalYear(mapped.date_yyyy_mm)
    mapped.fiscal_month = getFiscalMonth(mapped.date_yyyy_mm)
  }
  if (!mapped.status) mapped.status = 'not_started'
  return mapped
}

function validateRow(row, i) {
  const errors = []
  if (!row.quality_issue && !row.sc_number) errors.push('Issue ou SC# obligatoire')
  if (!row.date_yyyy_mm) errors.push('Date invalide')
  return errors
}

// ── Component ──────────────────────────────────────────────────────────────
export default function ImportPage() {
  const { t } = useTranslation()
  const [step,     setStep]     = useState('upload') // upload | preview | result
  const [loading,  setLoading]  = useState(false)
  const [rows,     setRows]     = useState([])
  const [colMap,   setColMap]   = useState({})
  const [headers,  setHeaders]  = useState([])
  const [rawCols,  setRawCols]  = useState([])
  const [errors,   setErrors]   = useState({})
  const [dupes,    setDupes]    = useState(new Set())
  const [result,   setResult]   = useState(null)
  const [fileName, setFileName] = useState('')

  const handleFile = useCallback(async (file) => {
    if (!file) return
    setLoading(true)
    setFileName(file.name)
    try {
      const buf  = await file.arrayBuffer()
      const wb   = XLSX.read(buf, { type:'array', cellDates: false })
      const ws   = wb.Sheets[wb.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json(ws, { raw: true, defval: '' })
      if (!data.length) { toast.error('Fichier vide'); return }

      const cols = Object.keys(data[0])
      setRawCols(cols)
      setHeaders(cols)

      // Auto-detect column mapping
      const autoMap = {}
      cols.forEach(c => {
        const nk = normalizeKey(c)
        if (SAP_MAP[nk]) autoMap[nk] = SAP_MAP[nk]
      })
      setColMap(autoMap)

      // Map rows
      const mapped = data.map(r => mapRow(r, autoMap))
      setRows(mapped)

      // Validate
      const errs = {}
      mapped.forEach((r, i) => {
        const e = validateRow(r, i)
        if (e.length) errs[i] = e
      })
      setErrors(errs)

      // Check duplicates in DB
      const scNums = mapped.map(r => r.sc_number).filter(Boolean)
      if (scNums.length) {
        const { data: existing } = await supabase
          .from('tickets').select('sc_number').in('sc_number', scNums)
        const existingSet = new Set((existing || []).map(e => e.sc_number))
        setDupes(existingSet)
      }

      setStep('preview')
    } catch (e) {
      console.error(e)
      toast.error('Erreur lecture fichier')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleDrop = (e) => {
    e.preventDefault()
    handleFile(e.dataTransfer.files[0])
  }

  const handleImport = async () => {
    setLoading(true)
    try {
      const valid = rows.filter((r, i) => !errors[i] && !dupes.has(r.sc_number))
      const toInsert = valid.map(r => ({
        quality_issue:    r.quality_issue || '(sans titre)',
        sc_number:        r.sc_number     || null,
        date_yyyy_mm:     r.date_yyyy_mm  || null,
        // issue_reception_date est une colonne DATE — 'YYYY-MM' seul est rejeté par Postgres
        issue_reception_date: r.date_yyyy_mm ? `${r.date_yyyy_mm}-01` : null,
        ship_to:          r.ship_to       || null,
        sold_to:          r.sold_to       || null,
        brand:            r.brand         || null,
        department:       r.department    || null,
        plant:            r.plant         || null,
        categories:       r.categories    || null,
        ref_so:           r.ref_so        || null,
        affected_qty:     r.affected_qty  || null,
        cost_approx:      r.cost_approx   || null,
        status:           r.status        || 'not_started',
        fiscal_year:      r.fiscal_year   || null,
        fiscal_month:     r.fiscal_month  || null,
      }))

      const BATCH = 100
      let imported = 0
      for (let i = 0; i < toInsert.length; i += BATCH) {
        const { error } = await supabase.from('tickets').insert(toInsert.slice(i, i + BATCH))
        if (error) throw error
        imported += Math.min(BATCH, toInsert.length - i)
      }

      setResult({ imported, skipped: rows.length - valid.length, errors: Object.keys(errors).length, dupes: dupes.size })
      setStep('result')
      toast.success(`${imported} tickets importés!`)
    } catch (e) {
      console.error(e)
      toast.error('Erreur import: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const reset = () => { setStep('upload'); setRows([]); setErrors({}); setDupes(new Set()); setResult(null); setFileName('') }

  const validCount = rows.filter((r, i) => !errors[i] && !dupes.has(r.sc_number)).length
  const dupeCount  = rows.filter(r => dupes.has(r.sc_number)).length
  const errorCount = Object.keys(errors).length

  // ── Render ──
  return (
    <>
      <PageHeader
        title="Import SAP / Excel"
        subtitle="Import tickets from S/4HANA or an Excel file"
      />

      <div className="flex-1 overflow-y-auto p-5 bg-gray-50 dark:bg-[#0D1117]">
        <div className="max-w-4xl space-y-4">

          {/* ── STEP: Upload ── */}
          {step === 'upload' && (
            <div className="card p-6">
              <div className="mb-4">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Colonnes SAP S/4HANA reconnues automatiquement</div>
                <div className="text-xs text-gray-400 flex flex-wrap gap-1 mt-2">
                  {['VBELN', 'ERDAT', 'KUNNR', 'NETWR', 'WERKS', 'Sales Order', 'Ship-To Party', 'Net Value', 'Plant', 'Cost Center'].map(c => (
                    <span key={c} className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded font-mono">{c}</span>
                  ))}
                  <span className="text-gray-400">+ custom formats</span>
                </div>
              </div>

              <div
                className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-10 text-center cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors bg-gray-50 dark:bg-[#161B22]"
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-input').click()}
              >
                {loading ? <Spinner /> : (
                  <>
                    <i className="ti ti-file-spreadsheet text-4xl text-gray-300 dark:text-gray-600 block mb-3" aria-hidden="true" />
                    <div className="font-medium text-gray-600 dark:text-gray-300">Drag file here or click to select</div>
                    <div className="text-xs text-gray-400 mt-1">Excel .xlsx or .xls — SAP export or custom format</div>
                    <button className="btn-primary mt-4">Select file</button>
                  </>
                )}
              </div>
              <input id="file-input" type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => handleFile(e.target.files[0])} />
            </div>
          )}

          {/* ── STEP: Preview ── */}
          {step === 'preview' && (
            <>
              {/* Summary bar */}
              <div className="card p-4 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fileName}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{rows.length} rows read</div>
                </div>
                <div className="flex items-center gap-3 text-xs flex-wrap">
                  <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400 font-medium">
                    <i className="ti ti-circle-check" aria-hidden="true" /> {validCount} to import
                  </span>
                  {dupeCount > 0 && (
                    <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
                      <i className="ti ti-copy" aria-hidden="true" /> {dupeCount} duplicate{dupeCount > 1 ? 's' : ''}
                    </span>
                  )}
                  {errorCount > 0 && (
                    <span className="flex items-center gap-1.5 text-red-500 font-medium">
                      <i className="ti ti-alert-circle" aria-hidden="true" /> {errorCount} error{errorCount > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button className="btn-ghost text-xs" onClick={reset}>Annuler</button>
                  <button className="btn-primary text-xs" onClick={handleImport} disabled={loading || validCount === 0}>
                    {loading ? <Spinner size="sm" /> : `Import ${validCount} tickets`}
                  </button>
                </div>
              </div>

              {/* Column mapping */}
              <div className="card p-4">
                <div className="text-xs font-semibold text-gray-900 dark:text-gray-100 mb-3">Detected column mapping</div>
                <div className="grid grid-cols-2 gap-2">
                  {rawCols.map(col => {
                    const nk = normalizeKey(col)
                    const mapped = colMap[nk] || SAP_MAP[nk]
                    return (
                      <div key={col} className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-gray-500 dark:text-gray-400 truncate w-32">{col}</span>
                        <i className={`ti ${mapped ? 'ti-arrow-right text-green-500' : 'ti-minus text-gray-300'}`} aria-hidden="true" />
                        <span className={mapped ? 'text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-300 dark:text-gray-600 italic'}>
                          {mapped || 'ignored'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Preview table */}
              <div className="card overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-900 dark:text-gray-100">
                  Aperçu — {Math.min(rows.length, 20)} first rows
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 dark:bg-[#161B22]">
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="px-3 py-2 text-left text-gray-400 font-medium">#</th>
                        {['SC#','Date','Ship To','Issue','Brand','Dept.','Cost','Status'].map(h => (
                          <th key={h} className="px-3 py-2 text-left text-gray-400 uppercase font-medium">{h}</th>
                        ))}
                        <th className="px-3 py-2 text-left text-gray-400 font-medium">État</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 20).map((row, i) => {
                        const isDupe = dupes.has(row.sc_number)
                        const hasErr = !!errors[i]
                        return (
                          <tr key={i} className={`border-b border-gray-100 dark:border-gray-800 ${
                            isDupe ? 'bg-amber-50/50 dark:bg-amber-900/10' :
                            hasErr ? 'bg-red-50/50 dark:bg-red-900/10' : ''
                          }`}>
                            <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                            <td className="px-3 py-2 font-mono text-gray-500 dark:text-gray-400">{row.sc_number || '—'}</td>
                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{row.date_yyyy_mm || '—'}</td>
                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400 max-w-24 truncate">{row.ship_to || '—'}</td>
                            <td className="px-3 py-2 text-gray-900 dark:text-gray-100 max-w-40 truncate">{row.quality_issue || '—'}</td>
                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{row.brand || '—'}</td>
                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{row.department || '—'}</td>
                            <td className="px-3 py-2 font-mono text-gray-900 dark:text-gray-100">{row.cost_approx ? `$${row.cost_approx.toLocaleString()}` : '—'}</td>
                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{row.status}</td>
                            <td className="px-3 py-2">
                              {isDupe ? (
                                <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">duplicate</span>
                              ) : hasErr ? (
                                <span className="px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-medium" title={errors[i]?.join(', ')}>error</span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-medium">✓ ok</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ── STEP: Result ── */}
          {step === 'result' && result && (
            <div className="card p-6">
              <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 rounded-xl mb-4">
                <i className="ti ti-circle-check text-2xl text-green-600 dark:text-green-400" aria-hidden="true" />
                <div>
                  <div className="font-semibold text-green-800 dark:text-green-300">{result.imported} tickets importés avec succès</div>
                  <div className="text-sm text-green-600 dark:text-green-400 mt-0.5">
                    {result.dupes > 0 && `${result.dupes} duplicates skipped · `}
                    {result.errors > 0 && `${result.errors} errors skipped`}
                  </div>
                </div>
              </div>
              <button className="btn-ghost" onClick={reset}>New import</button>
            </div>
          )}

        </div>
      </div>
    </>
  )
}
