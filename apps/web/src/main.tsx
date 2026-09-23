import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { installQrBarcodeDetectorFallback } from './lib/qr/barcodeDetectorFallback'
import './styles.css'
import './product-images.css'

installQrBarcodeDetectorFallback()

const root = document.querySelector<HTMLDivElement>('#root')

if (!root) throw new Error('NimTrace root element was not found')

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
