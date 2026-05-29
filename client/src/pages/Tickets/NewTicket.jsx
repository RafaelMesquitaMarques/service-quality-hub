import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ticketApi } from '../../services/api'
import { PageHeader } from '../../components/ui'
import toast from 'react-hot-toast'

export default function NewTicket() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    quality_issue: '', ship_to: '', sold_to: '', department: '',
    brand: '', plant: '', categories: '', status: 'not_started',
    issue_reception_date: new Date().toISOString().split('T')[0],
    ref_so: '', sc_number: '', item: '', material_number: '',
    affected_qty: '', total_qty: '', cost_approx: '', root_cause: '',
  })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.quality_issue || !form.issue_reception_date) {
      toast.error('Problème qualité et date sont requis')
      return
    }
    setSaving(true)
    try {
      await ticketApi.create(form)
      toast.success('Ticket créé!')
      navigate('/tickets')
    } catch (e) {
      toast.error('Erreur lors de la création')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title={t('ticket.new')}
        actions={
          <>
            <button className="btn-ghost" onClick={() => navigate('/tickets')}>Annuler</button>
            <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
              {saving ? 'Saving...' : t('common.save')}
            </button>
          </>
        }
      />
      <div className="flex-1 overflow-y-auto p-5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 max-w-4xl">
          <div className="card p-4 space-y-3">
            <div className="text-sm font-semibold mb-2">Informations principales</div>
            <div><label className="label">Problème qualité *</label>
              <textarea className="input" rows={3} value={form.quality_issue} onChange={e => set('quality_issue', e.target.value)} /></div>
            <div><label className="label">Date réception *</label>
              <input type="date" className="input" value={form.issue_reception_date} onChange={e => set('issue_reception_date', e.target.value)} /></div>
            <div><label className="label">Ship To</label>
              <input className="input" value={form.ship_to} onChange={e => set('ship_to', e.target.value)} /></div>
            <div><label className="label">Sold To</label>
              <input className="input" value={form.sold_to} onChange={e => set('sold_to', e.target.value)} /></div>
            <div><label className="label">Département</label>
              <input className="input" value={form.department} onChange={e => set('department', e.target.value)} /></div>
            <div><label className="label">Marque</label>
              <input className="input" value={form.brand} onChange={e => set('brand', e.target.value)} /></div>
          </div>
          <div className="card p-4 space-y-3">
            <div className="text-sm font-semibold mb-2">Commande & Coûts</div>
            <div><label className="label">REF SO</label>
              <input className="input" value={form.ref_so} onChange={e => set('ref_so', e.target.value)} /></div>
            <div><label className="label">SC#</label>
              <input className="input" value={form.sc_number} onChange={e => set('sc_number', e.target.value)} /></div>
            <div><label className="label">Material #</label>
              <input className="input" value={form.material_number} onChange={e => set('material_number', e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label">Qté affectée</label>
                <input type="number" className="input" value={form.affected_qty} onChange={e => set('affected_qty', e.target.value)} /></div>
              <div><label className="label">Qté totale</label>
                <input type="number" className="input" value={form.total_qty} onChange={e => set('total_qty', e.target.value)} /></div>
            </div>
            <div><label className="label">Coût approx. ($)</label>
              <input type="number" className="input" value={form.cost_approx} onChange={e => set('cost_approx', e.target.value)} /></div>
            <div><label className="label">Cause racine</label>
              <textarea className="input" rows={3} value={form.root_cause} onChange={e => set('root_cause', e.target.value)} /></div>
          </div>
        </div>
      </div>
    </>
  )
}
