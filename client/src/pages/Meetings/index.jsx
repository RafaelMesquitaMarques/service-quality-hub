import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { meetingApi } from '../../services/api'
import { StatusBadge, BrandTag, PageHeader, Spinner } from '../../components/ui'

export default function MeetingsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [selectedDate, setSelectedDate] = useState(null)

  const { data: meetings, isLoading } = useQuery({
    queryKey: ['meetings'],
    queryFn: () => meetingApi.list().then(r => r.data)
  })

  const { data: meetingData } = useQuery({
    queryKey: ['meeting', selectedDate],
    queryFn: () => meetingApi.getByDate(selectedDate).then(r => r.data),
    enabled: !!selectedDate
  })

  const tickets = meetingData?.tickets || []

  return (
    <>
      <PageHeader title={t('nav.weekly_review')} subtitle="Revue hebdomadaire qualité" />
      <div className="flex-1 overflow-hidden flex">
        {/* Meeting list */}
        <div className="w-52 flex-shrink-0 border-r border-gray-200 overflow-y-auto bg-white">
          {isLoading ? (
            <div className="flex justify-center p-4"><Spinner /></div>
          ) : (meetings || []).map(m => (
            <div
              key={m.id}
              onClick={() => setSelectedDate(m.meeting_date)}
              className={`px-4 py-3 border-b border-gray-100 cursor-pointer transition-colors ${
                selectedDate === m.meeting_date
                  ? 'bg-blue-50 border-l-2 border-l-blue-600'
                  : 'hover:bg-gray-50'
              }`}
            >
              <div className="text-xs font-semibold text-gray-900">{m.meeting_date}</div>
              <div className="text-xs text-gray-400 mt-0.5">{m.type?.replace('_', ' ')}</div>
            </div>
          ))}
        </div>

        {/* Tickets for selected meeting */}
        <div className="flex-1 overflow-y-auto p-5">
          {!selectedDate ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              Sélectionnez une réunion
            </div>
          ) : (
            <>
              <div className="text-sm font-semibold mb-4">
                Tickets — semaine du {selectedDate}
                <span className="ml-2 text-gray-400 font-normal">({tickets.length} tickets)</span>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    {['SC#','Issue','Ship To','Brand','Dept.','Status','Cost'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tickets.map(ticket => (
                    <tr
                      key={ticket.id}
                      className="border-b border-gray-50 hover:bg-blue-50/30 cursor-pointer"
                      onClick={() => navigate(`/tickets/${ticket.id}`)}
                    >
                      <td className="px-3 py-2 font-mono text-xs text-gray-400">{ticket.sc_number || '—'}</td>
                      <td className="px-3 py-2 text-sm max-w-xs truncate">{ticket.quality_issue}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{ticket.ship_to}</td>
                      <td className="px-3 py-2"><BrandTag brand={ticket.brand} /></td>
                      <td className="px-3 py-2 text-xs text-blue-600">{ticket.department}</td>
                      <td className="px-3 py-2"><StatusBadge status={ticket.status} /></td>
                      <td className="px-3 py-2 font-mono text-xs">{ticket.cost_approx ? `$${ticket.cost_approx.toLocaleString()}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </>
  )
}
