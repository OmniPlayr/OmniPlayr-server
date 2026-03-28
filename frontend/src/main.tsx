import { StrictMode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import 'normalize.css';
import './styles/index.css'
import './styles/themes/dark.css'
import Login from './login.tsx'
import OmniPlayr from './OmniPlayr.tsx';

function isTokenValid(): boolean {
  const access_expiry = localStorage.getItem('access_token_expires');
  const access_token = localStorage.getItem('access_token');

  if (access_expiry && access_token) {
    const expiryTime = new Date(access_expiry).getTime();
    const now = Date.now();
    return now < expiryTime;
  }
  return false;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={isTokenValid() ? <OmniPlayr /> : <Navigate to="/login" />} />
        <Route path="/login" element={<Login />} />
      </Routes>
    </BrowserRouter>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)