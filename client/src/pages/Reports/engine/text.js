// Recherche textuelle : insensible à la casse et aux accents, correspondance en
// DÉBUT DE MOT. « screw » trouve « screws » et « drawer-screw », mais « vis » ne
// trouve pas « révision ». Une expression de plusieurs mots (« not received »)
// est cherchée telle quelle, espaces normalisés.

export function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function cleanTerms(terms) {
  return [...new Set((terms || []).map(normalizeText).filter(Boolean))]
}

// Renvoie (texte) => booléen : vrai si au moins un terme apparaît en début de mot.
export function termMatcher(terms) {
  const res = cleanTerms(terms).map(t => new RegExp('(^|[^a-z0-9])' + escapeRe(t)))
  if (!res.length) return () => false
  return (text) => {
    if (text === null || text === undefined || text === '') return false
    const n = normalizeText(text)
    return res.some(r => r.test(n))
  }
}
