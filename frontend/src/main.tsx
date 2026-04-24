import { StrictMode, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import 'normalize.css';
import './styles/index.css'
import './styles/themes/light.css'
import './styles/themes/dark.css'
import './styles/themes/transparent.css'
import './styles/fonts/default-fonts.css'
import Login from './login.tsx'
import AccountSelect from './AccountSelect.tsx';
import Dashboard from './Dashboard.tsx';
import {Player} from './Player.tsx';
import Sidebar from './Sidebar.tsx';
import BottomNav from './BottomNav.tsx';
import { getAccount } from './modules/account.ts';
import { getRoutes, getTab, getTabByUrl, notifyPluginsLoaded } from './modules/plugins';
import { usePlugins } from './modules/usePlugins';
import { setNavigate } from './modules/navigate';
import { useSearchParams } from "react-router-dom";
import api from './modules/api.ts';
import Header from './Header.tsx';
import Settings from './Settings.tsx';
import { initSafeMode } from './modules/safeMode';
import Shutdown from './Shutdown.tsx';
import { generateCssVars } from './modules/customColor.ts';

const savedTheme = localStorage.getItem('theme') ?? 'dark';
const preferSystemTheme = localStorage.getItem('prefer_system_theme') === 'true' ? true : false;

if (preferSystemTheme) {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.setAttribute('prefer-system-theme', 'true');
    } else {
        document.documentElement.setAttribute('data-theme', 'light');
        document.documentElement.setAttribute('prefer-system-theme', 'true');
    }
} else {
    document.documentElement.setAttribute('data-theme', savedTheme);
}

const savedFont = localStorage.getItem('font');
if (savedFont) {
    document.documentElement.setAttribute('data-font', savedFont);
}

const customColor = localStorage.getItem('custom_color');
if (customColor) {
    if (customColor && /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(customColor)) {
        const cssVars = generateCssVars(customColor, 'clr-primary');
        if (cssVars) document.documentElement.style.cssText += cssVars;
    }
}

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

async function loadPlugins(): Promise<void> {
    const modules = import.meta.glob('./plugins/*/index.{ts,tsx}');
    await Promise.all(Object.values(modules).map(m => (m as () => Promise<unknown>)()));
    notifyPluginsLoaded();
}

function NavigateSetter() {
    const nav = useNavigate();
    useEffect(() => { setNavigate(nav); }, [nav]);
    return null;
}

function resolveActiveTabFromPath(pathname: string): string | null {
    if (pathname.startsWith('/settings')) return '__settings';
    const tab = getTabByUrl(pathname);
    if (tab) return tab.id;
    return null;
}

function useIsMobile() {
    const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
    useEffect(() => {
        const mq = window.matchMedia('(max-width: 768px)');
        const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);
    return isMobile;
}

function AppShell() {
    const location = useLocation();
    const navigate = useNavigate();
    const [isAuth] = useState(() => isTokenValid());
    const [accountId, setAccountId] = useState<string | null>(getAccount);
    const showShell = isAuth && !!accountId && location.pathname !== '/login' && location.pathname !== '/shutdown';
    const [account, setAccount] = useState<any>(null);
    const [searchParams, setSearchParams] = useSearchParams();
    const isMobile = useIsMobile();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [safeMode, setSafeMode] = useState(false);

    const [activeTabId, setActiveTabId] = useState<string | null>(() =>
        resolveActiveTabFromPath(location.pathname)
    );

    const [navHistory, setNavHistory] = useState<string[]>([location.pathname]);
    const [historyIndex, setHistoryIndex] = useState(0);

    useEffect(() => {
        if (!isAuth) return;
        initSafeMode().then(sm => {
            setSafeMode(sm);
            if (!sm) {
                loadPlugins().catch(console.error);
            }
        }).catch(() => {
            setSafeMode(false);
            loadPlugins().catch(console.error);
        });
    }, [isAuth]);

    useEffect(() => {
        if (!showShell) return;

        setNavHistory(prev => {
            const current = prev.slice(0, historyIndex + 1);
            if (current[current.length - 1] === location.pathname) return prev;
            const next = [...current, location.pathname];
            setHistoryIndex(next.length - 1);
            return next;
        });
    }, [location.pathname, showShell]);

    useEffect(() => {
        if (!showShell) return;
        const resolved = resolveActiveTabFromPath(location.pathname);
        setActiveTabId(resolved);
    }, [location.pathname, showShell]);

    useEffect(() => {
        setSidebarOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        if (!isMobile) setSidebarOpen(false);
    }, [isMobile]);

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

    usePlugins();

    const handleTabChange = (tabId: string | null) => {
        if (tabId === null) {
            navigate('/');
            return;
        }
        if (tabId === '__settings') {
            navigate('/settings');
            return;
        }
        const tab = getTab(tabId);
        if (tab?.url) {
            navigate(tab.url);
            return;
        }
        setActiveTabId(tabId);
    };

    useEffect(() => {
        const id = searchParams.get("account_id");
        if (!id) return;
        setAccountId(id);
        setNavHistory(['/']);
        setHistoryIndex(0);
        setActiveTabId(null);
        navigate('/dashboard');
        setSearchParams({});
    }, [searchParams]);

    useEffect(() => {
        if (!accountId) return;
        loadAccountById(accountId).then(fetched => setAccount(fetched));
    }, [accountId]);

    const resolvedTabId = resolveActiveTabFromPath(location.pathname) ?? activeTabId;
    const activeTab = resolvedTabId ? getTab(resolvedTabId) : null;
    const ActiveTabView = activeTab?.view ?? null;

    return (
        <>
            {showShell ? (
                <div className="dashboard" data-component="Dashboard">
                    {!isMobile && (
                        <Header
                            canGoBack={historyIndex > 0}
                            canGoForward={historyIndex < navHistory.length - 1}
                            onBack={goBack}
                            onForward={goForward}
                            safeMode={safeMode}
                        />
                    )}
                    <div className="dashboard-hor">
                        {isMobile && (
                            <>
                            <BottomNav
                                onMenuToggle={() => setSidebarOpen(prev => !prev)}
                                onHome={() => handleTabChange(null)}
                                onSettings={() => handleTabChange('__settings')}
                                activeTabId={resolvedTabId}
                                isMenuOpen={sidebarOpen}
                            />
                            <Player />
                            </>
                        )}
                        {!isMobile && (
                            <Sidebar
                                account={account}
                                activeTabId={resolvedTabId}
                                onTabChange={handleTabChange}
                            />
                        )}
                        {isMobile && (
                            <Sidebar
                                account={account}
                                activeTabId={resolvedTabId}
                                onTabChange={handleTabChange}
                                isOpen={sidebarOpen}
                                onClose={() => setSidebarOpen(false)}
                            />
                        )}
                        <div className="dashboard-main">
                            {ActiveTabView ? (
                                <ActiveTabView />
                            ) : (
                                <Routes>
                                    <Route path="/" element={<Dashboard />} />
                                    <Route path="/settings/*" element={<Settings account={account} />} />
                                    <Route path="/dashboard" element={<Dashboard />} />
                                    {getRoutes().map(({ path, component: Component }) => (
                                        <Route key={path} path={path} element={<Component />} />
                                    ))}
                                    <Route path="*" element={<Navigate to="/" />} />
                                </Routes>
                            )}
                        </div>
                    </div>
                    {!isMobile && (
                        <Player /> 
                    )}
                </div>
            ) : (
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="/shutdown" element={<Shutdown />} />
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
    const [shellKey, setShellKey] = useState(0);

    useEffect(() => {
        const handler = () => setShellKey(k => k + 1);
        window.addEventListener('account-switched', handler);
        return () => window.removeEventListener('account-switched', handler);
    }, []);

    return (
        <BrowserRouter>
            <AppShell key={shellKey} />
        </BrowserRouter>
    )
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
)

export default AppShell