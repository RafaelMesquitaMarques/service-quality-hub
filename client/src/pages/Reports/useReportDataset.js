import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchReportDataset } from '../../services/api'
import { buildRows } from './engine/dataset.js'

// Jeu de données des rapports. `refetchOnMount: 'always'` : ouvrir un rapport
// relit toujours les données actuelles (un rapport enregistré ne fige rien).
// Pendant la relecture, l'export est bloqué pour ne jamais exporter l'ancien jeu.
export function useReportDataset() {
  const [progress, setProgress] = useState(null)
  const query = useQuery({
    queryKey: ['report-dataset'],
    queryFn: async () => {
      setProgress({ step: 'tickets', loaded: 0, total: null })
      try {
        return await fetchReportDataset({ onProgress: setProgress })
      } finally {
        setProgress(null)
      }
    },
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
    retry: 0,
  })
  const rows = useMemo(() => (query.data ? buildRows(query.data) : []), [query.data])
  return { ...query, rows, progress, referentials: query.data?.referentials || null, loadedAt: query.data?.loadedAt || null }
}
