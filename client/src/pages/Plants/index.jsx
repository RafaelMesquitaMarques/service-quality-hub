import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../services/supabase'
import { PageHeader, Spinner } from '../../components/ui'
import PlantModal from './PlantModal'
import toast from 'react-hot-toast'

const COUNTRY_FLAG = {
  Vietnam: '🇻🇳', China: '🇨🇳', Canada: '🇨🇦',
  USA: '🇺🇸', France: '🇫🇷', Other: '🌍',
}

export default function PlantsPage() {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editPlant, setEditPlant] = useState(null)

  const isDark = document.documentElement.classList.contains('dark')

  const { data: plants, isLoading } = useQuery({
    queryKey: ['plants-admin'],
    queryFn: async () => {
      const { data, error } = await supabase.from('plants').select('*').order('name')
      if (error) throw error
      return data
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }) => {
      const { error } = await supabase.from('plants').update({ active }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['plants-admin'])
      queryClient.invalidateQueries(['plants'])
      toast.success('Statut mis à jour')
    },
    onError: () => toast.error('Erreur'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('plants').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['plants-admin'])
      queryClient.invalidateQueries(['plants'])
      toast.success('Usine supprimée')
    },
    onError: () => toast.error('Erreur'),
  })

  const handleEdit  = (plant) => { setEditPlant(plant); setShowModal(true) }
  const handleClose = () => {
    setShowModal(false)
    setEditPlant(null)
    queryClient.invalidateQueries(['plants-admin'])
    queryClient.invalidateQueries(['plants'])
  }

  const active = (plants || []).filter(p => p.active).length

  return (
    <>
      <PageHeader
        title="Usines (Plants)"
        subtitle={`${(plants || []).length} usines · ${active} actives`}
        actions={
          <button className="btn-primary" onClick={() => { setEditPlant(null); setShowModal(true) }}>
            <i className="ti ti-plus" aria-hidden="true" /> Nouvelle usine
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-5 bg-gray-50 dark:bg-[#0D1117]">
        <div className="card overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center p-8"><Spinner /></div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-[#161B22] border-b border-gray-200 dark:border-gray-700">
                  {['Usine','Pays','Ville','Contact','Statut','Actions'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(plants || []).map(plant => (
                  <tr key={plant.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0 bg-blue-50 dark:bg-blue-900/30">
                          🏭
                        </div>
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{plant.name}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                      {COUNTRY_FLAG[plant.country] || '🌍'} {plant.country || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{plant.city || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{plant.contact_email || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          background: plant.active ? (isDark ? '#14532d' : '#f0fdf4') : (isDark ? '#1f2937' : '#f3f4f6'),
                          color:      plant.active ? (isDark ? '#86efac' : '#166634') : (isDark ? '#9ca3af' : '#6b7280'),
                        }}>
                        {plant.active ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => handleEdit(plant)} className="btn-ghost text-xs py-1 px-2.5">
                          <i className="ti ti-edit text-sm" aria-hidden="true" /> Modifier
                        </button>
                        <button
                          onClick={() => toggleMutation.mutate({ id: plant.id, active: !plant.active })}
                          className="text-xs py-1 px-2.5 rounded-lg border cursor-pointer inline-flex items-center gap-1"
                          style={{
                            border:     plant.active ? '1px solid ' + (isDark ? '#854d0e' : '#fde68a') : '1px solid ' + (isDark ? '#166534' : '#bbf7d0'),
                            background: plant.active ? (isDark ? '#3b2a00' : '#fffbeb') : (isDark ? '#14532d' : '#f0fdf4'),
                            color:      plant.active ? (isDark ? '#fcd34d' : '#92400e') : (isDark ? '#86efac' : '#166634'),
                          }}>
                          {plant.active ? 'Désactiver' : 'Activer'}
                        </button>
                        <button
                          onClick={() => { if (window.confirm('Supprimer ' + plant.name + ' ?')) deleteMutation.mutate(plant.id) }}
                          className="text-xs py-1 px-2.5 rounded-lg border cursor-pointer inline-flex items-center"
                          style={{ border: '1px solid ' + (isDark ? '#7f1d1d' : '#fecaca'), background: isDark ? '#1f0a0a' : '#fff5f5', color: '#ef4444' }}>
                          <i className="ti ti-trash text-sm" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {(plants || []).length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">Aucune usine</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && <PlantModal plant={editPlant} onClose={handleClose} />}
    </>
  )
}
