import React, { useEffect, useState } from "react";
import api from "./modules/api";
import "./styles/AccountSelect.css";
import defaultPfp from "./assets/images/default-pfp-dark.svg";
import { storeAccount } from "./modules/account";
import { useTranslation } from "react-i18next";

import { createPopup, closePopup } from "./modules/PopupContext";

async function loadAccounts() {
    return await api("get_accounts") as any[];
}

function AccountSelect({ onAccountSelected }: { onAccountSelected: (id: string) => void }) {
    const [accounts, setAccounts] = useState<any[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [fadingOut, setFadingOut] = useState(false);

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
                }
            });
    }, []);

    const loadAccount = async (id: string, password_protected: boolean) => {
        setSelected(id);
        try {
            await loginAccount(id, password_protected);
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

    function loginAccountPassword(id: string) {
        return new Promise<void>((resolve, reject) => {
            const formRef = { password: '' };

            function PasswordPopup() {
                const [password, setPassword] = useState('');

                function handlePasswordChange(e: any) {
                    setPassword(e.target.value);
                    formRef.password = e.target.value;
                }

                return (
                    <div className='enter-password-popup-content'>
                        <div className='enter-password-popup-title'>{t('login.password.popup.title')}</div>
                        <div className='enter-password-popup-text'>{t('login.password.popup.text')}</div>
                        <input type="password" placeholder={t('login.password.popup.placeholder')} value={password} onChange={handlePasswordChange} />
                    </div>
                );
            }

            createPopup({
                id: "enter-password",
                title: t('login.password.popup.title'),
                close_button: true,
                content: <PasswordPopup />,
                onClose: () => setSelected(null),
                buttons: [
                    {
                        label: t('common.cancel'),
                        type: 'secondary',
                        onClick: () => {
                            closePopup('enter-password');
                            reject(new Error('cancelled'));
                        }
                    },
                    {
                        label: t('login.password.popup.button'),
                        type: 'primary',
                        onClick: async () => {
                            try {
                                const data = await api("/accounts/login", { user_id: id, password: formRef.password }) as any;
                                storeAccount(data?.token);
                                window.history.pushState({}, '', '/');
                                window.dispatchEvent(new Event('account-switched'));
                                closePopup('enter-password');
                                resolve();
                            } catch (err) {
                                reject(err);
                            }
                        }
                    }
                ]
            });
        });
    }

    async function loginAccount(id: string, password_protected: boolean) {
        if (password_protected) {
            await loginAccountPassword(id);
            return;
        }
        const tokenInfo = await api("/accounts/login", { user_id: id }) as any;
        storeAccount(tokenInfo?.token);
    }

    return (
        <div className={`account-select ${loaded ? "active" : ""} ${fadingOut ? "fading-out" : ""}`} style={{ pointerEvents: selected ? "none" : "auto" }}>
            <h1>{t('accountSelect.title')}</h1>
            <div className="account-select-options">
                {accounts.map((a, i) => (
                    <div
                        key={a.id}
                        className={`account-select-option ${selected === a.id ? "loading" : ""}`}
                        style={{ "--i": i } as any}
                        data-id={a.id}
                        onClick={() => loadAccount(a.id, a.password_protected)}
                    >
                        <img src={a.avatar_b64 || defaultPfp} alt={a.name} />
                        <span>{a.nickname || a.name}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default AccountSelect;