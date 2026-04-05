import { StrictMode, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import 'normalize.css';
import './styles/index.css'
import './styles/themes/dark.css'
import Login from './login.tsx'
import AccountSelect from './AccountSelect.tsx';
import Dashboard from './Dashboard.tsx';
import { getAccount } from './modules/account.ts';
import { getRoutes } from './modules/plugins';
import { setNavigate } from './modules/navigate';

import.meta.glob('./plugins/*/index.{ts,tsx}', { eager: true });

function isTokenValid(): boolean {
    const access_expiry = localStorage.getItem('access_token_expires');
    const access_token = localStorage.getItem('access_token');
    if (access_expiry && access_token) {
        const expiryTime = new Date(access_expiry).getTime();
        return Date.now() < expiryTime;
    }
    return false;
}

function NavigateSetter() {
    const nav = useNavigate();
    useEffect(() => { setNavigate(nav); }, [nav]);
    return null;
}

const account_id = getAccount() || null;

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
				<Route path="/dashboard" element={
					isTokenValid()
						? account_id
						? <Dashboard /> 
						: <AccountSelect />
						: <Navigate to="/login" />} />

                {getRoutes().map(({ path, component: Component }) => (
                    <Route key={path} path={path} element={<Component />} />
                ))}

				<Route path="*" element={<Navigate to="/" />} />
			</Routes>
			<NavigateSetter />
		</BrowserRouter>
	)
}

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<App />
	</StrictMode>,
)