import { useQuery } from '@tanstack/react-query'
import { supabase } from '../services/supabase'
import { CATEGORIES, DEPARTMENTS } from '../constants/taxonomy'

// Listes département / catégorie gérées dans Référentiels (tables Supabase),
// avec repli sur les constantes de taxonomy.js si la table est vide ou
// inaccessible — même schéma que brandOptions dans TicketModal.
function useNames(queryKey, table, fallback) {
  const { data } = useQuery({
    queryKey: [queryKey],
    queryFn: async () => {
      const { data } = await supabase.from(table).select('name').eq('active', true).order('name')
      return data
    },
  })
  return data?.length ? data.map(r => r.name) : fallback
}

export function useDepartments() {
  return useNames('departments', 'departments', DEPARTMENTS)
}

export function useCategories() {
  return useNames('categories', 'categories', CATEGORIES)
}
