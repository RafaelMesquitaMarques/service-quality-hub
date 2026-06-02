// src/pages/Tickets/TicketDetail.jsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../services/supabase';
import { usePermissions } from '../../hooks/usePermissions';
import {
  ArrowLeft, CheckCircle, ChevronLeft, ChevronRight,
  Plus, Save, Lock, Edit2
} from 'lucide-react';

// ─── Status pipeline ───────────────────────────────────────────────────────
const STATUS_FLOW = ['not_started', 'service_desk', 'quality_meeting', 'completed'];
const TERMINAL = ['completed', 'cancelled'];

function statusIndex(s) { return STATUS_FLOW.indexOf(s); }
function nextStatus(s) {
  if (TERMINAL.includes(s)) return null;
  const i = statusIndex(s);
  return i < STATUS_FLOW.length - 1 ? STATUS_FLOW[i + 1] : null;
}
function prevStatus(s) {
  if (s === 'not_started' || s === 'cancelled') return null;
  if (s === 'completed') return 'quality_meeting';
  const i = statusIndex(s);
  return i > 0 ? STATUS_FLOW[i - 1] : null;
}

const STATUS_LABELS = {
  not_started:     { fr: 'Non commencé',   en: 'Not started' },
  service_desk:    { fr: 'Service Desk',   en: 'Service Desk' },
  quality_meeting: { fr: 'Quality Meeting',en: 'Quality Meeting' },
  completed:       { fr: 'Complété',       en: 'Completed' },
  cancelled:       { fr: 'Annulé',         en: 'Cancelled' },
};

const STATUS_BADGE = {
  not_started:     'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  service_desk:    'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200',
  quality_meeting: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200',
  completed:       'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200',
  cancelled:       'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200',
};

const ADVANCE_BTN = {
  not_started:     { fr: 'Envoyer au Service Desk',    en: 'Send to Service Desk' },
  service_desk:    { fr: 'Envoyer au Quality Meeting', en: 'Send to Quality Meeting' },
  quality_meeting: { fr: 'Marquer comme complété',     en: 'Mark as completed' },
};

const BRANDS = ['HIEX','HI','CI','CIS','EVEN','STAYBRIDGE','CANDLEWOOD'];
const CATEGORIES = ['Finish defect','Structural','Missing part','Wrong item','Packaging','Other'];
const DEPARTMENTS = ['Product Dev.','Production','QC','Logistics','Sales'];
const PLANTS = ['Canada','USA','Mexico','China','Vietnam'];

// ─── Fetch ──────────────────────────────────────────────────────────────────
async function fetchTicket(id) {
  const { data, error } = await supabase
    .from('tickets')
    .select('*, occurrence_lines(*, ticket_photos(*))')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function TicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const qc = useQueryClient();
  const { canEdit } = usePermissions();
  const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';

  const [editingHeader, setEditingHeader] = useState(false);
  const [headerDraft, setHeaderDraft] = useState(null);
  const [addingLine, setAddingLine] = useState(false);
  const [sdNotes, setSdNotes] = useState('');
  const [causeRacine, setCauseRacine] = useState('');
  const [actionCorrective, setActionCorrective] = useState('');
  const [resolution, setResolution] = useState('');
  const [saved, setSaved] = useState(false);

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => fetchTicket(id),
  });

  useEffect(() => {
    if (!ticket) return;
    setSdNotes(ticket.service_desk_notes || '');
    setCauseRacine(ticket.cause_racine || '');
    setActionCorrective(ticket.action_corrective || '');
    setResolution(ticket.resolution || '');
  }, [ticket?.id]);

  const advanceMutation = useMutation({
    mutationFn: async (newStatus) => {
      const updates = { status: newStatus };
      if (newStatus === 'service_desk') updates.submitted_at = new Date().toISOString();
      if (newStatus === 'completed') updates.sd_completed_at = new Date().toISOString();
      const { error } = await supabase.from('tickets').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(['ticket', id]),
  });

  const revertMutation = useMutation({
    mutationFn: async (newStatus) => {
      const { error } = await supabase.from('tickets').update({ status: newStatus }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(['ticket', id]),
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('tickets').update({ status: 'cancelled' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(['ticket', id]),
  });

  const saveHeaderMutation = useMutation({
    mutationFn: async (draft) => {
      const { error } = await supabase.from('tickets').update(draft).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries(['ticket', id]);
      setEditingHeader(false);
    },
  });

  const saveNotesMutation = useMutation({
    mutationFn: async (fields) => {
      const { error } = await supabase.from('tickets').update(fields).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries(['ticket', id]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  function startEditHeader() {
    setHeaderDraft({
      customer_name: ticket.customer_name || '',
      ship_to: ticket.ship_to || '',
      brand: ticket.brand || '',
      ref_so: ticket.ref_so || '',
      sc_number: ticket.sc_number || '',
      received_at: ticket.received_at || '',
    });
    setEditingHeader(true);
  }

  function saveNotes() {
    const fields = { service_desk_notes: sdNotes };
    if (['quality_meeting', 'completed'].includes(ticket.status)) {
      fields.cause_racine = causeRacine;
      fields.action_corrective = actionCorrective;
      fields.resolution = resolution;
    }
    saveNotesMutation.mutate(fields);
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Chargement...</div>;
  }
  if (!ticket) {
    return <div className="p-8 text-center text-gray-500">Occurrence introuvable</div>;
  }

  const currentStatus = ticket.status;
  const next = nextStatus(currentStatus);
  const prev = prevStatus(currentStatus);
  const isTerminal = TERMINAL.includes(currentStatus);
  const lines = ticket.occurrence_lines || [];
  const totalApprox = lines.reduce((s, l) => s + (parseFloat(l.cost_approx) || 0), 0);
  const totalFinal = lines.reduce((s, l) => s + (parseFloat(l.cost_final) || 0), 0);
  const currentIdx = statusIndex(currentStatus);

  return (
    <div className="flex flex-col h-full">

      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            {ticket.customer_name || '—'}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            SC# {ticket.sc_number} · {ticket.received_at}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            {lang === 'fr' ? 'Retour' : 'Back'}
          </button>
          {canEdit && (
            <button
              onClick={saveNotes}
              disabled={saveNotesMutation.isLoading}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
            >
              <Save className="w-4 h-4" />
              {saved ? '✓ Sauvegardé' : (lang === 'fr' ? 'Sauvegarder' : 'Save')}
            </button>
          )}
        </div>
      </div>

      {/* Read-only banner */}
      {!canEdit && (
        <div className="mx-6 mt-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-sm">
          <Lock className="w-4 h-4 flex-shrink-0" />
          {lang === 'fr'
            ? 'Vous pouvez consulter cette occurrence, mais pas la modifier.'
            : 'You can view this occurrence, but cannot edit it.'}
        </div>
      )}

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden gap-6 p-6">

        {/* LEFT COLUMN */}
        <div className="flex flex-col gap-4 w-[460px] flex-shrink-0 overflow-y-auto pr-2">

          {/* Status card */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {lang === 'fr' ? 'Statut' : 'Status'}
              </span>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_BADGE[currentStatus]}`}>
                {STATUS_LABELS[currentStatus]?.[lang]}
              </span>
            </div>

            {/* Progress bar */}
            {currentStatus !== 'cancelled' && (
              <div className="flex gap-1 mb-5">
                {STATUS_FLOW.map((s, i) => (
                  <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${
                    i <= currentIdx ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-700'
                  }`} />
                ))}
              </div>
            )}

            {/* Workflow buttons */}
            {canEdit && !isTerminal && (
              <div className="flex flex-col gap-2">
                {next && (
                  <button
                    onClick={() => advanceMutation.mutate(next)}
                    disabled={advanceMutation.isLoading}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-medium text-sm text-white transition disabled:opacity-60 ${
                      next === 'completed' ? 'bg-green-600 hover:bg-green-700' :
                      next === 'quality_meeting' ? 'bg-purple-600 hover:bg-purple-700' :
                      'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    <ChevronRight className="w-4 h-4" />
                    {ADVANCE_BTN[currentStatus]?.[lang]}
                  </button>
                )}

                {prev && (
                  <button
                    onClick={() => revertMutation.mutate(prev)}
                    disabled={revertMutation.isLoading}
                    className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-medium text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-60"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    {lang === 'fr'
                      ? `← Retour à « ${STATUS_LABELS[prev]?.[lang]} »`
                      : `← Revert to "${STATUS_LABELS[prev]?.[lang]}"`}
                  </button>
                )}

                <button
                  onClick={() => {
                    if (window.confirm(
                      lang === 'fr' ? 'Annuler cette occurrence ?' : 'Cancel this occurrence?'
                    )) cancelMutation.mutate();
                  }}
                  disabled={cancelMutation.isLoading}
                  className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-medium text-sm border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition disabled:opacity-60"
                >
                  {lang === 'fr' ? "Annuler l'occurrence" : 'Cancel occurrence'}
                </button>
              </div>
            )}

            {isTerminal && (
              <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium ${
                currentStatus === 'completed'
                  ? 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300'
                  : 'bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300'
              }`}>
                <CheckCircle className="w-4 h-4" />
                {currentStatus === 'completed'
                  ? (lang === 'fr' ? 'Occurrence complétée' : 'Occurrence completed')
                  : (lang === 'fr' ? 'Occurrence annulée' : 'Occurrence cancelled')}
              </div>
            )}

            {canEdit && currentStatus === 'completed' && (
              <button
                onClick={() => revertMutation.mutate('quality_meeting')}
                disabled={revertMutation.isLoading}
                className="mt-2 w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-medium text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
              >
                <ChevronLeft className="w-4 h-4" />
                {lang === 'fr' ? 'Retour à Quality Meeting' : 'Revert to Quality Meeting'}
              </button>
            )}
          </div>

          {/* Informations card */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {lang === 'fr' ? 'Informations' : 'Information'}
              </h3>
              {canEdit && !editingHeader && (
                <button
                  onClick={startEditHeader}
                  className="text-xs flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <Edit2 className="w-3 h-3" />
                  {lang === 'fr' ? 'Modifier' : 'Edit'}
                </button>
              )}
            </div>

            {editingHeader && headerDraft ? (
              <div className="space-y-3">
                <FieldEdit label={lang === 'fr' ? 'Vendu à' : 'Sold to'} value={headerDraft.customer_name} onChange={v => setHeaderDraft(d => ({ ...d, customer_name: v }))} />
                <FieldEdit label={lang === 'fr' ? 'Destination' : 'Ship to'} value={headerDraft.ship_to} onChange={v => setHeaderDraft(d => ({ ...d, ship_to: v }))} />
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{lang === 'fr' ? 'Marque' : 'Brand'}</label>
                  <select value={headerDraft.brand} onChange={e => setHeaderDraft(d => ({ ...d, brand: e.target.value }))}
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                    {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <FieldEdit label="REF SO" value={headerDraft.ref_so} onChange={v => setHeaderDraft(d => ({ ...d, ref_so: v }))} />
                <FieldEdit label="SC#" value={headerDraft.sc_number} onChange={v => setHeaderDraft(d => ({ ...d, sc_number: v }))} />
                <FieldEdit label={lang === 'fr' ? 'Date de réception' : 'Received date'} value={headerDraft.received_at} onChange={v => setHeaderDraft(d => ({ ...d, received_at: v }))} type="date" />
                <div className="flex gap-2 pt-1">
                  <button onClick={() => saveHeaderMutation.mutate(headerDraft)} disabled={saveHeaderMutation.isLoading}
                    className="flex-1 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition">
                    {saveHeaderMutation.isLoading ? '...' : (lang === 'fr' ? 'Sauvegarder' : 'Save')}
                  </button>
                  <button onClick={() => setEditingHeader(false)}
                    className="flex-1 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                    {lang === 'fr' ? 'Annuler' : 'Cancel'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <InfoRow label={lang === 'fr' ? 'Destination' : 'Ship to'} value={ticket.ship_to} />
                <InfoRow label={lang === 'fr' ? 'Vendu à' : 'Sold to'} value={ticket.customer_name} />
                <InfoRow label={lang === 'fr' ? 'Marque' : 'Brand'} value={ticket.brand} />
                <InfoRow label="REF SO" value={ticket.ref_so} />
                <InfoRow label="SC#" value={ticket.sc_number} />
                <InfoRow label={lang === 'fr' ? 'Date de réception' : 'Received date'} value={ticket.received_at} />
              </div>
            )}
          </div>

          {/* SD Notes */}
          {['service_desk', 'quality_meeting', 'completed'].includes(currentStatus) && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                📋 {lang === 'fr' ? 'Notes Service Desk' : 'Service Desk Notes'}
              </h3>
              <textarea
                value={sdNotes}
                onChange={e => setSdNotes(e.target.value)}
                disabled={!canEdit}
                placeholder={lang === 'fr' ? 'Observations, détails supplémentaires...' : 'Observations, additional details...'}
                rows={4}
                className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white p-3 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </div>
          )}

          {/* Résolution */}
          {['quality_meeting', 'completed'].includes(currentStatus) && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                🔧 {lang === 'fr' ? 'Résolution' : 'Resolution'}
              </h3>
              <NotesField label={lang === 'fr' ? 'CAUSE RACINE' : 'ROOT CAUSE'} value={causeRacine} onChange={setCauseRacine} disabled={!canEdit} placeholder={lang === 'fr' ? 'Décrire la cause racine...' : 'Describe the root cause...'} />
              <NotesField label={lang === 'fr' ? 'ACTION CORRECTIVE' : 'CORRECTIVE ACTION'} value={actionCorrective} onChange={setActionCorrective} disabled={!canEdit} placeholder={lang === 'fr' ? "Décrire l'action corrective..." : 'Describe the corrective action...'} />
              <NotesField label={lang === 'fr' ? 'RÉSOLUTION' : 'RESOLUTION'} value={resolution} onChange={setResolution} disabled={!canEdit} placeholder={lang === 'fr' ? 'Résumé de la résolution...' : 'Resolution summary...'} />
            </div>
          )}
        </div>

        {/* RIGHT COLUMN */}
        <div className="flex-1 overflow-y-auto space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              🔲 {lang === 'fr' ? `Lignes (${lines.length})` : `Lines (${lines.length})`}
            </h2>
            <div className="flex items-center gap-4">
              {lines.length > 0 && (
                <div className="text-sm text-gray-500 dark:text-gray-400 flex gap-4">
                  <span>{lang === 'fr' ? 'Coût est.' : 'Est. cost'}: <strong className="text-gray-900 dark:text-white">${totalApprox.toFixed(2)}</strong></span>
                  {totalFinal > 0 && <span>{lang === 'fr' ? 'Coût final' : 'Final cost'}: <strong className="text-gray-900 dark:text-white">${totalFinal.toFixed(2)}</strong></span>}
                </div>
              )}
              {canEdit && (
                <button onClick={() => setAddingLine(true)} className="flex items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
                  <Plus className="w-4 h-4" />
                  {lang === 'fr' ? 'Ajouter une ligne' : 'Add a line'}
                </button>
              )}
            </div>
          </div>

          {lines.map((line, idx) => (
            <LineCard key={line.id} line={line} index={idx} ticketId={id} canEdit={canEdit} lang={lang} onUpdated={() => qc.invalidateQueries(['ticket', id])} />
          ))}

          {lines.length === 0 && (
            <div className="rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 p-12 text-center text-gray-400">
              {lang === 'fr' ? 'Aucune ligne pour cette occurrence.' : 'No lines for this occurrence.'}
            </div>
          )}

          {addingLine && canEdit && (
            <NewLineForm ticketId={id} lang={lang} onSaved={() => { setAddingLine(false); qc.invalidateQueries(['ticket', id]); }} onCancel={() => setAddingLine(false)} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between text-sm py-1 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-gray-900 dark:text-white font-medium">{value || '—'}</span>
    </div>
  );
}

function FieldEdit({ label, value, onChange, type = 'text' }) {
  return (
    <div>
      <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  );
}

function NotesField({ label, value, onChange, disabled, placeholder }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{label}</p>
      <textarea value={value} onChange={e => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} rows={3}
        className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white p-3 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed" />
    </div>
  );
}

function LineCard({ line, index, canEdit, lang, ticketId, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setDraft({ ...line });
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    const { error } = await supabase.from('occurrence_lines').update({
      quality_issue: draft.quality_issue,
      categories: draft.categories,
      department: draft.department,
      line_item: draft.line_item,
      foliot_id: draft.foliot_id,
      plant: draft.plant,
      affected_qty: parseInt(draft.affected_qty) || null,
      cost_approx: parseFloat(draft.cost_approx) || null,
      cost_final: parseFloat(draft.cost_final) || null,
    }).eq('id', line.id);
    setSaving(false);
    if (!error) { setEditing(false); onUpdated(); }
  }

  async function deleteLine() {
    if (!window.confirm(lang === 'fr' ? 'Supprimer cette ligne ?' : 'Delete this line?')) return;
    await supabase.from('occurrence_lines').delete().eq('id', line.id);
    onUpdated();
  }

  const photos = line.ticket_photos || [];

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900 dark:text-white">Ligne {index + 1}</span>
          {line.categories?.[0] && <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 text-xs">{line.categories[0]}</span>}
          {line.department && <span className="text-xs text-gray-500 dark:text-gray-400">{line.department}</span>}
        </div>
        {canEdit && !editing && (
          <div className="flex gap-2">
            <button onClick={startEdit} className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"><Edit2 className="w-3 h-3" />{lang === 'fr' ? 'Modifier' : 'Edit'}</button>
            <button onClick={deleteLine} className="text-xs text-red-500 hover:underline">✕</button>
          </div>
        )}
      </div>

      {editing && draft ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FieldEdit label={lang === 'fr' ? 'Problème qualité' : 'Quality issue'} value={draft.quality_issue || ''} onChange={v => setDraft(d => ({ ...d, quality_issue: v }))} />
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Catégorie</label>
              <select value={draft.categories?.[0] || ''} onChange={e => setDraft(d => ({ ...d, categories: [e.target.value] }))}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                <option value="">—</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Département</label>
              <select value={draft.department || ''} onChange={e => setDraft(d => ({ ...d, department: e.target.value }))}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                <option value="">—</option>
                {DEPARTMENTS.map(dep => <option key={dep} value={dep}>{dep}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Usine</label>
              <select value={draft.plant || ''} onChange={e => setDraft(d => ({ ...d, plant: e.target.value }))}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                <option value="">—</option>
                {PLANTS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <FieldEdit label="Line item" value={draft.line_item || ''} onChange={v => setDraft(d => ({ ...d, line_item: v }))} />
            <FieldEdit label="Foliot ID" value={draft.foliot_id || ''} onChange={v => setDraft(d => ({ ...d, foliot_id: v }))} />
            <FieldEdit label={lang === 'fr' ? 'Qté affectée' : 'Affected qty'} value={draft.affected_qty || ''} onChange={v => setDraft(d => ({ ...d, affected_qty: v }))} type="number" />
            <FieldEdit label={lang === 'fr' ? 'Coût estimé ($)' : 'Est. cost ($)'} value={draft.cost_approx || ''} onChange={v => setDraft(d => ({ ...d, cost_approx: v }))} type="number" />
            <FieldEdit label={lang === 'fr' ? 'Coût final ($)' : 'Final cost ($)'} value={draft.cost_final || ''} onChange={v => setDraft(d => ({ ...d, cost_final: v }))} type="number" />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={save} disabled={saving} className="flex-1 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition disabled:opacity-60">
              {saving ? '...' : (lang === 'fr' ? 'Sauvegarder' : 'Save')}
            </button>
            <button onClick={() => setEditing(false)} className="flex-1 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition">
              {lang === 'fr' ? 'Annuler' : 'Cancel'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-gray-900 dark:text-white font-medium">{line.quality_issue || '—'}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <InfoRow label="Line item" value={line.line_item} />
            <InfoRow label="Foliot ID" value={line.foliot_id} />
            <InfoRow label={lang === 'fr' ? 'Usine' : 'Plant'} value={line.plant} />
            <InfoRow label={lang === 'fr' ? 'Qté affectée' : 'Affected qty'} value={line.affected_qty} />
            <InfoRow label={lang === 'fr' ? 'Coût estimé' : 'Est. cost'} value={line.cost_approx ? `$${parseFloat(line.cost_approx).toFixed(2)}` : null} />
            {line.cost_final && <InfoRow label={lang === 'fr' ? 'Coût final' : 'Final cost'} value={`$${parseFloat(line.cost_final).toFixed(2)}`} />}
          </div>
          {photos.length > 0 && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {photos.map(p => (
                <img key={p.id} src={p.url} alt="" className="w-16 h-16 rounded-lg object-cover border border-gray-200 dark:border-gray-700 cursor-pointer hover:opacity-80 transition" onClick={() => window.open(p.url, '_blank')} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewLineForm({ ticketId, lang, onSaved, onCancel }) {
  const [form, setForm] = useState({ quality_issue: '', categories: [], department: '', line_item: '', foliot_id: '', plant: '', affected_qty: '', cost_approx: '' });
  const [saving, setSaving] = useState(false);

  function update(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    setSaving(true);
    const { error } = await supabase.from('occurrence_lines').insert({
      occurrence_id: ticketId,
      ...form,
      affected_qty: parseInt(form.affected_qty) || null,
      cost_approx: parseFloat(form.cost_approx) || null,
    });
    setSaving(false);
    if (!error) onSaved();
  }

  return (
    <div className="rounded-xl border-2 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-5 space-y-4">
      <h4 className="font-semibold text-sm text-blue-700 dark:text-blue-300">{lang === 'fr' ? 'Nouvelle ligne' : 'New line'}</h4>
      <div className="grid grid-cols-2 gap-3">
        <FieldEdit label={lang === 'fr' ? 'Problème qualité' : 'Quality issue'} value={form.quality_issue} onChange={v => update('quality_issue', v)} />
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Catégorie</label>
          <select value={form.categories?.[0] || ''} onChange={e => update('categories', [e.target.value])}
            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
            <option value="">—</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Département</label>
          <select value={form.department} onChange={e => update('department', e.target.value)}
            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
            <option value="">—</option>
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Usine</label>
          <select value={form.plant} onChange={e => update('plant', e.target.value)}
            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
            <option value="">—</option>
            {PLANTS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <FieldEdit label="Line item" value={form.line_item} onChange={v => update('line_item', v)} />
        <FieldEdit label="Foliot ID" value={form.foliot_id} onChange={v => update('foliot_id', v)} />
        <FieldEdit label={lang === 'fr' ? 'Qté affectée' : 'Affected qty'} value={form.affected_qty} onChange={v => update('affected_qty', v)} type="number" />
        <FieldEdit label={lang === 'fr' ? 'Coût estimé ($)' : 'Est. cost ($)'} value={form.cost_approx} onChange={v => update('cost_approx', v)} type="number" />
      </div>
      <div className="flex gap-2">
        <button onClick={save} disabled={saving || !form.quality_issue} className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition disabled:opacity-60">
          {saving ? '...' : (lang === 'fr' ? 'Ajouter' : 'Add')}
        </button>
        <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition">
          {lang === 'fr' ? 'Annuler' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
