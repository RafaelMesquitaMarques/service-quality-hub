import { useTranslation } from 'react-i18next'

// ── Status Badge ──────────────────────────────────────────────
export function StatusBadge({ status }) {
  const { t } = useTranslation()
  const cls = {
    not_started: 'pill-ns',
    wip:         'pill-wip',
    completed:   'pill-done',
    cancelled:   'pill-cancelled',
  }[status] || 'pill-ns'
  return <span className={cls}>{t(`status.${status}`)}</span>
}

// ── KPI Card ──────────────────────────────────────────────────
export function KpiCard({ label, value, sub, subColor = 'text-gray-400', icon, iconBg }) {
  return (
    <div className="card p-4">
      {icon && (
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${iconBg}`}>
          <i className={`ti ${icon} text-lg`} aria-hidden="true" />
        </div>
      )}
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-semibold text-gray-900">{value}</div>
      {sub && <div className={`text-xs mt-1 ${subColor}`}>{sub}</div>}
    </div>
  )
}

// ── Page Header ───────────────────────────────────────────────
export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200">
      <div>
        <h1 className="text-base font-semibold text-gray-900">{title}</h1>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────────
export function EmptyState({ icon = 'ti-inbox', message, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <i className={`ti ${icon} text-4xl text-gray-300 mb-3`} aria-hidden="true" />
      <p className="text-sm text-gray-400">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ── Spinner ───────────────────────────────────────────────────
export function Spinner({ size = 'md' }) {
  const s = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-10 h-10' }[size]
  return (
    <div className={`${s} border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin`} />
  )
}

// ── Brand Tag ─────────────────────────────────────────────────
export function BrandTag({ brand }) {
  if (!brand) return null
  return (
    <span className="inline-block px-1.5 py-0.5 text-xs border border-gray-200 rounded bg-gray-50 text-gray-500 font-mono">
      {brand}
    </span>
  )
}

// ── Confirm Dialog ────────────────────────────────────────────
export function ConfirmDialog({ open, title, message, onConfirm, onCancel, danger = false }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
        <h2 className="font-semibold text-gray-900 mb-2">{title}</h2>
        <p className="text-sm text-gray-500 mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="btn-ghost">Annuler</button>
          <button
            onClick={onConfirm}
            className={danger ? 'btn-danger' : 'btn-primary'}
          >
            Confirmer
          </button>
        </div>
      </div>
    </div>
  )
}
