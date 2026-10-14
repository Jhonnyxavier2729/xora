import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Si la interfaz falla al dibujarse, en vez de quedarse en blanco ofrece volver a intentarlo o reparar
 * (limpia solo datos temporales de la ventana). Tus workspaces, notas, claves y ajustes no se tocan:
 * viven en la carpeta de datos de Xora, fuera de la ventana.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui] la interfaz falló', error, info.componentStack)
  }

  private repair = (): void => {
    try {
      // Solo lo que la ventana puede reconstruir sola (temporizador, música, cachés). Nada del usuario.
      for (const key of Object.keys(localStorage)) if (key.startsWith('xora.')) localStorage.removeItem(key)
      sessionStorage.clear()
    } catch {
      // Sin almacenamiento: nada que limpiar.
    }
    window.location.reload()
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="crash">
        <div className="crash-card">
          <h2>Algo salió mal al abrir esta ventana</h2>
          <p>Tus workspaces, notas, claves y ajustes están a salvo. Prueba a volver a intentarlo; si vuelve a fallar, repara.</p>
          <pre>{this.state.error.message}</pre>
          <div className="crash-actions">
            <button className="btn primary" onClick={() => window.location.reload()}>
              Volver a intentarlo
            </button>
            <button className="btn" onClick={this.repair}>
              Reparar y reiniciar
            </button>
          </div>
        </div>
      </div>
    )
  }
}
