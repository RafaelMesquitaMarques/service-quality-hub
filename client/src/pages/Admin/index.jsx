import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../../services/api'
import { PageHeader, Spinner } from '../../components/ui'
import UserModal from './UserModal'
import toast from 'react-hot-toast'

const ROLE_STYLE = {
  admin:        { bg:'#fef3c7', color:'#92400e', label:'Administrateur' },
  manager:      { bg:'#eff6ff', color:'#1e40af', label:'Manager' },
  cpm:          { bg:'#f0fdf4', color:'#166534', label:'CPM' },
  service_desk: { bg:'#fdf4ff', color:'#7e22ce', label:'Service Desk' },
  viewer:       { bg:'#f3f4f6', color:'#374151', label:'Utilisateur' },
}

const AVATAR_COLORS = [
  ['#eff6ff','#1d4ed8'],['#f0fdf4','#166534'],['#fdf4ff','#7e22ce'],
  ['#fff7ed','#9a3412'],['#ecfdf5','#065f46'],['#fef2f2','#991b1b'],
]

function getAvatarColors(name) {
  const idx = (name?.charCodeAt(0) || 0) % AVATAR_COLORS.length
  return AVATAR_COLORS[idx]
}

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(' ')
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
}

export default function AdminPage() {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editUser,  setEditUser]  = useState(null)

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => adminApi.users().then(r => r.data),
  })

  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => adminApi.stats().then(r => r.data),
  })

  const { data: plants } = useQuery({
    queryKey: ['plants'],
    queryFn: () => adminApi.plants().then(r => r.data),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }) => adminApi.updateUser(id, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries(['admin-users'])
      toast.success('Statut mis à jour')
    },
    onError: () => toast.error('Erreur lors de la mise à jour'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => adminApi.deactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['admin-users'])
      toast.success('Utilisateur désactivé')
    },
    onError: () => toast.error('Erreur'),
  })

  const handleEdit = (user) => {
    setEditUser(user)
    setShowModal(true)
  }


  const inp = {
    width:'100%', fontSize:13, padding:'7px 10px',
    border:'1px solid #d1d5db', borderRadius:7,
    background:'#fff', color:'#111827', outline:'none', boxSizing:'border-box',
  }

  return (
    <>
      <PageHeader
        title="Administration"
        subtitle={stats ? `${stats.totalUsers || 0} utilisateurs · ${stats.totalTickets || 0} tickets` : ''}
        actions={
          <button className="btn-primary" onClick={() => { setEditUser(null); setShowModal(true) }}>
            <i className="ti ti-user-plus" aria-hidden="true" /> Nouvel utilisateur
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
                  {['Utilisateur','Rôle','Département','Usine','Statut','Actions'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(users || []).map(user => {
                  const role   = ROLE_STYLE[user.role] || ROLE_STYLE.viewer
                  const [abg, acl] = getAvatarColors(user.full_name)
                  const initials = getInitials(user.full_name)
                  const isInvited = !user.active && user.invited_at

                  return (
                    <tr key={user.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          {user.avatar_url ? (
                            <img src={user.avatar_url} style={{ width:32, height:32, borderRadius:'50%', objectFit:'cover', border:'1px solid #e5e7eb' }} />
                          ) : (
                            <div style={{ width:32, height:32, borderRadius:'50%', background:abg, color:acl, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:500, flexShrink:0 }}>
                              {initials}
                            </div>
                          )}
                          <div>
                            <div style={{ fontSize:13, fontWeight:500, color:'#111827' }}>{user.full_name}</div>
                            <div style={{ fontSize:11, color:'#9ca3af' }}>{user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, fontWeight:500, background:role.bg, color:role.color }}>
                          {role.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{user.department || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{user.plant_name || user.plant || '—'}</td>
                      <td className="px-4 py-3">
                        {isInvited ? (
                          <span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, background:'#fff7ed', color:'#92400e', fontWeight:500 }}>
                            ⏳ Invité
                          </span>
                        ) : (
                          <span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, background: user.active ? '#f0fdf4' : '#f3f4f6', color: user.active ? '#166534' : '#6b7280', fontWeight:500 }}>
                            {user.active ? '● Actif' : '○ Inactif'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div style={{ display:'flex', gap:4 }}>
                          <button
                            onClick={() => handleEdit(user)}
                            style={{ padding:'4px 8px', borderRadius:5, fontSize:11, cursor:'pointer', border:'0.5px solid #e5e7eb', background:'none', color:'#6b7280' }}
                          >
                            <i className="ti ti-edit" aria-hidden="true" />
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm(`Désactiver ${user.full_name} ?`))
                                deleteMutation.mutate(user.id)
                            }}
                            style={{ padding:'4px 8px', borderRadius:5, fontSize:11, cursor:'pointer', border:'0.5px solid #fecaca', background:'none', color:'#ef4444' }}
                          >
                            <i className="ti ti-trash" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {(users || []).length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">Aucun utilisateur</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <UserModal
          user={editUser}
          plants={plants || []}
          onClose={handleClose}
        />
      )}
    </>
  )
}
