import { createRoot } from 'react-dom/client'
import { App } from './App'
import '../shared/styles.css'
import './styles.css'

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
