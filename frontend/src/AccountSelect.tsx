import React, { useEffect, useState, useRef, Fragment } from "react";
import api from "./modules/api";
import "./styles/AccountSelect.css";
import defaultPfp from "./assets/images/default-pfp-dark.svg";
import { storeAccount } from "./modules/account";
import { useTranslation } from "react-i18next";

import { ArrowRightToLine, X } from "lucide-react";
import { makeToast } from "@wokki20/jspt";

async function loadAccounts() {
    return await api("get_accounts") as any[];
}

function AccountSelect({ onAccountSelected }: { onAccountSelected: (id: string) => void }) {
    const [accounts, setAccounts] = useState<any[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [fadingOut, setFadingOut] = useState(false);

    const [openPasswordPopup, setPasswordPopup] = useState<boolean>(false);
    const [password, setPassword] = useState('');
    const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

    const [openTwoFaPopup, setTwoFaPopup] = useState<boolean>(false);
    const response_2fa_ref = useRef<{ code: string }>({ code: '' });

    function handlePasswordChange(e: any) {
        setPassword(e.target.value);
    }

    function handlePasswordKeyDown(e: any) {
        if (e.key === 'Enter') {
            loginWithPassword();
        }
    }

    function closePasswordPopup() {
        setPasswordPopup(false);
        setSelected(null);
        setPassword('');
    }

    function closeTwoFaPopup() {
        setTwoFaPopup(false);
        setSelected(null);
        response_2fa_ref.current.code = '';
    }

    function handleCodeChange(e: React.ChangeEvent<HTMLInputElement>, index: number) {
        const value = e.target.value.replace(/\D/g, '').slice(-1);
        const inputs = Array.from(
            document.querySelectorAll<HTMLInputElement>('.check-2fa-code-popup-input')
        );
        inputs[index].value = value;
        const code = inputs.map(input => input.value).join('');
        response_2fa_ref.current.code = code;
        if (value && index < inputs.length - 1) {
            inputs[index + 1].focus();
        }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
        const inputs = Array.from(
            document.querySelectorAll<HTMLInputElement>('.check-2fa-code-popup-input')
        );
        if (e.key === 'Backspace' && !inputs[index].value && index > 0) {
            inputs[index - 1].focus();
        }
        if (e.key === 'Enter' && index === inputs.length - 1) {
            loginWithCode();
        }
    }

    function handleCodePaste(e: React.ClipboardEvent<HTMLInputElement>, index: number) {
        const inputs = Array.from(
            document.querySelectorAll<HTMLInputElement>('.check-2fa-code-popup-input')
        );
        const digits = e.clipboardData.getData('text').replace(/\D/g, '');
        if (!digits) return;

        e.preventDefault();
        const startIndex = digits.length >= inputs.length ? 0 : index;
        digits.slice(0, inputs.length - startIndex).split('').forEach((digit, offset) => {
            inputs[startIndex + offset].value = digit;
        });
        response_2fa_ref.current.code = inputs.map(input => input.value).join('');
        inputs[Math.min(startIndex + digits.length, inputs.length - 1)].focus();
    }

    async function loginWithPassword() {
        if (twoFactorEnabled) {
            try {
                const response = await api("/accounts/verify_password", { user_id: selected, password: password });
                if (response === "no_match") {
                    makeToast({
                        message: t('login.error.wrong-password'),
                        style: 'default-error',
                        icon_left: 'circle-x',
                        icon_left_type: 'lucide_icon',
                        duration: 5000
                    })
                    return;
                }
            } catch (err: any) {
                const status = err?.status ?? err?.response?.status;
                if (status === 401 || status === 403) {
                    makeToast({
                        message: t('login.error.wrong-password'),
                        style: 'default-error',
                        icon_left: 'circle-x',
                        icon_left_type: 'lucide_icon',
                        duration: 5000
                    })
                    return;
                }
                return;
            }
            setPasswordPopup(false);
            setTwoFaPopup(true);
            return;
        }

        const data = await api("/accounts/login", { user_id: selected, password: password }) as any;
        storeAccount(data?.token);
        window.history.pushState({}, '', '/');
        window.dispatchEvent(new Event('account-switched'));
        setPasswordPopup(false);
    }

    async function loginWithCode() {
        const data = await api("/accounts/login", { user_id: selected, password: password, twofa_code: response_2fa_ref.current.code }) as any;
        if (!data?.token) {
            makeToast({ message: t('login.error.wrong-code'), style: 'default-error', icon_left: 'circle-x', icon_left_type: 'lucide_icon', duration: 5000 });
            return;
        }
        storeAccount(data?.token);
        setPassword('');
        window.history.pushState({}, '', '/');
        window.dispatchEvent(new Event('account-switched'));
        setTwoFaPopup(false);
    }

    const { t } = useTranslation();

    useEffect(() => {
        loadAccounts()
            .then(fetched => {
                setAccounts(fetched);
                setTimeout(() => setLoaded(true), 50);
            })
            .catch((err: any) => {
                const status = err?.status ?? err?.response?.status;
                if (status === 401 || status === 403) {
                    window.location.href = '/login';
                    makeToast({
                        message: t('login.error.wrong-password'),
                        style: 'default-error',
                        icon_left: 'circle-x',
                        icon_left_type: 'lucide_icon',
                        duration: 5000
                    })
                }
            });
    }, []);

    const loadAccount = async (id: string, password_protected: boolean, two_factor_enabled: boolean) => {
        setSelected(id);
        setTwoFactorEnabled(two_factor_enabled);

        if (password_protected) {
            setPasswordPopup(true);
            return;
        }

        try {
            await loginAccount(id);
        } catch (err: any) {
            const status = err?.status ?? err?.response?.status;
            if (status === 401 || status === 403) {
                window.location.href = '/login';
                return;
            }
            setSelected(null);
            return;
        }
        setFadingOut(true);
        setTimeout(() => {
            onAccountSelected(id);
        }, 600);
    };

    async function loginAccount(id: string) {
        const tokenInfo = await api("/accounts/login", { user_id: id }) as any;
        storeAccount(tokenInfo?.token);
    }

    return (
        <>
            <div className={`account-select ${loaded ? "active" : ""} ${fadingOut ? "fading-out" : ""}`} style={{ pointerEvents: selected ? "none" : "auto" }}>
                <h1>{t('accountSelect.title')}</h1>
                <div className="account-select-options">
                    {accounts.map((a, i) => (
                        <div
                            key={a.id}
                            className={`account-select-option ${selected === a.id ? "loading" : ""}`}
                            style={{ "--i": i } as any}
                            data-id={a.id}
                            onClick={() => loadAccount(a.id, a.password_protected, a.two_factor_enabled)}
                        >
                            <img src={a.avatar_b64 || defaultPfp} alt={a.name} />
                            <span>{a.nickname || a.name}</span>
                        </div>
                    ))}
                </div>
            </div>
            { openPasswordPopup &&
                <div className='password-overlay'>
                    <div className='password-overlay-content'>
                        <div className='password-overlay-title'>{t('login.password.popup.title')}</div>
                        <div className='password-overlay-text'>{t('login.password.popup.text')}</div>
                        <div className="password-overlay-input-container">
                            <input type="password" className="password-overlay-input" placeholder={t('login.password.popup.placeholder')} value={password} onChange={handlePasswordChange} onKeyDown={handlePasswordKeyDown} autoFocus />
                            <button className="password-overlay-button" onClick={loginWithPassword}><ArrowRightToLine className="password-overlay-button-icon" /></button>
                        </div>
                    </div>
                    <X className='password-overlay-close' onClick={closePasswordPopup} />
                </div>
            }
            { openTwoFaPopup &&
                <div className='check-2fa-overlay'>
                    <div className='check-2fa-overlay-content'>
                        <div className='check-2fa-overlay-title'>{t('login.2fa.popup.title')}</div>
                        <div className='check-2fa-overlay-text'>{t('login.2fa.popup.text')}</div>
                        <div className="check-2fa-popup-code-group">
                            {[0, 1, 2, 3, 4, 5].map((index) => (
                                <Fragment key={index}>
                                    {index === 3 && <div className='check-2fa-code-popup-spacer'></div>}
                                    <input
                                        type='text'
                                        inputMode='numeric'
                                        maxLength={1}
                                        placeholder={`${index + 1}`}
                                        className='check-2fa-code-popup-input'
                                        onChange={(e) => handleCodeChange(e, index)}
                                        onKeyDown={(e) => handleKeyDown(e, index)}
                                        onPaste={(e) => handleCodePaste(e, index)}
                                    />
                                </Fragment>
                            ))}
                            <div className='check-2fa-code-popup-spacer'></div>
                            <button className="check-2fa-popup-button" onClick={loginWithCode}><ArrowRightToLine className="check-2fa-popup-button-icon" /></button>
                        </div>
                    </div>
                    <X className='check-2fa-overlay-close' onClick={closeTwoFaPopup} />
                </div>
            }
        </>
    );
}

export default AccountSelect;
