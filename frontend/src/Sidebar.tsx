import './styles/Sidebar.css';
import defaultPfp from "./assets/images/default-pfp-dark.svg";
import { Plus, Settings, House, ChevronDown } from 'lucide-react';
import { isDev } from './modules/dev';
import api from './modules/api';
import { useEffect, useState } from 'react';
import { useSearchParams } from "react-router-dom";
import { storeAccount } from './modules/account';
import { usePlugins } from './modules/usePlugins';
import { getTabs, onPluginsLoaded, type PluginTab } from './modules/plugins';
import { makePopup } from '@wokki20/jspt';

async function loadAccounts() {
    return await api("get_accounts") as any[];
}

function openAccountSelect() {
    const accountSelect = document.querySelector(".account-select__dash") as HTMLElement;
    accountSelect.classList.toggle("open");

    const accountSelectOptions = document.querySelector(".user-switch-account") as HTMLElement;
    accountSelectOptions.classList.toggle("active");
}

interface SidebarProps {
    account: any;
    activeTabId: string | null;
    onTabChange: (tabId: string | null) => void;
    isOpen?: boolean;
    onClose?: () => void;
    updateAvailable?: boolean;
}

async function loginAccount(id: string) {
    const tokenInfo = await api("/accounts/login", { user_id: id }) as any;
    storeAccount(tokenInfo?.token);
    window.history.pushState({}, '', '/');
    window.dispatchEvent(new Event('account-switched'));
}

function showDevPopup() {
    makePopup({
        header: "Developer Mode",
        content_type: "html",
        content: `
            <div class="dev-popup">
                <h2 class="dev-popup-title">About Developer Mode</h2>
                <p>Developer mode enables additional debugging tools and verbose logging throughout the application.</p>

                <h3>Performance impact</h3>
                <p>Because of the extra logging and instrumentation, <strong>your server may run slower</strong> than usual. Opening the log page in particular can also <strong>slow down your device</strong>, especially when a lot of log entries have accumulated.</p>

                <h3>Stability</h3>
                <p>This is a development build and it <strong>may be unstable</strong>. Bugs can and likely will appear. If you run into anything, please report it on <a href="https://github.com/OmniPlayr/OmniPlayr-server/issues" class="link" target="_blank" rel="noreferrer">GitHub</a>.</p>
                <p>There is <strong>no warranty</strong> of any kind. For license details, go to <strong>Settings &gt; About</strong>. OmniPlayr is released under the MIT license.</p>

                <h3>Live updates</h3>
                <p>The frontend will <strong>hot-reload automatically</strong> when changes are made in the source, no manual refresh needed.</p>

                <h3>Contributing</h3>
                <p>Want to contribute? Make sure to read the <a href="https://omniplayr.wokki20.nl/legal/cla" class="link" target="_blank" rel="noreferrer">Contributor License Agreement</a> and the <a href="https://omniplayr.wokki20.nl/legal/code-of-conduct" class="link" target="_blank" rel="noreferrer">Code of Conduct</a> before submitting anything.</p>
            </div>
        `,
    });
}

function Sidebar({ account, activeTabId, onTabChange, isOpen, onClose, updateAvailable }: SidebarProps) {
    const [accounts, setAccounts] = useState<any[]>([]);
    const [accounts_loaded, setAccountsLoaded] = useState(false);
    const [tabs, setTabs] = useState<PluginTab[]>([]);
    usePlugins();

    useEffect(() => {
        loadAccounts().then(fetched => {
            setAccounts(fetched);
            setTimeout(() => setAccountsLoaded(true), 50);
        });
    }, []);

    useEffect(() => {
        setTabs(getTabs());
        const unsub = onPluginsLoaded(() => setTabs(getTabs()));
        return unsub;
    }, []);

    function handleTabChange(tabId: string | null) {
        onTabChange(tabId);
        onClose?.();
    }

    return (
        <>
            {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
            <div className={`sidebar${isOpen ? " sidebar--open" : ""}`} data-component="Sidebar">
                <div className="sidebar-header">
                    <p className="sidebar-title">OmniPlayr</p>
                </div>
                <div className="sidebar-library-list">

                </div>
                <div className="sidebar-footer">
                    <div className="sidebar-tabs">
                        <div
                            className={`sidebar-tab${activeTabId === null ? ' active' : ''}`}
                            onClick={() => handleTabChange(null)}
                        >
                            <House className="tab-icon" />
                            <p className="tab-text">Home</p>
                        </div>
                        {tabs.map(tab => {
                            const Icon: any = tab.icon;
                            return (
                                <div
                                    key={tab.id}
                                    className={`sidebar-tab${activeTabId === tab.id ? ' active' : ''}`}
                                    onClick={() => handleTabChange(tab.id)}
                                >
                                    <Icon className="tab-icon" />
                                    <p className="tab-text">{tab.label}</p>
                                </div>
                            );
                        })}
                        <div className={`sidebar-tab${activeTabId === "__settings" ? ' active' : ''}`} onClick={() => onTabChange("__settings")}>
                            <Settings className="tab-icon" />
                            <p className="tab-text">Settings</p>
                            {updateAvailable && <span className="update-badge">1</span>}
                        </div>
                    </div>
                    <div className="sidebar-user">
                        <img draggable="false" className="user-avatar" src={account?.avatar_b64 || defaultPfp} alt={account?.name} />
                        <div className="user-info">
                            <p className="user-name">{account?.name}</p>
                            <p className="user-role">{account?.role}</p>
                        </div>
                        {accounts_loaded && accounts.length > 1 &&
                            <>
                                <div className="user-switch-account" onClick={openAccountSelect}>
                                    <div className="account-select__dash">
                                        {accounts.map((acc: any) => (
                                            <div className="sidebar-user" data-id={acc.id} key={acc.id} onClick={() => loginAccount(acc.id)}>
                                                <img draggable="false" className="user-avatar" src={acc.avatar_b64 || defaultPfp} alt={acc.name} />
                                                <div className="user-info">
                                                    <p className="user-name">{acc.name}</p>
                                                    <p className="user-role">{acc.role}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <ChevronDown className="user-switch-account-icon" />
                                </div>
                            </>
                        }
                    </div>
                    {isDev() && <p className="sidebar-dev" onClick={showDevPopup}>Dev Mode</p>}
                </div>
            </div>
        </>
    )
}

export default Sidebar