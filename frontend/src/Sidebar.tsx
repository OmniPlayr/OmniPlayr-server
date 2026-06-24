import './styles/Sidebar.css';
import defaultPfp from "./assets/images/default-pfp-dark.svg";
import { Settings, House, ChevronDown, ArrowRightToLine, X } from 'lucide-react';
import { isDev } from './modules/dev';
import api from './modules/api';
import { Fragment, useEffect, useRef, useState } from 'react';
import { storeAccount } from './modules/account';
import { usePlugins } from './modules/usePlugins';
import { getTabs, onPluginsLoaded, type PluginTab } from './modules/plugins';
import { createPopup } from './modules/PopupContext';
import { makeToast } from '@wokki20/jspt';

import { useTranslation } from 'react-i18next';

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
    settingsBadgeCount?: number;
}

function showDevPopup() {
    createPopup({
        id: "dev-mode",
        title: "Developer Mode",
        close_button: true,
        content: (
            <div className="dev-popup">
                <h2 className="dev-popup-title">About Developer Mode</h2>
                <p>Developer mode enables additional debugging tools and verbose logging throughout the application.</p>

                <h3>Performance impact</h3>
                <p>Because of the extra logging and instrumentation, <strong>your server may run slower</strong> than usual. Opening the log page in particular can also <strong>slow down your device</strong>, especially when a lot of log entries have accumulated.</p>

                <h3>Stability</h3>
                <p>This is a development build and it <strong>may be unstable</strong>. Bugs can and likely will appear. If you run into anything, please report it on <a href="https://github.com/OmniPlayr/OmniPlayr-server/issues" className="link" target="_blank" rel="noreferrer">GitHub</a>.</p>
                <p>There is <strong>no warranty</strong> of any kind. For license details, go to <strong>Settings &gt; About</strong>. OmniPlayr is released under the MIT license.</p>

                <h3>Live updates</h3>
                <p>The frontend will <strong>hot-reload automatically</strong> when changes are made in the source, no manual refresh needed.</p>

                <h3>Contributing</h3>
                <p>Want to contribute? Make sure to read the <a href="https://omniplayr.wokki20.nl/legal/cla" className="link" target="_blank" rel="noreferrer">Contributor License Agreement</a> and the <a href="https://omniplayr.wokki20.nl/legal/code-of-conduct" className="link" target="_blank" rel="noreferrer">Code of Conduct</a> before submitting anything.</p>
            </div>
        ),
    });
}

function Sidebar({ account, activeTabId, onTabChange, isOpen, onClose, settingsBadgeCount }: SidebarProps) {
    const [accounts, setAccounts] = useState<any[]>([]);
    const [accounts_loaded, setAccountsLoaded] = useState(false);
    const [tabs, setTabs] = useState<PluginTab[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
    const [password, setPassword] = useState('');
    const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
    const [openPasswordPopup, setPasswordPopup] = useState(false);
    const [openTwoFaPopup, setTwoFaPopup] = useState(false);
    const [usingBackupCode, setUsingBackupCode] = useState(false);
    const twoFaInputsRef = useRef<HTMLDivElement>(null);
    const twoFaCodeRef = useRef('');
    const backupCodeRef = useRef('');

    const { t } = useTranslation();

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

    function showLoginError(message: string) {
        makeToast({
            message,
            style: 'default-error',
            icon_left: 'circle-x',
            icon_left_type: 'lucide_icon',
            duration: 5000
        });
    }

    function closePasswordPopup() {
        setPasswordPopup(false);
        setSelectedAccountId(null);
        setPassword('');
    }

    function closeTwoFaPopup() {
        setTwoFaPopup(false);
        setSelectedAccountId(null);
        setPassword('');
        setUsingBackupCode(false);
        twoFaCodeRef.current = '';
        backupCodeRef.current = '';
    }

    function useBackupCode() {
        setUsingBackupCode(true);
        twoFaCodeRef.current = '';
    }

    function getTwoFaInputs() {
        return Array.from(
            twoFaInputsRef.current?.querySelectorAll<HTMLInputElement>('.check-2fa-code-popup-input') ?? []
        );
    }

    function handleCodeChange(e: React.ChangeEvent<HTMLInputElement>, index: number) {
        const inputs = getTwoFaInputs();
        const value = e.target.value.replace(/\D/g, '').slice(-1);
        inputs[index].value = value;
        twoFaCodeRef.current = inputs.map(input => input.value).join('');

        if (value && index < inputs.length - 1) {
            inputs[index + 1].focus();
        }
    }

    function handleCodeKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
        const inputs = getTwoFaInputs();
        if (e.key === 'Backspace' && !inputs[index].value && index > 0) {
            inputs[index - 1].focus();
        }
        if (e.key === 'Enter' && index === inputs.length - 1) {
            loginWithCode();
        }
    }

    function handleCodePaste(e: React.ClipboardEvent<HTMLInputElement>, index: number) {
        const inputs = getTwoFaInputs();
        const digits = e.clipboardData.getData('text').replace(/\D/g, '');
        if (!digits) return;

        e.preventDefault();
        const startIndex = digits.length >= inputs.length ? 0 : index;
        digits.slice(0, inputs.length - startIndex).split('').forEach((digit, offset) => {
            inputs[startIndex + offset].value = digit;
        });
        twoFaCodeRef.current = inputs.map(input => input.value).join('');
        inputs[Math.min(startIndex + digits.length, inputs.length - 1)].focus();
    }

    function handleBackupCodeKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') {
            loginWithCode();
        }
    }

    function finishLogin(token: string) {
        storeAccount(token);
        window.history.pushState({}, '', '/');
        window.dispatchEvent(new Event('account-switched'));
    }

    async function loginWithPassword() {
        if (twoFactorEnabled) {
            try {
                const response = await api('/accounts/verify_password', { user_id: selectedAccountId, password });
                if (response === 'no_match') {
                    showLoginError(t('login.error.wrong-password'));
                    return;
                }
            } catch (err: any) {
                const status = err?.status ?? err?.response?.status;
                if (status === 401 || status === 403) {
                    showLoginError(t('login.error.wrong-password'));
                }
                return;
            }

            setPasswordPopup(false);
            setUsingBackupCode(false);
            twoFaCodeRef.current = '';
            backupCodeRef.current = '';
            setTwoFaPopup(true);
            return;
        }

        try {
            const data = await api('/accounts/login', { user_id: selectedAccountId, password }) as any;
            if (!data?.token) {
                showLoginError(t('login.error.wrong-password'));
                return;
            }
            finishLogin(data.token);
            setPasswordPopup(false);
            setPassword('');
        } catch (err: any) {
            const status = err?.status ?? err?.response?.status;
            if (status === 401 || status === 403) {
                showLoginError(t('login.error.wrong-password'));
            }
        }
    }

    async function loginWithCode() {
        try {
            const data = await api('/accounts/login', {
                user_id: selectedAccountId,
                password,
                ...(usingBackupCode
                    ? { backup_code: backupCodeRef.current }
                    : { twofa_code: twoFaCodeRef.current })
            }) as any;
            if (!data?.token) {
                showLoginError(t('login.error.wrong-code'));
                return;
            }
            finishLogin(data.token);
            closeTwoFaPopup();
        } catch {
            showLoginError(t('login.error.wrong-code'));
        }
    }

    async function loginAccount(id: string, password_protected: boolean, two_factor_enabled: boolean) {
        if (password_protected) {
            setSelectedAccountId(id);
            setTwoFactorEnabled(two_factor_enabled);
            setPasswordPopup(true);
            return;
        }
        const tokenInfo = await api("/accounts/login", { user_id: id }) as any;
        finishLogin(tokenInfo?.token);
    }

    return (
        <>
            {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
            <div className={`sidebar${isOpen ? " sidebar--open" : ""}`} data-component="Sidebar">
                <div className="sidebar-header">
                    <p className="sidebar-title">{t("system_name")}</p>
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
                            <p className="tab-text">{t("sidebar.tab.home")}</p>
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
                            <p className="tab-text">{t("sidebar.tab.settings")}</p>
                            {(settingsBadgeCount ?? 0) > 0 && (
                                <span className="update-badge">
                                    {(settingsBadgeCount ?? 0) > 9 ? "9+" : settingsBadgeCount}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="sidebar-user">
                        <img draggable="false" className="user-avatar" src={account?.avatar_b64 || defaultPfp} alt={account?.name} />
                        <div className="user-info">
                            <p className="user-nickname">{account?.nickname || account?.name}</p>
                            <p className="user-name">@{account?.name}</p>
                        </div>
                        {accounts_loaded && accounts.length > 1 &&
                            <>
                                <div className="user-switch-account" onClick={openAccountSelect}>
                                    <div className="account-select__dash">
                                        {accounts.map((acc: any) => (
                                            <div className="sidebar-user" data-id={acc.id} key={acc.id} onClick={() => loginAccount(acc.id, acc?.password_protected, acc?.two_factor_enabled)}>
                                                <img draggable="false" className="user-avatar" src={acc.avatar_b64 || defaultPfp} alt={acc.name} />
                                                <div className="user-info">
                                                    <p className="user-nickname">{acc.nickname || acc.name}</p>
                                                    <p className="user-name">@{acc.name}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <ChevronDown className="user-switch-account-icon" />
                                </div>
                            </>
                        }
                    </div>
                    {isDev() && <p className="sidebar-dev" onClick={showDevPopup}>{t("sidebar.devmode")}</p>}
                </div>
            </div>
            {openPasswordPopup && (
                <div className="password-overlay">
                    <div className="password-overlay-content">
                        <div className="password-overlay-title">{t('login.password.popup.title')}</div>
                        <div className="password-overlay-text">{t('login.password.popup.text')}</div>
                        <div className="password-overlay-input-container">
                            <input
                                type="password"
                                className="password-overlay-input"
                                placeholder={t('login.password.popup.placeholder')}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && loginWithPassword()}
                                autoFocus
                                autoComplete='current-password'
                                id="user-password"
                                name="user-password"
                            />
                            <button className="password-overlay-button" onClick={loginWithPassword}>
                                <ArrowRightToLine className="password-overlay-button-icon" />
                            </button>
                        </div>
                    </div>
                    <X className="password-overlay-close" onClick={closePasswordPopup} />
                </div>
            )}
            {openTwoFaPopup && (
                <div className="check-2fa-overlay">
                    <div className="check-2fa-overlay-content">
                        <div className="check-2fa-overlay-title">{t('login.2fa.popup.title')}</div>
                        <div className="check-2fa-overlay-text">{usingBackupCode ? t('login.2fa.popup.backup-text') : t('login.2fa.popup.text')}</div>
                        {usingBackupCode ? (
                            <div className="check-2fa-popup-backup-group">
                                <input
                                    type="text"
                                    className="check-2fa-backup-popup-input"
                                    placeholder={t('login.2fa.popup.backup-placeholder')}
                                    onChange={(e) => { backupCodeRef.current = e.target.value; }}
                                    onKeyDown={handleBackupCodeKeyDown}
                                    autoFocus
                                />
                                <button className="check-2fa-popup-button" onClick={loginWithCode}>
                                    <ArrowRightToLine className="check-2fa-popup-button-icon" />
                                </button>
                            </div>
                        ) : (
                            <>
                                <div className="check-2fa-popup-code-group" ref={twoFaInputsRef}>
                                    {[0, 1, 2, 3, 4, 5].map((index) => (
                                        <Fragment key={index}>
                                            {index === 3 && <div className="check-2fa-code-popup-spacer" />}
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                maxLength={1}
                                                placeholder={`${index + 1}`}
                                                className="check-2fa-code-popup-input"
                                                onChange={(e) => handleCodeChange(e, index)}
                                                onKeyDown={(e) => handleCodeKeyDown(e, index)}
                                                onPaste={(e) => handleCodePaste(e, index)}
                                                autoFocus={index === 0}
                                            />
                                        </Fragment>
                                    ))}
                                    <div className="check-2fa-code-popup-spacer" />
                                    <button className="check-2fa-popup-button" onClick={loginWithCode}>
                                        <ArrowRightToLine className="check-2fa-popup-button-icon" />
                                    </button>
                                </div>
                                <p className="check-2fa-overlay-use-backup" onClick={useBackupCode}>{t('login.2fa.popup.use-backup')}</p>
                            </>
                        )}
                    </div>
                    <X className="check-2fa-overlay-close" onClick={closeTwoFaPopup} />
                </div>
            )}
        </>
    )
}

export default Sidebar
