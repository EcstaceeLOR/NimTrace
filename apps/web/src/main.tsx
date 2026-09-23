import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import './styles.css'
import './product-images.css'

const root = document.querySelector<HTMLDivElement>('#root')

if (!root) throw new Error('NimTrace root element was not found')

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
