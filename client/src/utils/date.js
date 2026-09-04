// Helpers de dates partagés.
//
// Piège corrigé ici : les colonnes DATE (issue_reception_date, delivery_date,
// wish_delivery_date, meeting_date, action.due) reviennent de Supabase sous la
// forme « YYYY-MM-DD ». `new Date('2026-09-03')` interprète cette chaîne en UTC
// (minuit UTC) ; réaffichée en heure locale (UTC−4/−5 au Québec) elle recule
// d'un jour → la saisie du 3 septembre s'affichait « 2026-09-02 ».
// Une date sans heure n'a pas de fuseau : on la formate telle quelle, sans
// jamais la faire passer par `Date`.

// « YYYY-MM-DD » exactement — une valeur avec heure (TIMESTAMPTZ) ne matche pas.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

// Format d'affichage historique de l'app : fr-CA rend « YYYY-MM-DD ».
const DATE_OPTS = { day: '2-digit', month: '2-digit', year: 'numeric' }
const TIME_OPTS = { ...DATE_OPTS, hour: '2-digit', minute: '2-digit' }

// Date seule (sans heure). `empty` : ce qu'on rend quand la valeur est absente.
export function formatDate(d, empty = '—') {
  if (!d) return empty
  const s = String(d)
  if (DATE_ONLY_RE.test(s)) return s          // colonne DATE : aucune conversion
  const dt = new Date(s)
  if (Number.isNaN(dt.getTime())) return s    // valeur non parsable : on rend le brut
  return dt.toLocaleDateString('fr-CA', DATE_OPTS)
}

// Horodatage (TIMESTAMPTZ) : là, la conversion en heure locale est voulue.
export function formatDateTime(d, empty = '—') {
  if (!d) return empty
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return String(d)
  return dt.toLocaleString('fr-CA', TIME_OPTS)
}

// Aujourd'hui en « YYYY-MM-DD », dans le fuseau de l'utilisateur.
// `new Date().toISOString().slice(0,10)` donnait la date UTC : en soirée au
// Québec (après 20 h), elle avançait déjà au lendemain.
export function todayISO() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Échéance dépassée ? Comparaison de dates seules : une action due aujourd'hui
// n'est pas en retard (`new Date(due) < new Date()` la marquait en retard toute
// la journée, minuit UTC tombant la veille en heure locale).
export function isPastDate(d) {
  if (!d) return false
  return String(d).slice(0, 10) < todayISO()
}
