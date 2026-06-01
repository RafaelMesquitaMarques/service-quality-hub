import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../../services/api'
import { PageHeader, Spinner } from '../../components/ui'
import UserModal from './UserModal'
import toast from 'react-hot-toast'

const ROLE_STYLE = {
  admin:        { bg:'#fef3c7', color:'#92400e', dbg:'#3b2a00', dcl:'#fcd34d', label:'Administrateur' },
  manager:      { bg:'#eff6ff', color:'#1e40af', dbg:'#1e3a5f', dcl:'#93c5fd', label:'Manager' },
  cpm:          { bg:'#f0fdf4', color:'#166534', dbg:'#14532d', dcl:'#86efac', label:'CPM' },
  service_desk: { bg:'#fdf4ff', color:'#7e22ce', dbg:'#3b0764', dcl:'#d8b4fe', label:'Service Desk' },
  viewer:       { bg:'#f3f4f6', color:'#374151', dbg:'#1f2937', dcl:'#9ca3af', label:'Utilisateur' },
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
  const { t } = useTranslation()
  const isDark = document.documentElement.classList.contains('dark')

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

  const deleteMutation = useMutation({
    mutationFn: (id) => adminApi.deactivate(id),
    onSuccess: () => { queryClient.invalidateQueries(['admin-users']); toast.success('Utilisateur désactivé') },
    onError: () => toast.error('Erreur'),
  })

  const handleEdit  = (user) => { setEditUser(user); setShowModal(true) }
  const handleClose = () => { setShowModal(false); setEditUser(null); queryClient.invalidateQueries(['admin-users']) }

  return (
    <>
      <PageHeader
        title={t('admin.title')}
        subtitle={stats ? `${stats.totalUsers || 0} ${t('admin.users')} · ${stats.totalTickets || 0} tickets` : ''}
        actions={
          <button className="btn-primary" onClick={() => { setEditUser(null); setShowModal(true) }}>
            <i className="ti ti-user-plus" aria-hidden="true" /> {t('admin.new_user')}
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
                  {[t('admin.user_col'), t('admin.role_col'), t('admin.dept_col'), t('admin.plant_col'), t('admin.status_col'), t('admin.actions_col')].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(users || []).map(user => {
                  const role     = ROLE_STYLE[user.role] || ROLE_STYLE.viewer
                  const roleBg   = isDark ? role.dbg : role.bg
                  const roleCl   = isDark ? role.dcl : role.color
                  const [abg, acl] = getAvatarColors(user.full_name)
                  const initials = getInitials(user.full_name)
                  const isInvited = !user.active && user.invited_at
                  return (
                    <tr key={user.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          {user.avatar_url ? (
                            <img src={user.avatar_url} className="w-8 h-8 rounded-full object-cover border border-gray-200 dark:border-gray-700" />
                          ) : (
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0"
                              style={{ background: abg, color: acl }}>
                              {initials}
                            </div>
                          )}
                          <div>
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{user.full_name}</div>
                            <div className="text-xs text-gray-400">{user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: roleBg, color: roleCl }}>
                          {role.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{user.department || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{user.plant_name || user.plant || '—'}</td>
                      <td className="px-4 py-3">
                        {isInvited ? (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ background: isDark ? '#3b2a00' : '#fff7ed', color: isDark ? '#fcd34d' : '#92400e' }}>
                            {t('admin.invited')}
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{
                              background: user.active ? (isDark ? '#14532d' : '#f0fdf4') : (isDark ? '#1f2937' : '#f3f4f6'),
                              color:      user.active ? (isDark ? '#86efac' : '#166634') : (isDark ? '#9ca3af' : '#6b7280'),
                            }}>
                            {user.active ? t('admin.active') : t('admin.inactive')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => handleEdit(user)} className="btn-ghost text-xs py-1 px-2.5">
                            <i className="ti ti-edit text-sm" aria-hidden="true" /> {t('admin.edit')}
                          </button>
                          <button
                            onClick={() => { if (window.confirm(t('admin.deactivate_confirm') + ' ' + user.full_name + ' ?')) deleteMutation.mutate(user.id) }}
                            className="text-xs py-1 px-2.5 rounded-lg border cursor-pointer inline-flex items-center"
                            style={{ border: '1px solid ' + (isDark ? '#7f1d1d' : '#fecaca'), background: isDark ? '#1f0a0a' : '#fff5f5', color: '#ef4444' }}>
                            <i className="ti ti-trash text-sm" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {(users || []).length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">{t('admin.no_users')}</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <UserModal user={editUser} plants={plants || []} onClose={handleClose} />
      )}
    </>
  )
}
