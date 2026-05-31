import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../../services/api'
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

  const { data: plants, isLoading } = useQuery({
    queryKey: ['plants-admin'],
    queryFn: async () => {
      const { data, error } = await import('../../services/supabase').then(m =>
        m.supabase.from('plants').select('*').order('name')
      )
      if (error) throw error
      return data
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }) => {
      const { supabase } = await import('../../services/supabase')
      const { error } = await supabase.from('plants').update({ active }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['plants-admin'])
      queryClient.invalidateQueries(['plants'])
      toast.success('Statut mis a jour')
    },
    onError: () => toast.error('Erreur'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { supabase } = await import('../../services/supabase')
      const { error } = await supabase.from('plants').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['plants-admin'])
      queryClient.invalidateQueries(['plants'])
      toast.success('Usine supprimee')
    },
    onError: () => toast.error('Erreur'),
  })

  const handleEdit = (plant) => {
    setEditPlant(plant)
    setShowModal(true)
  }

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

      <div className="flex-1 overflow-y-auto p-5">
        <div className="card overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center p-8"><Spinner /></div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {['Usine','Pays','Ville','Contact','Statut','Actions'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(plants || []).map(plant => (
                  <tr key={plant.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <div style={{ width:32, height:32, borderRadius:8, background:'#eff6ff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>
                          🏭
                        </div>
                        <div style={{ fontSize:13, fontWeight:500, color:'#111827' }}>{plant.name}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {COUNTRY_FLAG[plant.country] || '🌍'} {plant.country || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{plant.city || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{plant.contact_email || '—'}</td>
                    <td className="px-4 py-3">
                      <span style={{
                        fontSize:11, padding:'2px 8px', borderRadius:10, fontWeight:500,
                        background: plant.active ? '#f0fdf4' : '#f3f4f6',
                        color: plant.active ? '#166634' : '#6b7280',
                      }}>
                        {plant.active ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div style={{ display:'flex', gap:6 }}>
                        <button
                          onClick={() => handleEdit(plant)}
                          style={{ padding:'5px 10px', borderRadius:6, fontSize:12, cursor:'pointer', border:'1px solid #e5e7eb', background:'#fff', color:'#6b7280', display:'inline-flex', alignItems:'center', gap:4 }}
                        >
                          ✏ Modifier
                        </button>
                        <button
                          onClick={() => toggleMutation.mutate({ id: plant.id, active: !plant.active })}
                          style={{
                            padding:'5px 10px', borderRadius:6, fontSize:12, cursor:'pointer',
                            border: plant.active ? '1px solid #fef3c7' : '1px solid #bbf7d0',
                            background: plant.active ? '#fffbeb' : '#f0fdf4',
                            color: plant.active ? '#92400e' : '#166634',
                            display:'inline-flex', alignItems:'center', gap:4,
                          }}
                        >
                          {plant.active ? 'Desactiver' : 'Activer'}
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm('Supprimer ' + plant.name + ' ?'))
                              deleteMutation.mutate(plant.id)
                          }}
                          style={{ padding:'5px 10px', borderRadius:6, fontSize:12, cursor:'pointer', border:'1px solid #fecaca', background:'#fff5f5', color:'#ef4444' }}
                        >
                          🗑
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

      {showModal && (
        <PlantModal plant={editPlant} onClose={handleClose} />
      )}
    </>
  )
}
