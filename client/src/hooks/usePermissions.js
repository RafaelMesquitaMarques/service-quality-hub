// src/hooks/usePermissions.js
import { useAuthStore } from '../store/authStore';

const EDITOR_ROLES = ['admin', 'manager', 'cpm', 'service_desk'];

export function usePermissions() {
  const user = useAuthStore(s => s.user);

  // O role vem do user_profiles via fetchProfile no authStore
  const role = user?.role || 'user';

  const canEdit = EDITOR_ROLES.includes(role);
  const isAdmin = role === 'admin';
  const isManager = ['admin', 'manager'].includes(role);

  return { role, canEdit, isAdmin, isManager };
}
