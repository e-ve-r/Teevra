import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import DepartmentDashboard from './components/Department/DepartmentDashboard.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/^\/(responder|dispatch)(\/|$)/.test(window.location.pathname) ? <DepartmentDashboard /> : <App />}
  </StrictMode>,
)
