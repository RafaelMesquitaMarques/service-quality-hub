// src/hooks/usePermissions.js
import { useAuthStore } from '../store/authStore'

const EDITOR_ROLES  = ['admin', 'manager', 'cpm', 'service_desk']

export function usePermissions() {
  const user = useAuthStore(s => s.user)
  const role = user?.role || 'viewer'

  const roleCanEdit   = EDITOR_ROLES.includes(role)
  const roleIsAdmin   = role === 'admin'
  const roleIsManager = ['admin', 'manager'].includes(role)

  const canCreateOccurrence = user?.perm_create_occurrence  ?? roleCanEdit
  const canEditOccurrence   = user?.perm_edit_occurrence    ?? roleCanEdit
  const canDeleteOccurrence = user?.perm_delete_occurrence  ?? roleIsManager
  const canViewDashboard    = user?.perm_view_dashboard     ?? true
  const canAdmin            = user?.perm_admin              ?? roleIsAdmin
  const canManagePlants     = user?.perm_manage_plants      ?? roleIsAdmin
  const canImportExcel      = user?.perm_import_excel       ?? roleIsManager
  const canCreateMobile     = user?.perm_create_mobile      ?? true
  const canMeetings         = user?.perm_meetings           ?? true

  return {
    role,
    canEdit:   canEditOccurrence,
    isAdmin:   canAdmin,
    isManager: roleIsManager,
    canCreateOccurrence,
    canEditOccurrence,
    canDeleteOccurrence,
    canViewDashboard,
    canAdmin,
    canManagePlants,
    canImportExcel,
    canCreateMobile,
    canMeetings,
  }
}
