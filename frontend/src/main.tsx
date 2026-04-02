import { StrictMode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import 'normalize.css';
import './styles/index.css'
import './styles/themes/dark.css'
import Login from './login.tsx'
import AccountSelect from './AccountSelect.tsx';
import Dashboard from './Dashboard.tsx';

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

const account_id = sessionStorage.getItem("account_id") || null;

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            isTokenValid()
              ? account_id
                ? <Dashboard />
                : <AccountSelect />
              : <Navigate to="/login" />
          }
        />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={isTokenValid() ? <Dashboard /> : <Navigate to="/login" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)