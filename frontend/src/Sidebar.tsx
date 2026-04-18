import './styles/Sidebar.css';
import defaultPfp from "./assets/images/default-pfp-dark.svg";
import { Plus, Settings, House, ChevronDown } from 'lucide-react';
import { isDev } from './modules/dev';
import api from './modules/api';
import { useEffect, useState } from 'react';
import { useSearchParams } from "react-router-dom";
import { storeAccount } from './modules/account';
import { usePlugins } from './modules/usePlugins';
import { getTabs, type PluginTab } from './modules/plugins';

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
}

function Sidebar({ account, activeTabId, onTabChange, isOpen, onClose }: SidebarProps) {
    const [accounts, setAccounts] = useState<any[]>([]);
    const [accounts_loaded, setAccountsLoaded] = useState(false);
    const [, setSearchParams] = useSearchParams();
    const [tabs, setTabs] = useState<PluginTab[]>([]);
    usePlugins();

    function loadAccount(id: string) {
        storeAccount(id);
        setSearchParams({ account_id: id });
    }

    useEffect(() => {
        loadAccounts().then(fetched => {
            setAccounts(fetched);
            setTimeout(() => setAccountsLoaded(true), 50);
        });
    }, []);

    useEffect(() => {
        setTabs(getTabs());
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
                        <div className={`sidebar-tab${activeTabId === "__settings" ? ' active' : ''}`} onClick={() => handleTabChange("__settings")}>
                            <Settings className="tab-icon" />
                            <p className="tab-text">Settings</p>
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
                                            <div className="sidebar-user" data-id={acc.id} key={acc.id} onClick={() => loadAccount(acc.id)}>
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
                    {isDev() && <p className="sidebar-dev">Dev Mode</p>}
                </div>
            </div>
        </>
    )
}

export default Sidebar