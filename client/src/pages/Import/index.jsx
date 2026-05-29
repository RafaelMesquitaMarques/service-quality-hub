import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { importApi } from '../../services/api'
import { PageHeader, Spinner } from '../../components/ui'
import toast from 'react-hot-toast'

export default function ImportPage() {
  const { t } = useTranslation()
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  const handleFile = async (f) => {
    setFile(f)
    setLoading(true)
    try {
      const res = await importApi.preview(f)
      setPreview(res.data)
    } catch { toast.error('Erreur lecture fichier') }
    finally { setLoading(false) }
  }

  const handleImport = async () => {
    if (!file) return
    setLoading(true)
    try {
      const res = await importApi.run(file, true)
      setResult(res.data)
      toast.success(`${res.data.imported} tickets importés!`)
    } catch { toast.error('Erreur import') }
    finally { setLoading(false) }
  }

  return (
    <>
      <PageHeader title={t('import.title')} />
      <div className="flex-1 overflow-y-auto p-5 max-w-2xl">
        {!preview ? (
          <div className="card p-6">
            <div
              className="border-2 border-dashed border-gray-200 rounded-xl p-10 text-center cursor-pointer hover:border-blue-400 transition-colors"
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}
              onClick={() => document.getElementById('file-input').click()}
            >
              {loading ? <Spinner /> : (
                <>
                  <i className="ti ti-file-spreadsheet text-4xl text-gray-300 block mb-3" />
                  <div className="font-medium text-gray-600">{t('import.drop')}</div>
                  <div className="text-xs text-gray-400 mt-1">{t('import.drop_sub')}</div>
                  <button className="btn-primary mt-4">{t('import.choose')}</button>
                </>
              )}
            </div>
            <input id="file-input" type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => handleFile(e.target.files[0])} />
          </div>
        ) : result ? (
          <div className="card p-6">
            <div className="flex items-center gap-3 p-4 bg-green-50 rounded-xl text-green-800 mb-4">
              <i className="ti ti-circle-check text-2xl" />
              <div>
                <div className="font-semibold">{result.imported} tickets importés</div>
                <div className="text-sm">{result.skipped} ignorés (doublons)</div>
              </div>
            </div>
            <button className="btn-ghost" onClick={() => { setFile(null); setPreview(null); setResult(null) }}>
              Nouvel import
            </button>
          </div>
        ) : (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="font-semibold text-sm">Aperçu — {preview.sheet}</div>
                <div className="text-xs text-gray-400">{preview.total_rows} lignes détectées</div>
              </div>
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={() => { setFile(null); setPreview(null) }}>Annuler</button>
                <button className="btn-primary" onClick={handleImport} disabled={loading}>
                  {loading ? <Spinner size="sm" /> : t('import.confirm')}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200">
                    {['Date','Ship To','Issue','Brand','Status','Cost'].map(h => (
                      <th key={h} className="px-2 py-2 text-left text-gray-400 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(preview.preview || []).slice(0,10).map((row, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="px-2 py-1.5">{row.issue_reception_date}</td>
                      <td className="px-2 py-1.5 max-w-24 truncate">{row.ship_to}</td>
                      <td className="px-2 py-1.5 max-w-40 truncate">{row.quality_issue}</td>
                      <td className="px-2 py-1.5">{row.brand}</td>
                      <td className="px-2 py-1.5">{row.status}</td>
                      <td className="px-2 py-1.5">{row.cost_approx ? `$${row.cost_approx}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
