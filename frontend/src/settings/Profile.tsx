import '../styles/settings/Profile.css';
import api from '../modules/api';
import { useEffect, useState, useRef } from 'react';
import defaultPfp from '../assets/images/default-pfp-dark.svg';
import { Tooltip } from 'react-tooltip';
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Info, Pencil, Upload, X } from 'lucide-react';
import { getAccount } from '../modules/account';
import { useTranslation } from 'react-i18next';
import { createPopup, closePopup } from '../modules/PopupContext';
import { makeToast } from '@wokki20/jspt';

let cachedAccount: any = null;
let fetchPromise: Promise<any> | null = null;

async function loadAccount() {
    if (!fetchPromise) {
        fetchPromise = api("get_account", undefined, { account_id: "me" });
    }
    cachedAccount = await fetchPromise;
    return cachedAccount;
}

function parseDevice(userAgent: string | null, t: any): { name: string; browser: string } {
    if (!userAgent) return { name: t('settings.profile.device_unknown'), browser: t('settings.profile.browser_unknown') };

    let name = t('settings.profile.device_unknown');
    let browser = t('settings.profile.browser_unknown');

    const arch = /Win64|x64|WOW64/.test(userAgent) ? ' 64-bit' : /x86/.test(userAgent) ? ' 32-bit' : '';

    const winMatch = userAgent.match(/Windows NT (\d+\.\d+)/);
    if (winMatch) {
        const winVersion: Record<string, string> = {
            '10.0': 'Windows 10/11',
            '6.3': 'Windows 8.1',
            '6.2': 'Windows 8',
            '6.1': 'Windows 7',
            '6.0': 'Windows Vista',
            '5.1': 'Windows XP',
        };
        name = (winVersion[winMatch[1]] ?? `Windows NT ${winMatch[1]}`) + arch;
    } else if (/iPhone OS/.test(userAgent)) {
        const iosMatch = userAgent.match(/iPhone OS ([\d_]+)/);
        const ver = iosMatch ? ' (iOS ' + iosMatch[1].replace(/_/g, '.') + ')' : '';
        name = 'iPhone' + ver;
    } else if (/iPad/.test(userAgent)) {
        const iosMatch = userAgent.match(/CPU OS ([\d_]+)/);
        const ver = iosMatch ? ' (iPadOS ' + iosMatch[1].replace(/_/g, '.') + ')' : '';
        name = 'iPad' + ver;
    } else if (/Android/.test(userAgent)) {
        const deviceMatch = userAgent.match(/Android[\d. ]*;\s*([^)]+)\)/);
        const androidVerMatch = userAgent.match(/Android ([\d.]+)/);
        const ver = androidVerMatch ? ` (Android ${androidVerMatch[1]})` : '';
        name = deviceMatch ? deviceMatch[1].trim() + ver : 'Android Device' + ver;
    } else if (/Macintosh/.test(userAgent)) {
        const macMatch = userAgent.match(/Mac OS X ([\d_]+)/);
        const ver = macMatch ? ' (macOS ' + macMatch[1].replace(/_/g, '.') + ')' : '';
        name = 'Mac' + ver;
    } else if (/Linux/.test(userAgent)) {
        name = 'Linux' + arch;
    }

    const edgeMatch = userAgent.match(/Edg\/([\d.]+)/);
    const oprMatch = userAgent.match(/OPR\/([\d.]+)/);
    const chromeMatch = userAgent.match(/Chrome\/([\d.]+)/);
    const firefoxMatch = userAgent.match(/Firefox\/([\d.]+)/);
    const safariMatch = userAgent.match(/Version\/([\d.]+).*Safari/);

    if (edgeMatch) browser = `Edge ${edgeMatch[1].split('.')[0]}`;
    else if (oprMatch) browser = `Opera ${oprMatch[1].split('.')[0]}`;
    else if (chromeMatch) browser = `Chrome ${chromeMatch[1].split('.')[0]}`;
    else if (firefoxMatch) browser = `Firefox ${firefoxMatch[1].split('.')[0]}`;
    else if (safariMatch) browser = `Safari ${safariMatch[1].split('.')[0]}`;

    return { name, browser };
}

type SortKey = 'token' | 'device' | 'date' | 'protected' | 'revoked';

function Profile() {
    const [account, setAccount] = useState<any>(cachedAccount);
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
    const [deletingTokens, setDeletingTokens] = useState<Set<string>>(new Set());
    const [editing, setEditing] = useState(false);
    const [saving, setSaving ] = useState(false);

    const [editNickname, setEditNickname] = useState('');
    const [editAbout, setEditAbout] = useState('');
    const [editAvatar, setEditAvatar] = useState<string | null>(null);

    const avatarInputRef = useRef<HTMLInputElement>(null);

    const { t } = useTranslation();

    useEffect(() => {
        if (account) return;
        loadAccount().then(setAccount);
    }, []);

    const startEditing = () => {
        setEditNickname(account?.nickname || '');
        setEditAbout(account?.about || '');
        setEditAvatar(null);
        setEditing(true);
    };

    const cancelEditing = () => {
        setEditing(false);
        setEditAvatar(null);
    };

    const saveEditing = async () => {
        setSaving(true);
        try {
            const payload: Record<string, string | null> = {
                nickname: editNickname || '',
                about: editAbout || '',
            };
            if (editAvatar !== null) payload.avatar_b64 = editAvatar;
            const updated = await api("/accounts/" + account?.id, payload, undefined, true, false, 'PATCH') as object;
            cachedAccount = { ...cachedAccount, ...updated };
            setAccount(cachedAccount);
            setEditing(false);
            setEditAvatar(null);
        } finally {
            setSaving(false);
        }
    }

    const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => setEditAvatar(reader.result as string);
        reader.readAsDataURL(file);
    };

    const revokeToken = async (tokenStr: string) => {
        await api("/accounts/revoke", { token: tokenStr });
        cachedAccount = { ...cachedAccount, tokens: cachedAccount.tokens.map((t: any) => t.token === tokenStr ? { ...t, revoked: true } : t) };
        setAccount(cachedAccount);
    };

    const deleteToken = async (tokenStr: string) => {
        await api("/accounts/delete_token", { token: tokenStr });
        setDeletingTokens(prev => new Set(prev).add(tokenStr));
        setTimeout(() => {
            cachedAccount = { ...cachedAccount, tokens: cachedAccount.tokens.filter((t: any) => t.token !== tokenStr) };
            setAccount(cachedAccount);
            setDeletingTokens(prev => { const next = new Set(prev); next.delete(tokenStr); return next; });
        }, 1000);
    };

    const maskToken = (value: string): string => value.length > 8 ? `${value.slice(0, 4)}*****${value.slice(-4)}` : "*****";

    const checkToken = (masked: string): boolean => maskToken(String(getAccount())) === masked;

    const toggleSort = (key: SortKey) =>
        setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));

    const sortedTokens = account?.tokens.slice().sort((a: any, b: any) => {
        const dir = sort.dir === 'asc' ? 1 : -1;
        switch (sort.key) {
            case 'token': return a.token.localeCompare(b.token) * dir;
            case 'device': {
                const da = parseDevice(a.user_agent, t);
                const db = parseDevice(b.user_agent, t);
                return `${da.name} ${da.browser}`.localeCompare(`${db.name} ${db.browser}`) * dir;
            }
            case 'date': return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
            case 'protected': return (Number(a.password_protected) - Number(b.password_protected)) * dir;
            case 'revoked': return (Number(a.revoked) - Number(b.revoked)) * dir;
            default: return 0;
        }
    });

    function openChangePasswordPopup(password_protected: boolean, incorrect_current_password: boolean = false, something_wrong: boolean = false) {
        const formRef = { current_password: '', new_password: ''};
        
        function ChangePasswordPopup() {
            const [current_password, setCurrentPassword] = useState('');
            const [new_password, setNewPassword] = useState('');
            const [confirm_password, setConfirmPassword] = useState('');
            const [confirmPasswordError, setConfirmPasswordError] = useState(false);

            function handleCurrentPasswordChange(e: any) {
                setCurrentPassword(e.target.value);
                formRef.current_password = e.target.value;
            }

            function handleNewPasswordChange(e: any) {
                setNewPassword(e.target.value);
                formRef.new_password = e.target.value;
            }

            function handleConfirmPasswordChange(e: any) {
                setConfirmPassword(e.target.value);

                if (e.target.value !== new_password) {
                    setConfirmPasswordError(true);
                } else {
                    setConfirmPasswordError(false);
                }
            }

            return (
                <div className='change-password-popup-content'>
                    <h2 className='change-password-popup-title'>{password_protected ? t('settings.profile.password.popup.title.change') : t('settings.profile.password.popup.title.set')}</h2>
                    <p className='change-password-popup-text'>{t('settings.profile.password.popup.text')}</p>
                    <div className='change-password-popup-inputs'>
                        {password_protected && 
                            <>
                            <div className='change-password-popup-group'>
                                <p>{t('settings.profile.password.popup.text.current')}</p>
                                <input
                                    type='password'
                                    placeholder={t('settings.profile.password.popup.placeholder.current')}
                                    onChange={handleCurrentPasswordChange}
                                    value={current_password}
                                />
                            </div>
                            <div className='change-password-popup-separator' />
                            </>
                        }
                        <div className='change-password-popup-group'>
                            <p>{t('settings.profile.password.popup.text.new')}</p>
                            <input
                                type='password'
                                placeholder={t('settings.profile.password.popup.placeholder.new')}
                                onChange={handleNewPasswordChange}
                                value={new_password}
                            />
                        </div>
                        <div className='change-password-popup-group'>
                            <p>{t('settings.profile.password.popup.text.confirm')}</p>
                            <input
                                type='password'
                                placeholder={t('settings.profile.password.popup.placeholder.confirm')}
                                onChange={handleConfirmPasswordChange}
                                value={confirm_password}
                            />
                        </div>
                    </div>
                    {confirmPasswordError && 
                        <div className="change-password-popup-error">
                            <Info className='change-password-popup-error-icon' />
                            <p className='change-password-popup-error-text'>{t('settings.profile.password.popup.error.confirm')}</p>
                        </div>
                    }
                    {incorrect_current_password && 
                        <div className="change-password-popup-error">
                            <Info className='change-password-popup-error-icon' />
                            <p className='change-password-popup-error-text'>{t('settings.profile.password.popup.error.current')}</p>
                        </div>
                    }
                    {something_wrong && 
                        <div className="change-password-popup-error">
                            <Info className='change-password-popup-error-icon' />
                            <p className='change-password-popup-error-text'>{t('settings.profile.password.popup.error.wrong')}</p>
                        </div>
                    }
                </div>
            );
        }

        createPopup({
            id: 'change-password',
            title: password_protected ? t('settings.profile.password.popup.title.change') : t('settings.profile.password.popup.title.set'),
            close_button: true,
            mobileFullscreen: true,
            content: <ChangePasswordPopup />,
            buttons: [
                {
                    label: t('common.cancel'),
                    type: 'secondary',
                    onClick: () => closePopup('change-password'),
                },
                {
                    label: password_protected ? t('settings.profile.password.popup.submit.change') : t('settings.profile.password.popup.submit.set'),
                    type: 'primary',
                    onClick: async () => {
                        if (password_protected) {
                            await changePassword(formRef.current_password, formRef.new_password);
                        } else {
                            await setPassword(formRef.new_password);
                        }
                    },
                },
            ]
        })
    }


    const changePassword = async (current_password: string, new_password: string) => {
        const res = await api(`/accounts/${account?.id}`, { old_password: current_password, password: new_password }, undefined, false, false, 'PATCH');
        if (res === null) {
            openChangePasswordPopup(true, true, false);
        } else {
            closePopup('change-password');
            makeToast({ message: t('settings.profile.password.toast.changed'), style: "default", duration: 5000 });
        }
    }

    const setPassword = async (new_password: string) => {
        const res = await api(`/accounts/${account?.id}`, { password: new_password }, undefined, false, false, 'PATCH');
        if (res === null) {
            openChangePasswordPopup(false, false, true);
        } else {
            closePopup('change-password');
            makeToast({ message: t('settings.profile.password.toast.set'), style: "default", duration: 5000 });
        }
    }

    const handlePassword = () => {
        openChangePasswordPopup(account?.password_protected);
    }

    const displayAvatar = editAvatar ?? account?.avatar_b64 ?? defaultPfp;

    return (
        <>
            {!account && <div>{t('common.loading')}</div>}
            {account &&
                <div className='profile-section'>
                    <div className='profile-preview'>
                        <div className='profile-section-info'>
                            <div className='profile-avatar-wrapper' onClick={editing ? () => avatarInputRef.current?.click() : undefined} data-editing={editing}>
                                <img draggable="false" className="profile-section-avatar" src={displayAvatar} alt={account?.name} />
                                
                                {editing && <div className='profile-avatar-overlay'><Upload className='profile-avatar-overlay-icon' /></div>}
                            </div>
                            <input 
                                ref={avatarInputRef}
                                type="file"
                                accept="image/*"
                                style={{ display: 'none' }}
                                onChange={handleAvatarChange}
                            />
                            {editing 
                                ? <input
                                    className='profile-edit-nickname'
                                    value={editNickname}
                                    onChange={e => setEditNickname(e.target.value)}
                                    placeholder={t('settings.profile.nickname.placeholder')}
                                    maxLength={64}
                                />
                                : <div className='profile-section-info-nickname'>{account.nickname || account.name}</div>
                            }
                            <div className='profile-section-info-name'>@{account.name}</div>
                        </div>
                        <div className='profile-section-about'>
                            <p className='profile-section-about-title'>{t('settings.profile.about')}</p>
                            <div className='profile-section-about-pills'>
                                <Tooltip id="pill-tooltip" />
                                <span className='profile-section-about-pill' data-tooltip-id="pill-tooltip" data-tooltip-content={t('settings.profile.role.tooltip')}>{account?.role}</span>
                                <span className='profile-section-about-pill' data-tooltip-id="pill-tooltip" data-tooltip-content={t('settings.profile.created.tooltip')}>{account?.created_at && new Date(account.created_at).toLocaleDateString(undefined, {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                })}</span>
                            </div>
                            {editing 
                                ? <textarea
                                    className='profile-edit-bio'
                                    value={editAbout}
                                    onChange={e => setEditAbout(e.target.value)}
                                    placeholder={t('settings.profile.about.placeholder')}
                                    maxLength={300}
                                    rows={4}
                                />
                                : <p className={'profile-section-about-bio' + (account?.about ? "" : " empty")}>{account?.about || t('settings.profile.nobio')}</p>
                            }
                        </div>
                        <div className='profile-section-edit-buttons'>
                            {!editing 
                                ? <button className='profile-section-edit-button' onClick={startEditing}><Pencil className='profile-section-edit-icon' /></button>
                                : <>
                                    <button className='profile-section-edit-button cancel' onClick={cancelEditing}><X className='profile-section-edit-icon' /></button>
                                    <button className='profile-section-edit-button save' onClick={saveEditing}><Check className='profile-section-edit-icon' /></button>
                                </>
                            }
                        </div>
                    </div>
                    <div className='profile-security'>
                        <p className='profile-security-title'>{t('settings.profile.security')}</p>
                        <div className='profile-security-password'>
                            <div className="profile-security-password-title-text">
                                <p className='profile-security-password-title'>{t('settings.profile.password')}</p>
                                <p className='profile-security-password-text'>{t('settings.profile.password.text')}</p>
                            </div>
                            <button className='profile-security-password-button' onClick={handlePassword}>{account?.password_protected ? t('settings.profile.password.change') : t('settings.profile.password.set')}</button>
                        </div>
                    </div>
                    <div className='profile-tokens'>
                        <p className='profile-tokens-title'>{t('settings.profile.logins')}</p>
                        <table className='profile-tokens-table'>
                            <thead>
                                <tr>
                                    {(['token', 'device', 'date', 'protected', 'revoked'] as SortKey[]).map(col => (
                                        <th key={col} className='profile-tokens-th' onClick={() => toggleSort(col)}>
                                            <span>{col.charAt(0).toUpperCase() + col.slice(1)}</span>
                                            {sort.key === col ? (sort.dir === 'asc' ? <ArrowUp className='sort-icon' /> : <ArrowDown className='sort-icon' />) : <ArrowUpDown className='sort-icon' />}
                                        </th>
                                    ))}
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedTokens?.map((token: any) => {
                                    const device = parseDevice(token.user_agent, t);
                                    const isDeleting = deletingTokens.has(token.token);
                                    return (
                                        <tr key={token.token}>
                                            <td className='profile-tokens-token'>{token.token}</td>
                                            <td className='profile-tokens-device'>
                                                <div className='profile-tokens-device-info'>
                                                    <span className='profile-tokens-device-name'>{device.name} · {device.browser}</span>
                                                    <span className='profile-tokens-device-ip'>{token.ip_address ?? 'No IP'}</span>
                                                </div>
                                                {checkToken(token.token) && <span className='profile-tokens-this-device'>{t('settings.profile.logins.this_device')}</span>}
                                            </td>
                                            <td className='profile-tokens-date'>
                                                {new Date(token.created_at).toLocaleDateString(undefined, {
                                                    year: 'numeric',
                                                    month: 'short',
                                                    day: 'numeric',
                                                })}
                                            </td>
                                            <td>{token.password_protected ? t('common.yes') : t('common.no')}</td>
                                            <td>{token.revoked ? t('common.yes') : t('common.no')}</td>
                                            <td className='profile-tokens-revoke-cell'>
                                                <button
                                                    className={'profile-tokens-revoke' + (isDeleting ? ' deleted' : token.revoked ? ' delete' : '')}
                                                    disabled={isDeleting}
                                                    onClick={token.revoked && !isDeleting ? () => deleteToken(token.token) : !token.revoked ? () => revokeToken(token.token) : undefined}
                                                >
                                                    {isDeleting ? t('common.deleted') : token.revoked ? t('common.delete') : t('common.revoke')}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            }
        </>
    );
}

export default Profile;