import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ticketApi } from '../../services/api'
import { StatusBadge, BrandTag, PageHeader, Spinner } from '../../components/ui'
import toast from 'react-hot-toast'

export default function TicketDetail() {
  const { id } = useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => ticketApi.get(id).then(r => r.data)
  })

  const updateMutation = useMutation({
    mutationFn: (data) => ticketApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['ticket', id])
      toast.success('Ticket mis à jour')
    }
  })

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div>
  if (!ticket) return null

  return (
    <>
      <PageHeader
        title={ticket.quality_issue}
        subtitle={`${ticket.id} · SC# ${ticket.sc_number || '—'}`}
        actions={
          <button className="btn-ghost" onClick={() => navigate(-1)}>
            ← Retour
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 max-w-4xl">
          <div className="card p-4 space-y-3">
            <div className="text-sm font-semibold mb-3">Détails du ticket</div>
            {[
              ['Ship To', ticket.ship_to],
              ['Sold To', ticket.sold_to],
              ['Brand', ticket.brand],
              ['Department', ticket.department],
              ['Status', <StatusBadge status={ticket.status} />],
              ['Category', ticket.categories || '—'],
              ['REF SO', ticket.ref_so || '—'],
              ['SC#', ticket.sc_number || '—'],
              ['Material #', ticket.material_number || '—'],
              ['Affected qty', `${ticket.affected_qty || 0} / ${ticket.total_qty || 0}`],
              ['Cost approx.', ticket.cost_approx ? `$${ticket.cost_approx.toLocaleString()}` : '—'],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between border-b border-gray-50 pb-2">
                <span className="text-xs text-gray-400">{label}</span>
                <span className="text-sm">{value}</span>
              </div>
            ))}
          </div>
          <div className="card p-4">
            <div className="text-sm font-semibold mb-3">Résolution</div>
            <div className="space-y-3">
              <div>
                <label className="label">Root Cause</label>
                <textarea className="input" rows={3} defaultValue={ticket.root_cause || ''} />
              </div>
              <div>
                <label className="label">Corrective Action</label>
                <textarea className="input" rows={3} defaultValue={ticket.corrective_action || ''} />
              </div>
              <div className="flex gap-3 mt-4">
                {['not_started','wip','completed'].map(s => (
                  <button
                    key={s}
                    onClick={() => updateMutation.mutate({ status: s })}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${
                      ticket.status === s
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {t(`status.${s}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
