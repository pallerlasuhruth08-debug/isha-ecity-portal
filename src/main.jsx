import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service worker registration now lives in <PwaUpdatePrompt> (src/components/PwaUpdatePrompt.jsx)
// via vite-plugin-pwa's useRegisterSW hook, mounted at the top of App -- covers
// app-shell precaching/offline + the update-available prompt, in addition to Web Push.
