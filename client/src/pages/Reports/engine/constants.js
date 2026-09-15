// Constantes partagées du module Rapports.
// Le moteur (dossier engine/) est volontairement pur : aucune dépendance à React,
// Supabase ou i18next, pour être testable sous Node (`npm run test:reports`).
// Les imports internes portent leur extension « .js » : Vite l'accepte et Node
// l'exige pour résoudre les modules ESM.

// Valeur « non renseignée » dans les filtres et les regroupements. Neutre et
// stable (enregistrée dans les configurations), traduite seulement à l'affichage.
export const EMPTY = '__empty__'

// Version du format de configuration enregistré dans saved_reports.config.
export const CONFIG_VERSION = 1

// Ordre du flux (TicketDetail) + statut hérité « wip » des imports.
export const STATUS_ORDER = ['not_started', 'service_desk', 'sd_waiting_info', 'quality_meeting', 'wip', 'completed', 'cancelled']
export const URGENCY_ORDER = ['overnight', 'urgent', 'normal']

// Champs de date utilisables pour définir la période (colonnes DATE de l'en-tête).
export const PERIOD_FIELDS = ['issue_reception_date', 'delivery_date', 'wish_delivery_date', 'meeting_date']

export const RELATIVE_PRESETS = [
  'current_month', 'previous_month', 'last_3_months', 'last_12_months',
  'current_fiscal_year', 'previous_fiscal_year', 'fiscal_ytd',
  'current_year', 'previous_year',
]

export const GRANULARITIES = ['line', 'occurrence', 'call']
export const TIME_BUCKETS = ['month', 'quarter', 'year', 'fiscal_quarter', 'fiscal_year']

// Un SC# vide ou de remplissage (« - » : 25 occurrences importées) n'identifie
// aucun appel : l'occurrence est alors comptée comme un appel à part entière.
export function validScNumber(sc) {
  const s = String(sc ?? '').trim()
  if (!s) return null
  if (/^[-–—?.0\s]+$/.test(s)) return null
  if (/^(n\/?a|tbd|none|aucun)$/i.test(s)) return null
  return s
}
