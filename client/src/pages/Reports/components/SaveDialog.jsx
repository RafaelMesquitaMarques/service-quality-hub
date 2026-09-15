import { useEffect, useState } from 'react'

// Nom, description et visibilité d'une configuration de rapport.
export default function SaveDialog({ mode, initial, canShare, allowPrivate = true, saving, error, onSubmit, onClose, t }) {
  const [name, setName] = useState(initial.name || '')
  const [description, setDescription] = useState(initial.description || '')
  const [visibility, setVisibility] = useState(!allowPrivate ? 'shared' : canShare ? (initial.visibility || 'private') : 'private')
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const valid = name.trim().length > 0 && name.trim().length <= 150

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <form role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); if (valid && !saving) onSubmit({ name: name.trim(), description: description.trim(), visibility }) }}
        className="bg-white dark:bg-[#161B22] rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-md p-5 flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{mode === 'saveAs' ? t('reports.save.title_new') : t('reports.save.title_update')}</h2>
        <label className="flex flex-col gap-1">
          <span className="label mb-0">{t('reports.save.name')} *</span>
          <input autoFocus className="input" value={name} maxLength={150} onChange={e => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label mb-0">{t('reports.save.description')}</span>
          <textarea className="input resize-y" rows={3} value={description} onChange={e => setDescription(e.target.value)} />
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="label">{t('reports.save.visibility')}</legend>
          {['private', 'shared'].map(v => (
            <label key={v} className={`flex items-start gap-2 text-xs rounded-lg border px-3 py-2 cursor-pointer ${visibility === v ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700'} ${(v === 'shared' && !canShare) || (v === 'private' && !allowPrivate) ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <input type="radio" name="visibility" className="accent-blue-600 mt-0.5" value={v} checked={visibility === v}
                disabled={(v === 'shared' && !canShare) || (v === 'private' && !allowPrivate)} onChange={() => setVisibility(v)} />
              <span>
                <span className="block font-medium text-gray-800 dark:text-gray-100">
                  <i className={`ti ${v === 'private' ? 'ti-lock' : 'ti-users'} mr-1`} aria-hidden="true" />{t(`reports.visibility.${v}`)}
                </span>
                <span className="block text-[11px] text-gray-500 dark:text-gray-400">{t(`reports.visibility.${v}_desc`)}</span>
              </span>
            </label>
          ))}
          {!canShare && <p className="text-[11px] text-gray-400">{t('reports.save.share_restricted')}</p>}
          {!allowPrivate && <p className="text-[11px] text-gray-400">{t('reports.save.admin_shared_only')}</p>}
        </fieldset>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn-primary disabled:opacity-50" disabled={!valid || saving}>
            <i className="ti ti-device-floppy" aria-hidden="true" /> {saving ? t('common.saving') : t('reports.save.submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
