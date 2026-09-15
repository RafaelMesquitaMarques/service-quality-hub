// Droits sur les rapports enregistrés — miroir EXACT des politiques RLS de
// server/src/db/migration_2026-09-15_saved_reports.sql. L'interface masque les
// actions non permises ; la base les refuse de toute façon.
//
// Les données elles-mêmes ne dépendent pas de ces règles : un rapport (modèle,
// personnel ou partagé) relit toujours les occurrences avec la session de la
// personne qui l'exécute ou l'exporte.

const MANAGER_ROLES = ['admin', 'manager']

export function reportRights(user) {
  const role = user?.role || 'viewer'
  const active = user?.active !== false
  return {
    // Partager une configuration avec toute l'équipe.
    canShare: active && MANAGER_ROLES.includes(role),
    isAdmin: active && role === 'admin',
  }
}

export function canViewSavedReport(report, user) {
  return !!report && (report.owner_id === user?.id || report.visibility === 'shared')
}

// Peut-il enregistrer `report` (déjà en base) avec la visibilité `nextVisibility` ?
export function canUpdateSavedReport(report, user, nextVisibility = report?.visibility) {
  if (!report || !user) return false
  const { canShare, isAdmin } = reportRights(user)
  const isOwner = report.owner_id === user.id
  if (isOwner && (nextVisibility === 'private' || canShare)) return true
  return isAdmin && report.visibility === 'shared' && nextVisibility === 'shared'
}

export function canDeleteSavedReport(report, user) {
  if (!report || !user) return false
  return report.owner_id === user.id || reportRights(user).isAdmin
}

export function canCreateWithVisibility(user, visibility) {
  return visibility === 'private' || reportRights(user).canShare
}
