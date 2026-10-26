// Calendrier fiscal Foliot — module pur (aucune dépendance), partagé par l'app
// et par les tests Node du tableau de bord.
//
// L'année fiscale commence en décembre : décembre = mois fiscal 1 de l'année
// SUIVANTE (déc. 2025 → FY2026, mois 1 ; nov. 2026 → FY2026, mois 12).

export function getFiscalYear(dateYYYYMM) {
  if (!dateYYYYMM) return null
  const [year, month] = String(dateYYYYMM).split('-').map(Number)
  return month === 12 ? year + 1 : year
}

export function getFiscalMonth(dateYYYYMM) {
  if (!dateYYYYMM) return null
  const [, month] = String(dateYYYYMM).split('-').map(Number)
  return month === 12 ? 1 : month + 1
}

// Champs fiscaux dérivés d'une date de réception « YYYY-MM-DD » : les trois
// colonnes stockées sur tickets (date_yyyy_mm, fiscal_year, fiscal_month) que le
// tableau de bord et la liste lisent. null si la date est absente ou invalide.
export function fiscalFieldsOf(dateISO) {
  const ym = String(dateISO || '').slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(ym)) return null
  return { date_yyyy_mm: ym, fiscal_year: getFiscalYear(ym), fiscal_month: getFiscalMonth(ym) }
}

// « YYYY-MM-DD » d'une date, dans le fuseau de l'utilisateur (jamais via
// toISOString, qui donne la date UTC — le lendemain en soirée au Québec).
export function localISODate(d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Année fiscale en cours, calculée à partir de la date du jour. Remplace l'ancienne
// constante codée en dur (2026), qui figeait le tableau de bord et la liste sur
// FY2026 à partir du 1er décembre 2026.
export function currentFiscalYear(d = new Date()) {
  return getFiscalYear(localISODate(d).slice(0, 7))
}

export function currentFiscalMonth(d = new Date()) {
  return getFiscalMonth(localISODate(d).slice(0, 7))
}

// Années fiscales proposées dans les sélecteurs : de l'année en cours à `oldest`.
export function fiscalYearsDown(oldest, d = new Date()) {
  const years = []
  for (let y = currentFiscalYear(d); y >= oldest; y--) years.push(y)
  return years
}

export const FISCAL_MONTH_ORDER = [
  { fiscal: 1,  name: 'December',  nameShort: 'Dec' },
  { fiscal: 2,  name: 'January',   nameShort: 'Jan' },
  { fiscal: 3,  name: 'February',  nameShort: 'Feb' },
  { fiscal: 4,  name: 'March',     nameShort: 'Mar' },
  { fiscal: 5,  name: 'April',     nameShort: 'Apr' },
  { fiscal: 6,  name: 'May',       nameShort: 'May' },
  { fiscal: 7,  name: 'June',      nameShort: 'Jun' },
  { fiscal: 8,  name: 'July',      nameShort: 'Jul' },
  { fiscal: 9,  name: 'August',    nameShort: 'Aug' },
  { fiscal: 10, name: 'September', nameShort: 'Sep' },
  { fiscal: 11, name: 'October',   nameShort: 'Oct' },
  { fiscal: 12, name: 'November',  nameShort: 'Nov' },
]
