// Client d'une occurrence + clé de regroupement tolérante — module pur.
//
// Depuis le 2026-06-25, les formulaires ne saisissent plus ship_to : le client
// des occurrences créées dans l'app est dans project_name, celui des occurrences
// importées dans ship_to (les deux portent la même valeur quand ils coexistent).
// Grouper sur ship_to seul figeait le « Top 10 clients » du tableau de bord sur
// l'historique importé.

const clean = v => (typeof v === 'string' ? v.trim() : '')

export function customerOf(tk) {
  return clean(tk?.project_name) || clean(tk?.ship_to) || null
}

// Clé de regroupement : casse, espaces multiples et espace avant une virgule
// ignorés — « H2S Henderson , NV » et « h2s henderson, NV » sont un même client.
export function groupKey(v) {
  const s = clean(v)
  if (!s) return ''
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/ ,/g, ',')
}

// Libellé d'une clé : l'orthographe la plus fréquente (à égalité, la première
// dans l'ordre alphabétique — résultat stable d'un rendu à l'autre).
export function makeLabeler() {
  const counts = new Map()   // clé → Map(orthographe → nb)
  return {
    add(key, spelling) {
      if (!key) return
      const m = counts.get(key) || new Map()
      m.set(spelling, (m.get(spelling) || 0) + 1)
      counts.set(key, m)
    },
    has: key => counts.has(key),
    label(key) {
      const m = counts.get(key)
      if (!m) return key
      return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][0]
    },
  }
}
