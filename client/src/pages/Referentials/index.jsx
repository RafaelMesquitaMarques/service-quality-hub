import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../services/supabase'
import { revenueApi, FISCAL_MONTH_ORDER, CURRENT_FISCAL_YEAR } from '../../services/api'
import { useThemeStore } from '../../store/themeStore'
import { PageHeader, Spinner } from '../../components/ui'
import toast from 'react-hot-toast'

// ── Add / edit modal (générique, piloté par config.fields) ─────────────────
function EntityModal({ config, entity, onClose }) {
  const { t } = useTranslation()
  const isEdit = !!entity
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(() => {
    const init = { active: entity?.active ?? true }
    config.fields.forEach(f => { init[f.key] = entity?.[f.key] ?? '' })
    return init
  })
  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    const missing = config.fields.find(f => f.required && !String(form[f.key] || '').trim())
    if (missing) { toast.error(t('referentials.required', { field: missing.label })); return }
    setSaving(true)
    try {
      const payload = { active: form.active }
      config.fields.forEach(f => { payload[f.key] = form[f.key] === '' ? null : form[f.key] })
      if (isEdit) {
        const { error } = await supabase.from(config.table)
          .update({ ...payload, updated_at: new Date().toISOString() }).eq('id', entity.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from(config.table).insert(payload)
        if (error) throw error
      }
      toast.success(t('common.save'))
      onClose(true)
    } catch (e) {
      console.error('Referential save error:', e)
      toast.error(e?.message || t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-black/45 p-8">
      <div className="w-full max-w-md rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#161B22] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-gray-700">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{isEdit ? config.editTitle : config.newLabel}</span>
          <button onClick={() => onClose(false)} className="text-gray-400 hover:text-gray-600 bg-transparent border-0 cursor-pointer text-lg leading-none">✕</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {config.fields.map(f => (
            <div key={f.key}>
              <label className="label">{f.label}{f.required ? ' *' : ''}</label>
              {f.type === 'textarea' ? (
                <textarea className="input text-sm resize-y" rows={2} value={form[f.key] || ''} onChange={e => sf(f.key, e.target.value)} />
              ) : (
                <input className="input text-sm" type={f.type || 'text'} value={form[f.key] || ''} onChange={e => sf(f.key, e.target.value)} />
              )}
            </div>
          ))}
          <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#0D1117] border border-gray-200 dark:border-gray-700 cursor-pointer">
            <input type="checkbox" checked={form.active} onChange={e => sf('active', e.target.checked)} className="w-3.5 h-3.5 cursor-pointer" />
            <span className="text-sm text-gray-700 dark:text-gray-300">{t('referentials.active_label')}</span>
          </label>
        </div>
        <div className="flex justify-between items-center px-5 py-3 border-t border-gray-200 dark:border-gray-700">
          <button onClick={() => onClose(false)} className="btn-ghost text-sm">{t('common.cancel')}</button>
          <button onClick={submit} disabled={saving} className="btn-primary text-sm">{saving ? t('common.loading') : t('common.save')}</button>
        </div>
      </div>
    </div>
  )
}

// ── CRUD table pour une entité (clients ou brands) ─────────────────────────
function EntityManager({ config }) {
  const { t } = useTranslation()
  const { dark: isDark } = useThemeStore()
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)

  const { data: rows, isLoading } = useQuery({
    queryKey: [config.queryKey],
    queryFn: async () => {
      const { data, error } = await supabase.from(config.table).select('*').order('name')
      if (error) throw error
      return data
    },
  })

  const invalidate = () => {
    qc.invalidateQueries([config.queryKey])
    if (config.formKey) qc.invalidateQueries([config.formKey]) // rafraîchit les dropdowns des formulaires
  }

  const toggleMut = useMutation({
    mutationFn: async ({ id, active }) => {
      const { error } = await supabase.from(config.table).update({ active }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { invalidate(); toast.success(t('common.save')) },
    onError: () => toast.error(t('common.error')),
  })

  const deleteMut = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from(config.table).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { invalidate(); toast.success(t('common.save')) },
    onError: () => toast.error(t('common.error')),
  })

  const close = (changed) => { setShowModal(false); setEditing(null); if (changed) invalidate() }
  const totalCols = config.columns.length + 2 // + status + actions

  return (
    <>
      <div className="flex justify-end mb-3">
        <button className="btn-primary" onClick={() => { setEditing(null); setShowModal(true) }}>
          <i className="ti ti-plus" aria-hidden="true" /> {config.newLabel}
        </button>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center p-8"><Spinner /></div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 dark:bg-[#161B22] border-b border-gray-200 dark:border-gray-700">
                {config.columns.map(c => (
                  <th key={c.header} className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{c.header}</th>
                ))}
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{t('referentials.status')}</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{t('referentials.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {(rows || []).map(row => (
                <tr key={row.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                  {config.columns.map((c, ci) => (
                    <td key={c.header} className="px-4 py-3">
                      {ci === 0 ? (
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0 bg-blue-50 dark:bg-blue-900/30">{config.icon}</div>
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{c.cell(row)}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-500 dark:text-gray-400">{c.cell(row) || '—'}</span>
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                      background: row.active ? (isDark ? '#14532d' : '#f0fdf4') : (isDark ? '#1f2937' : '#f3f4f6'),
                      color:      row.active ? (isDark ? '#86efac' : '#166634') : (isDark ? '#9ca3af' : '#6b7280'),
                    }}>
                      {row.active ? t('referentials.active') : t('referentials.inactive')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => { setEditing(row); setShowModal(true) }} className="btn-ghost text-xs py-1 px-2.5">
                        <i className="ti ti-edit text-sm" aria-hidden="true" /> {t('common.edit')}
                      </button>
                      <button onClick={() => toggleMut.mutate({ id: row.id, active: !row.active })}
                        className="text-xs py-1 px-2.5 rounded-lg border cursor-pointer inline-flex items-center gap-1"
                        style={{
                          border:     row.active ? '1px solid ' + (isDark ? '#854d0e' : '#fde68a') : '1px solid ' + (isDark ? '#166534' : '#bbf7d0'),
                          background: row.active ? (isDark ? '#3b2a00' : '#fffbeb') : (isDark ? '#14532d' : '#f0fdf4'),
                          color:      row.active ? (isDark ? '#fcd34d' : '#92400e') : (isDark ? '#86efac' : '#166634'),
                        }}>
                        {row.active ? t('referentials.deactivate') : t('referentials.activate')}
                      </button>
                      <button onClick={() => { if (window.confirm(`${t('referentials.delete_confirm')} ${row.name} ?`)) deleteMut.mutate(row.id) }}
                        className="text-xs py-1 px-2.5 rounded-lg border cursor-pointer inline-flex items-center"
                        style={{ border: '1px solid ' + (isDark ? '#7f1d1d' : '#fecaca'), background: isDark ? '#1f0a0a' : '#fff5f5', color: '#ef4444' }}>
                        <i className="ti ti-trash text-sm" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {(rows || []).length === 0 && (
                <tr><td colSpan={totalCols} className="px-4 py-8 text-center text-sm text-gray-400">{config.emptyLabel}</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showModal && <EntityModal config={config} entity={editing} onClose={close} />}
    </>
  )
}

// ── Revenus mensuels par année fiscale ─────────────────────────────────────
const REVENUE_YEARS = [CURRENT_FISCAL_YEAR + 1, CURRENT_FISCAL_YEAR, CURRENT_FISCAL_YEAR - 1, CURRENT_FISCAL_YEAR - 2]

function RevenueManager() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [fy, setFy]       = useState(CURRENT_FISCAL_YEAR)
  const [draft, setDraft] = useState({})

  const { data: allRev, isLoading } = useQuery({ queryKey: ['monthly-revenue'], queryFn: revenueApi.all })

  // (Ré)initialise les champs quand l'année ou les données changent.
  useEffect(() => {
    const m = {}
    ;(allRev || []).filter(r => r.fiscal_year === fy).forEach(r => { m[r.fiscal_month] = String(Number(r.revenue)) })
    setDraft(m)
  }, [allRev, fy])

  const saveMut = useMutation({
    mutationFn: () => revenueApi.upsertYear(fy, FISCAL_MONTH_ORDER.map(mo => ({
      fiscal_month: mo.fiscal,
      revenue: draft[mo.fiscal] === '' || draft[mo.fiscal] == null ? 0 : Number(draft[mo.fiscal]),
    }))),
    onSuccess: () => { qc.invalidateQueries(['monthly-revenue']); toast.success(t('common.save')) },
    onError:   () => toast.error(t('common.error')),
  })

  const total = FISCAL_MONTH_ORDER.reduce((s, mo) => s + (Number(draft[mo.fiscal]) || 0), 0)
  const money = v => '$' + Math.round(Number(v) || 0).toLocaleString()

  return (
    <div className="card p-5 max-w-xl">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 dark:text-gray-400">{t('referentials.fiscal_year')}</label>
          <select className="input text-sm" style={{ width: 'auto' }} value={fy} onChange={e => setFy(Number(e.target.value))}>
            {REVENUE_YEARS.map(y => <option key={y} value={y}>FY{y}</option>)}
          </select>
        </div>
        <button className="btn-primary text-sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          <i className="ti ti-device-floppy" aria-hidden="true" /> {saveMut.isPending ? t('common.loading') : t('common.save')}
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-3">{t('referentials.revenues_hint')}</p>
      {isLoading ? <div className="flex justify-center p-6"><Spinner /></div> : (
        <div className="space-y-2">
          {FISCAL_MONTH_ORDER.map(mo => (
            <div key={mo.fiscal} className="grid items-center gap-3" style={{ gridTemplateColumns: '96px 1fr' }}>
              <span className="text-sm text-gray-600 dark:text-gray-300">{mo.name}</span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">$</span>
                <input type="number" min="0" step="1000" placeholder="0" className="input text-sm pl-6"
                  value={draft[mo.fiscal] ?? ''}
                  onChange={e => setDraft(d => ({ ...d, [mo.fiscal]: e.target.value }))} />
              </div>
            </div>
          ))}
          <div className="flex justify-between pt-3 mt-1 border-t border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-900 dark:text-gray-100">
            <span>{t('dashboard.total')}</span><span className="font-mono">{money(total)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function ReferentialsPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState('clients')

  const configs = {
    clients: {
      table: 'clients', queryKey: 'clients-admin', icon: '🏢',
      newLabel: t('referentials.new_client'), editTitle: t('referentials.edit_client'),
      emptyLabel: t('referentials.no_clients'),
      fields: [
        { key: 'name',          label: t('referentials.name'), required: true },
        { key: 'contact_name',  label: t('referentials.contact') },
        { key: 'contact_email', label: t('referentials.email'), type: 'email' },
        { key: 'contact_phone', label: t('referentials.phone') },
        { key: 'city',          label: t('referentials.city') },
        { key: 'notes',         label: t('referentials.notes'), type: 'textarea' },
      ],
      columns: [
        { header: t('referentials.name'),    cell: r => r.name },
        { header: t('referentials.contact'), cell: r => r.contact_name || r.contact_email },
        { header: t('referentials.city'),    cell: r => r.city },
      ],
    },
    brands: {
      table: 'brands', queryKey: 'brands-admin', formKey: 'brands', icon: '🏷️',
      newLabel: t('referentials.new_brand'), editTitle: t('referentials.edit_brand'),
      emptyLabel: t('referentials.no_brands'),
      fields: [
        { key: 'name', label: t('referentials.name'), required: true },
      ],
      columns: [
        { header: t('referentials.name'), cell: r => r.name },
      ],
    },
    departments: {
      table: 'departments', queryKey: 'departments-admin', formKey: 'departments', icon: '🏬',
      newLabel: t('referentials.new_department'), editTitle: t('referentials.edit_department'),
      emptyLabel: t('referentials.no_departments'),
      fields: [
        { key: 'name', label: t('referentials.name'), required: true },
      ],
      columns: [
        { header: t('referentials.name'), cell: r => r.name },
      ],
    },
    categories: {
      table: 'categories', queryKey: 'categories-admin', formKey: 'categories', icon: '🗂️',
      newLabel: t('referentials.new_category'), editTitle: t('referentials.edit_category'),
      emptyLabel: t('referentials.no_categories'),
      fields: [
        { key: 'name', label: t('referentials.name'), required: true },
      ],
      columns: [
        { header: t('referentials.name'), cell: r => r.name },
      ],
    },
  }

  const tabs = [
    ['clients', t('referentials.clients')], ['brands', t('referentials.brands')],
    ['departments', t('referentials.departments')], ['categories', t('referentials.categories')],
    ['revenues', t('referentials.revenues')],
  ]

  return (
    <>
      <PageHeader title={t('referentials.title')} subtitle={t('referentials.subtitle')} />

      <div className="flex-1 overflow-y-auto p-5 bg-gray-50 dark:bg-[#0D1117]">
        <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
          {tabs.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer bg-transparent"
              style={{ borderColor: tab === key ? '#2563eb' : 'transparent', color: tab === key ? '#2563eb' : '#6b7280' }}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'revenues' ? <RevenueManager /> : <EntityManager key={tab} config={configs[tab]} />}
      </div>
    </>
  )
}
