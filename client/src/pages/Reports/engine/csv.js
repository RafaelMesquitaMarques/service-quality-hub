// CSV (RFC 4180) : séparateur virgule, fin de ligne CRLF, UTF-8 avec BOM (accents
// corrects à l'ouverture dans Excel). Champs contenant séparateur, guillemet ou
// saut de ligne entre guillemets, guillemets doublés.
// Injection de formules : un texte commençant par = + - @ tab ou CR est préfixé
// d'une apostrophe (recommandation OWASP) — seuls les TEXTES sont concernés,
// les nombres restent des nombres.

const FORMULA_START = /^[=+\-@\t\r]/

export function csvField(value, { isText = true, delimiter = ',' } = {}) {
  if (value === null || value === undefined) return ''
  let s = String(value)
  if (isText && FORMULA_START.test(s)) s = `'${s}`
  // Les deux séparateurs usuels déclenchent les guillemets, pas seulement celui
  // choisi : si Excel découpe avec l'autre (réglage régional différent), un
  // morceau « =… » ne doit pas devenir une cellule évaluée comme formule.
  if (s.includes(delimiter) || (isText && (s.includes(',') || s.includes(';'))) || s.includes('"') || s.includes('\n') || s.includes('\r') || /^\s|\s$/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`
  }
  return s
}

// header: [label] ; rows: [[{ value, isText }]]
export function toCsv(header, rows, { delimiter = ',', bom = true } = {}) {
  const lines = [header.map(h => csvField(h, { delimiter })).join(delimiter)]
  for (const row of rows) lines.push(row.map(c => csvField(c?.value, { isText: c?.isText !== false, delimiter })).join(delimiter))
  return (bom ? '\uFEFF' : '') + lines.join('\r\n') + '\r\n'
}
