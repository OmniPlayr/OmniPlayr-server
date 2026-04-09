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
import Header from './Header.tsx';

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

function AppShell() {
    const location = useLocation();
    const [isAuth] = useState(() => isTokenValid());
    const [accountId, setAccountId] = useState<string | null>(getAccount);
    const showShell = isAuth && !!accountId && location.pathname !== '/login';
    const [account, setAccount] = useState<any>(null);
    const [searchParams, setSearchParams] = useSearchParams();

    // For tracking dashboard history:
    const [navHistory, setNavHistory] = useState<string[]>([location.pathname]);
    const [historyIndex, setHistoryIndex] = useState(0);
    const navigate = useNavigate();

    useEffect(() => {
        // This just checks if the user is authenticated and logged into an account, if not the shell wont load anyway, so this is a nice way to check that in my opinion.
        if (!showShell) return;

        setNavHistory(prev => {
            const current = prev.slice(0, historyIndex + 1);
            if (current[current.length - 1] === location.pathname) return prev;
            const next = [...current, location.pathname];
            setHistoryIndex(next.length - 1);
            return next;
        });
    }, [location.pathname, showShell]);

    const goBack = () => {
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            setHistoryIndex(newIndex);
            navigate(navHistory[newIndex]);
        }
    };

    const goForward = () => {
        if (historyIndex < navHistory.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            navigate(navHistory[newIndex]);
        }
    };

    // Load plugins
    usePlugins();

    useEffect(() => {
        const id = searchParams.get("account_id");
        if (!id) return;
        setAccountId(id);
        setSearchParams({});
    }, [searchParams]);

    useEffect(() => {
        if (!accountId) return;
        loadAccountById(accountId).then(fetched => setAccount(fetched));
    }, [accountId]);

    return (
        <>
            {showShell ? (
                <div className="dashboard" data-component="Dashboard">
                    <Header
                        canGoBack={historyIndex > 0}
                        canGoForward={historyIndex < navHistory.length - 1}
                        onBack={goBack}
                        onForward={goForward}
                    />
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
                            : <AccountSelect onAccountSelected={setAccountId} />
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

export default AppShell