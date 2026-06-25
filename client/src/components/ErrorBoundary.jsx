import { Component } from 'react'

// Filet de sécurité global : capture toute erreur de rendu React et affiche un
// écran de récupération au lieu d'une page blanche. (Doit être un composant
// classe — les error boundaries ne fonctionnent pas avec les hooks.)
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // Visible dans la console pour diagnostiquer si d'autres utilisateurs tombent dessus.
    console.error('App crashed (ErrorBoundary):', error, info?.componentStack)
  }

  handleReload = () => { window.location.reload() }

  render() {
    if (!this.state.hasError) return this.props.children

    const isEn = (typeof document !== 'undefined'
      ? (document.documentElement.lang || 'fr')
      : 'fr').startsWith('en')

    const wrap = {
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0D1117', padding: 24, fontFamily: 'system-ui, sans-serif',
    }
    const card = {
      maxWidth: 440, width: '100%', background: '#161B22', borderRadius: 16,
      border: '1px solid #30363d', padding: 32, textAlign: 'center', color: '#e6edf3',
    }

    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>
            {isEn ? 'Something went wrong' : 'Une erreur est survenue'}
          </h1>
          <p style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.5, margin: '0 0 20px' }}>
            {isEn
              ? 'The page ran into an unexpected error. Reloading usually fixes it.'
              : 'La page a rencontré une erreur inattendue. Recharger règle généralement le problème.'}
          </p>
          <button
            onClick={this.handleReload}
            style={{
              background: '#185FA5', color: '#fff', border: 'none', borderRadius: 10,
              padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {isEn ? 'Reload the page' : 'Recharger la page'}
          </button>
          {this.state.error?.message && (
            <pre style={{
              marginTop: 20, textAlign: 'left', fontSize: 11, color: '#6b7280',
              background: '#0D1117', borderRadius: 8, padding: 12, overflow: 'auto',
              maxHeight: 120, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {this.state.error.message}
            </pre>
          )}
        </div>
      </div>
    )
  }
}
