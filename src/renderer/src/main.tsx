import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import './floating.css'
import './look.css'
import './settings.css'
import './task.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
