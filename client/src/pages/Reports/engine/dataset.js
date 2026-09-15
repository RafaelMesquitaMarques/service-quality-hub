// Construction du jeu de données du rapport : UNE LIGNE PAR ARTICLE.
//
// Modèle réel (vérifié sur les données, sept. 2026) :
//   appel de service (SC#, SAP)  1 ─ n  occurrence (tickets, « # »)  1 ─ n  lignes (occurrence_lines)
// - L'historique importé d'Excel crée une occurrence par ligne Excel : un même
//   SC# regroupe souvent plusieurs occurrences (381 SC# partagés).
// - Les occurrences saisies dans l'application portent n lignes.
// - 183 occurrences importées n'ont aucune ligne : elles donnent ici une ligne
//   « en-tête » (has_line = false) construite à partir de l'occurrence.
//
// Règles de repli ligne → en-tête (même convention que la liste et le tableau
// de bord pour la classification) :
// - catégorie, département, usine, cause racine, action corrective : repli sur
//   l'en-tête pour toute ligne non renseignée ;
// - item, Foliot ID, REF SO, quantités, crédit : repli UNIQUEMENT pour une
//   occurrence à une seule ligne. À la création, l'application recopie la
//   1re ligne dans l'en-tête (TicketModal) : replier les autres lignes sur
//   l'en-tête leur attribuerait l'item et les quantités de la ligne 1.
//
// Coûts : cost_approx de la ligne = mobilier + transport + installation − crédit
// (source de vérité de tous les totaux). Pour l'historique importé, ce coût vient
// de la colonne Excel « Cost approx (shipping incl.) », recopiée dans « mobilier »
// par la migration 2026-07-09 : pièce et transport n'y sont PAS séparables. Ces
// lignes sont marquées « legacy_total » et leur coût pièce reste non renseigné.

import { validScNumber } from './constants.js'

// Date de la migration « coût par ligne en 3 postes » : toute ligne créée avant
// avait un coût unique (souvent transport inclus), recopié tel quel dans
// « mobilier ». Vérifié sur les données : 106 lignes saisies dans l'application
// entre juin et le 8 juillet 2026 (55 297 $) sont dans ce cas, en plus de
// l'historique importé.
export const COST_SPLIT_SINCE = '2026-07-09'

const clean = (v) => {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') { const s = v.trim(); return s === '' ? null : s }
  return v
}
const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// tickets        : lignes de tickets_with_cost
// lines          : occurrence_lines
// profiles       : [{ id, full_name }]
// meetingLinks   : [{ ticket_id, meeting_date }]
// costEditedIds  : ids d'occurrences dont un coût de ligne a été modifié dans
//                  l'application (ticket_history « line:cost_* »)
export function buildRows({ tickets = [], lines = [], profiles = [], meetingLinks = [], costEditedIds = [] } = {}) {
  const profileName = new Map(profiles.map(p => [p.id, p.full_name]))
  const linesByOcc = new Map()
  for (const l of lines) {
    if (!linesByOcc.has(l.occurrence_id)) linesByOcc.set(l.occurrence_id, [])
    linesByOcc.get(l.occurrence_id).push(l)
  }
  const meetingsByOcc = new Map()
  for (const m of meetingLinks) {
    if (!m?.ticket_id || !m.meeting_date) continue
    if (!meetingsByOcc.has(m.ticket_id)) meetingsByOcc.set(m.ticket_id, new Set())
    meetingsByOcc.get(m.ticket_id).add(m.meeting_date)
  }
  const costEdited = new Set(costEditedIds)

  const rows = []
  for (const tk of tickets) {
    const ls = (linesByOcc.get(tk.id) || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.id).localeCompare(String(b.id)))
    const single = ls.length <= 1
    const origin = tk.created_by ? 'app' : 'import'
    const sc = clean(tk.sc_number)
    const validSc = validScNumber(sc)
    const hasLineCost = ls.some(l => l.cost_approx !== null && l.cost_approx !== undefined)
    // Même montant de transport (non nul) sur plusieurs lignes d'une occurrence :
    // souvent un transport saisi pour l'appel entier puis recopié sur chaque ligne
    // (55 occurrences en sept. 2026). Rien ne permet de le distinguer d'un transport
    // réellement propre à chaque ligne : on le SIGNALE, sans le dédoublonner.
    const freightCounts = new Map()
    for (const l of ls) {
      const f = num(l.cost_freight)
      if (f) freightCounts.set(f, (freightCounts.get(f) || 0) + 1)
    }
    // Coût retenu de l'occurrence : somme des lignes chiffrées, sinon en-tête
    // (règle getCost de la liste des occurrences).
    const occCost = hasLineCost
      ? ls.reduce((s, l) => s + (num(l.cost_approx) || 0), 0)
      : num(tk.cost_approx)

    const occ = {
      occurrence_id: tk.id,
      occurrence_no: num(tk.occurrence_no),
      sc_number: sc,
      call_key: validSc ? `sc:${validSc}` : `occ:${tk.id}`,
      has_valid_sc: !!validSc,
      status: clean(tk.status),
      urgency: clean(tk.urgency),
      issue_reception_date: clean(tk.issue_reception_date),
      delivery_date: clean(tk.delivery_date),
      wish_delivery_date: clean(tk.wish_delivery_date),
      meeting_date: clean(tk.meeting_date),
      occ_title: clean(tk.quality_issue),
      comment: clean(tk.comment),
      service_desk_notes: clean(tk.service_desk_notes),
      original_so: clean(tk.original_so),
      created_by_name: tk.created_by ? (profileName.get(tk.created_by) || null) : null,
      record_origin: origin,
      fiscal_year: num(tk.fiscal_year),
      lines_count: ls.length,
      installer_needed: tk.installer_needed === true ? true : tk.installer_needed === false ? false : null,
      ship_to: clean(tk.ship_to),
      project_name: clean(tk.project_name),
      sold_to: clean(tk.sold_to),
      brand: clean(tk.brand),
      review_meetings: [...(meetingsByOcc.get(tk.id) || [])].sort(),
      sd_completed_at: clean(tk.sd_completed_at),
      updated_at: clean(tk.updated_at),
      corrective_action_no: clean(tk.corrective_action_no),
      legacy_link: clean(tk.legacy_link),
      occ_cost: occCost,
    }

    const base = (key) => ({ ...occ, row_key: key })

    if (ls.length === 0) {
      const costNet = num(tk.cost_approx)
      rows.push(finalize({
        ...base(`${tk.id}:header`),
        line_id: null,
        line_no: null,
        has_line: false,
        line_title: clean(tk.quality_issue),
        description: null,
        item: clean(tk.item),
        foliot_id: clean(tk.material_number),
        ref_so: clean(tk.ref_so),
        completion_type: null,
        category: clean(tk.categories),
        category_source: clean(tk.categories) ? 'header' : 'none',
        department: clean(tk.department),
        plant: clean(tk.plant),
        root_cause: clean(tk.root_cause),
        corrective_action: clean(tk.corrective_action),
        affected_qty: num(tk.affected_qty),
        total_qty: num(tk.total_qty),
        cost_furniture: null,
        cost_freight: null,
        freight_repeated: null,
        cost_install: null,
        supplier_credit: num(tk.supplier_credit),
        cost_net: costNet,
        cost_split_status: costNet === null ? 'none' : origin === 'import' ? 'legacy_total' : 'occurrence_level',
      }))
      continue
    }

    ls.forEach((l, idx) => {
      const lineCost = num(l.cost_approx)
      let costNet = lineCost
      let split
      // Coût unique d'avant la ventilation : ligne importée, ou créée avant
      // COST_SPLIT_SINCE, dont le coût n'a jamais été repris poste par poste
      // (ni transport, ni installation, ni modification tracée, mobilier = total).
      const beforeSplit = origin === 'import' || (l.created_at ? String(l.created_at).slice(0, 10) < COST_SPLIT_SINCE : false)
      const legacyTotal = beforeSplit && lineCost !== null
        && l.cost_freight == null && l.cost_install == null && !costEdited.has(tk.id)
        && (l.cost_furniture == null || num(l.cost_furniture) === lineCost)
      if (lineCost !== null) split = legacyTotal ? 'legacy_total' : 'split'
      else if (!hasLineCost && idx === 0 && num(tk.cost_approx) !== null) {
        // Aucune ligne chiffrée mais un coût d'en-tête (saisie antérieure au coût
        // par ligne) : le coût appartient à l'occurrence. Porté UNE seule fois,
        // sur la 1re ligne, pour ne pas le multiplier par le nombre de lignes.
        costNet = num(tk.cost_approx)
        split = origin === 'import' ? 'legacy_total' : 'occurrence_level'
      } else split = 'none'

      rows.push(finalize({
        ...base(l.id),
        line_id: l.id,
        line_no: (l.sort_order ?? idx) + 1,
        has_line: true,
        line_title: clean(l.quality_issue),
        description: clean(l.description),
        item: clean(l.line_item) ?? (single ? clean(tk.item) : null),
        foliot_id: clean(l.foliot_id) ?? (single ? clean(tk.material_number) : null),
        ref_so: clean(l.ref_so) ?? (single ? clean(tk.ref_so) : null),
        completion_type: clean(l.completion_type),
        category: clean(l.categories) ?? clean(tk.categories),
        category_source: clean(l.categories) ? 'line' : clean(tk.categories) ? 'header' : 'none',
        department: clean(l.department) ?? clean(tk.department),
        plant: clean(l.plant) ?? clean(tk.plant),
        root_cause: clean(l.root_cause) ?? clean(tk.root_cause),
        corrective_action: clean(l.corrective_action) ?? clean(tk.corrective_action),
        affected_qty: num(l.affected_qty) ?? (single ? num(tk.affected_qty) : null),
        total_qty: num(l.total_qty) ?? (single ? num(tk.total_qty) : null),
        cost_furniture: split === 'split' ? num(l.cost_furniture) : null,
        cost_freight: num(l.cost_freight),
        freight_repeated: num(l.cost_freight) ? freightCounts.get(num(l.cost_freight)) > 1 : null,
        cost_install: num(l.cost_install),
        supplier_credit: num(l.supplier_credit) ?? (single ? num(tk.supplier_credit) : null),
        cost_net: costNet,
        cost_split_status: split,
      }))
    })
  }
  return rows
}

function finalize(r) {
  r.affected_pct_calc = r.affected_qty !== null && r.total_qty ? r.affected_qty / r.total_qty : null
  // Textes indexés pour la recherche textuelle (distincte de la classification).
  r.text_line = [r.line_title, r.description].filter(Boolean).join('\n') || null
  r.text_occ  = [r.occ_title, r.comment, r.service_desk_notes].filter(Boolean).join('\n') || null
  r.text_all  = [r.text_line, r.text_occ, r.root_cause, r.corrective_action].filter(Boolean).join('\n') || null
  return r
}
