import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { installProductImagePickerCompatibility } from './lib/images/productPickerCompat'
import { installQrBarcodeDetectorFallback } from './lib/qr/barcodeDetectorFallback'
import './styles.css'
import './product-images.css'
import './catalogue-lifecycle.css'
import './mobile.css'
import './mobile-polish.css'

installQrBarcodeDetectorFallback()
installProductImagePickerCompatibility()

const root = document.querySelector<HTMLDivElement>('#root')

if (!root) throw new Error('NimTrace root element was not found')

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
