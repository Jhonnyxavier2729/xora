import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import './floating.css'
import './look.css'
import './settings.css'
import './task.css'
import './composer.css'
import './canvas-feel.css'
import './extras.css'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

// Permite ajustar el CSS por sistema (p. ej. dejar sitio a los semáforos de macOS).
document.documentElement.dataset.platform = window.api.app.platform

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
