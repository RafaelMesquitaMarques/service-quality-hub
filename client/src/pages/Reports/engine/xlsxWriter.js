// Écriture .xlsx minimale (SpreadsheetML) — sans dépendance.
// SheetJS Community (xlsx 0.18) n'écrit ni volets figés ni styles : on produit
// directement l'OOXML, comme utils/xlsxImage.js pour l'export du tableau de bord.
//
// Types de cellule : s (texte partagé) · n (nombre) · d (date « YYYY-MM-DD »,
// convertie en numéro de série Excel SANS passer par un fuseau horaire) ·
// dt (horodatage, heure locale) · b (booléen).
// Les textes sont des chaînes : Excel ne les évalue jamais comme formules. Ceux
// qui commencent par = + - @ reçoivent en plus quotePrefix, pour rester du texte
// même si l'utilisateur modifie la cellule.

import { zip } from '../../../utils/zip.js'

const STYLE_INDEX = {
  default: 0, header: 1, text: 2, textq: 3, date: 4, datetime: 5, int: 6, money: 7, pct: 8,
  link: 9, bold: 10, title: 11, muted: 12, wrap: 13, boldmoney: 14, boldint: 15, boldpct: 16,
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/><numFmt numFmtId="166" formatCode="#,##0.00"/></numFmts>
<fonts count="5">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7EEF7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF9CA3AF"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="17">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" quotePrefix="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="49" fontId="3" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="49" fontId="4" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="166" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="1" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="10" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

// Caractères interdits en XML 1.0 (contrôles hors tab / LF / CR) retirés.
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g
export const xmlEscape = (s) => String(s).replace(INVALID_XML, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function colName(index) {
  let n = index + 1, s = ''
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) }
  return s
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30)
export function dateSerial(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate))
  if (!m) return null
  return (Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - EXCEL_EPOCH) / 86400000
}
export function dateTimeSerial(value) {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const local = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds())
  return (local - EXCEL_EPOCH) / 86400000
}

export function safeSheetName(name, used = new Set()) {
  let base = String(name || 'Feuille').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Feuille'
  let candidate = base, i = 2
  while (used.has(candidate.toLowerCase())) { const suffix = ` (${i++})`; candidate = base.slice(0, 31 - suffix.length) + suffix }
  used.add(candidate.toLowerCase())
  return candidate
}

const FORMULA_START = /^[=+\-@\t\r]/

// sheets: [{ name, columns: [{ width }], rows: [[cell|null]], freezeHeader, autoFilter,
//            hyperlinks: [{ row, col, url }] }]
// cell   : { t, v, s? }  (s = clé de STYLE_INDEX)
export async function buildXlsx({ sheets, title = '', creator = 'Checkmate', compress = true, onProgress } = {}) {
  const shared = [], sharedIndex = new Map()
  const sst = (str) => {
    let i = sharedIndex.get(str)
    if (i === undefined) { i = shared.length; shared.push(str); sharedIndex.set(str, i) }
    return i
  }
  const usedNames = new Set()
  const sheetNames = sheets.map(s => safeSheetName(s.name, usedNames))
  const files = []
  const totalRows = sheets.reduce((s, sh) => s + sh.rows.length, 0)
  let doneRows = 0

  const sheetXml = []
  for (let si = 0; si < sheets.length; si++) {
    const sheet = sheets[si]
    const rows = sheet.rows
    const maxCols = rows.reduce((m, r) => Math.max(m, r.length), Math.max(sheet.columns?.length || 0, 1))
    const parts = []
    parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">')
    const lastRef = `${colName(maxCols - 1)}${Math.max(rows.length, 1)}`
    parts.push(`<dimension ref="A1:${lastRef}"/>`)
    parts.push(`<sheetViews><sheetView workbookViewId="0"${si === 0 ? ' tabSelected="1"' : ''}>`)
    if (sheet.freezeHeader && rows.length > 0) {
      parts.push('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>')
    }
    parts.push('</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>')
    if (sheet.columns?.length) {
      parts.push('<cols>')
      sheet.columns.forEach((c, i) => parts.push(`<col min="${i + 1}" max="${i + 1}" width="${Math.max(4, Math.min(80, c.width || 12))}" customWidth="1"/>`))
      parts.push('</cols>')
    }
    parts.push('<sheetData>')
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]
      const cells = []
      for (let c = 0; c < row.length; c++) {
        const cell = row[c]
        if (!cell || cell.v === null || cell.v === undefined || cell.v === '') continue
        const ref = `${colName(c)}${r + 1}`
        if (cell.t === 'n') {
          const n = Number(cell.v)
          if (!Number.isFinite(n)) continue
          cells.push(`<c r="${ref}" s="${STYLE_INDEX[cell.s || 'default'] ?? 0}"><v>${n}</v></c>`)
        } else if (cell.t === 'd' || cell.t === 'dt') {
          const serial = cell.t === 'd' ? dateSerial(cell.v) : dateTimeSerial(cell.v)
          if (serial === null) { cells.push(`<c r="${ref}" s="2" t="s"><v>${sst(xmlEscape(String(cell.v)))}</v></c>`); continue }
          cells.push(`<c r="${ref}" s="${STYLE_INDEX[cell.s || (cell.t === 'd' ? 'date' : 'datetime')]}"><v>${serial}</v></c>`)
        } else if (cell.t === 'b') {
          cells.push(`<c r="${ref}" t="b"><v>${cell.v ? 1 : 0}</v></c>`)
        } else {
          const str = xmlEscape(String(cell.v))
          if (!str) continue
          const style = cell.s ? STYLE_INDEX[cell.s] : (FORMULA_START.test(String(cell.v)) ? STYLE_INDEX.textq : STYLE_INDEX.text)
          cells.push(`<c r="${ref}" s="${style}" t="s"><v>${sst(str)}</v></c>`)
        }
      }
      parts.push(`<row r="${r + 1}">${cells.join('')}</row>`)
      doneRows++
      if (onProgress && doneRows % 1000 === 0) { onProgress(doneRows / totalRows); await new Promise(res => setTimeout(res, 0)) }
    }
    parts.push('</sheetData>')
    if (sheet.autoFilter && rows.length > 0) parts.push(`<autoFilter ref="A1:${lastRef}"/>`)
    const links = (sheet.hyperlinks || []).filter(h => h.url)
    if (links.length) {
      parts.push('<hyperlinks>')
      links.forEach((h, i) => parts.push(`<hyperlink ref="${colName(h.col)}${h.row + 1}" r:id="rId${i + 1}"/>`))
      parts.push('</hyperlinks>')
    }
    parts.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>')
    sheetXml.push(parts.join(''))
    if (links.length) {
      files.push({
        name: `xl/worksheets/_rels/sheet${si + 1}.xml.rels`,
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${links.map((h, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(h.url)}" TargetMode="External"/>`).join('')}</Relationships>`,
      })
    }
  }

  const quoteSheet = (n) => `'${n.replace(/'/g, "''")}'`
  const definedNames = sheets.map((s, i) => {
    if (!s.autoFilter || !s.rows.length) return ''
    const maxCols = s.rows.reduce((m, r) => Math.max(m, r.length), Math.max(s.columns?.length || 0, 1))
    return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xmlEscape(quoteSheet(sheetNames[i]))}!$A$1:$${colName(maxCols - 1)}$${s.rows.length}</definedName>`
  }).join('')

  files.unshift(
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(title)}</dc:title><dc:creator>${xmlEscape(creator)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</dcterms:created></cp:coreProperties>` },
    { name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Checkmate</Application></Properties>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheetNames.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${definedNames ? `<definedNames>${definedNames}</definedNames>` : ''}</workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES_XML },
  )
  sheetXml.forEach((xml, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml }))
  files.push({
    name: 'xl/sharedStrings.xml',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map(s => `<si><t xml:space="preserve">${s}</t></si>`).join('')}</sst>`,
  })
  onProgress?.(1)
  return zip(files, { compress })
}
