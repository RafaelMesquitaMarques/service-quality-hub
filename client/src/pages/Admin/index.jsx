import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { adminApi } from '../../services/api'
import { PageHeader, Spinner } from '../../components/ui'
import toast from 'react-hot-toast'

const ROLES = ['admin','manager','cpm','service_desk','viewer']
const ROLE_COLORS = {
  admin: 'bg-purple-100 text-purple-700',
  manager: 'bg-blue-100 text-blue-700',
  cpm: 'bg-green-100 text-green-700',
  service_desk: 'bg-amber-100 text-amber-700',
  viewer: 'bg-gray-100 text-gray-600',
}

export default function AdminPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'cpm', language: 'fr' })

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => adminApi.users().then(r => r.data)
  })

  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => adminApi.stats().then(r => r.data)
  })

  const createMutation = useMutation({
    mutationFn: adminApi.createUser,
    onSuccess: () => {
      queryClient.invalidateQueries(['admin-users'])
      toast.success('Utilisateur créé!')
      setShowForm(false)
      setForm({ full_name: '', email: '', password: '', role: 'cpm', language: 'fr' })
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Erreur')
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }) => adminApi.updateUser(id, { active }),
    onSuccess: () => queryClient.invalidateQueries(['admin-users'])
  })

  return (
    <>
      <PageHeader
        title={t('nav.admin')}
        subtitle={stats ? `${stats.total_tickets} tickets · ${stats.total_users} users · ${stats.storage_used_mb}MB storage` : ''}
        actions={
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <i className="ti ti-user-plus" /> Nouvel utilisateur
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-5">
        {showForm && (
          <div className="card p-4 mb-5 max-w-lg">
            <div className="text-sm font-semibold mb-3">Créer un utilisateur</div>
            <div className="space-y-3">
              <div><label className="label">Nom complet</label>
                <input className="input" value={form.full_name} onChange={e => setForm(f => ({...f, full_name: e.target.value}))} /></div>
              <div><label className="label">Email</label>
                <input type="email" className="input" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} /></div>
              <div><label className="label">Mot de passe</label>
                <input type="password" className="input" value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Rôle</label>
                  <select className="input" value={form.role} onChange={e => setForm(f => ({...f, role: e.target.value}))}>
                    {ROLES.map(r => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                  </select></div>
                <div><label className="label">Langue</label>
                  <select className="input" value={form.language} onChange={e => setForm(f => ({...f, language: e.target.value}))}>
                    <option value="fr">Français</option>
                    <option value="en">English</option>
                  </select></div>
              </div>
              <div className="flex gap-2 pt-2">
                <button className="btn-ghost" onClick={() => setShowForm(false)}>Annuler</button>
                <button className="btn-primary" onClick={() => createMutation.mutate(form)} disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Création...' : 'Créer'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="card overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center p-8"><Spinner /></div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Nom','Email','Rôle','Langue','Statut',''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(users || []).map(user => (
                  <tr key={user.id} className="border-b border-gray-50">
                    <td className="px-4 py-3 font-medium text-sm">{user.full_name}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{
