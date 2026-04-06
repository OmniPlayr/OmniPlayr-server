import { StrictMode, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import 'normalize.css';
import './styles/index.css'
import './styles/themes/dark.css'
import Login from './login.tsx'
import AccountSelect from './AccountSelect.tsx';
import Dashboard from './Dashboard.tsx';
import Player from './Player.tsx';
import Sidebar from './Sidebar.tsx';
import { getAccount } from './modules/account.ts';
import { getRoutes } from './modules/plugins';
import { usePlugins } from './modules/usePlugins';
import { setNavigate } from './modules/navigate';
import { useSearchParams } from "react-router-dom";
import api from './modules/api.ts';

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

async function loadAccountById(accountId: string) {
    return await api("get_account", undefined, { account_id: accountId }) as any;
}

function NavigateSetter() {
    const nav = useNavigate();
    useEffect(() => { setNavigate(nav); }, [nav]);
    return null;
}

const account_id = getAccount() || null;
const authenticated = isTokenValid() && !!account_id;

function AppShell() {
    const location = useLocation();
    const isAuth = isTokenValid();
    const showShell = isAuth && !!account_id && location.pathname !== '/login';
    const [account, setAccount] = useState<any>(null);
    const [searchParams, setSearchParams] = useSearchParams();
    usePlugins();

    useEffect(() => {
        let accountId = getAccount() || searchParams.get("account_id");
        if (!accountId) return;
        loadAccountById(accountId).then(fetched => setAccount(fetched));
        setSearchParams({});
    }, [searchParams]);


    return (
        <>
            {showShell ? (
                <div className="dashboard" data-component="Dashboard">
                    <div className="dashboard-hor">
                        <Sidebar account={account} />
                        <div className="dashboard-main">
                            <Routes>
                                <Route path="/" element={<Dashboard />} />
                                <Route path="/dashboard" element={<Dashboard />} />
                                {getRoutes().map(({ path, component: Component }) => (
                                    <Route key={path} path={path} element={<Component />} />
                                ))}
                                <Route path="*" element={<Navigate to="/" />} />
                            </Routes>
                        </div>
                    </div>
                    <Player />
                </div>
            ) : (
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="/" element={
                        !isTokenValid()
                            ? <Navigate to="/login" />
                            : <AccountSelect />
                    } />
                    <Route path="*" element={<Navigate to="/login" />} />
                </Routes>
            )}
            <NavigateSetter />
        </>
    );
}

function App() {
    return (
        <BrowserRouter>
            <AppShell />
        </BrowserRouter>
    )
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
)