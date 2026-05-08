import '../styles/settings/Profile.css';
import api from '../modules/api';
import { useEffect, useState } from 'react';
import defaultPfp from '../assets/images/default-pfp-dark.svg';
import { Tooltip } from 'react-tooltip';

let cachedAccount: any = null;
let fetchPromise: Promise<any> | null = null;

async function loadAccount() {
    if (cachedAccount) return cachedAccount;
    if (!fetchPromise) {
        fetchPromise = api("get_account", undefined, { account_id: "me" });
    }
    cachedAccount = await fetchPromise;
    return cachedAccount;
}

function parseDevice(userAgent: string | null): { name: string; browser: string } {
    if (!userAgent) return { name: 'Unknown Device', browser: 'Unknown Browser' };

    let name = 'Unknown Device';
    let browser = 'Unknown Browser';

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

    useEffect(() => {
        if (account) return;
        loadAccount().then(setAccount);
    }, []);

    const revokeToken = async (tokenStr: string) => {
        await api("/accounts/revoke", { token: tokenStr });
        cachedAccount = { ...cachedAccount, tokens: cachedAccount.tokens.map((t: any) => t.token === tokenStr ? { ...t, revoked: true } : t) };
        setAccount(cachedAccount);
    };

    const toggleSort = (key: SortKey) =>
        setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));

    const sortedTokens = account?.tokens.slice().sort((a: any, b: any) => {
        const dir = sort.dir === 'asc' ? 1 : -1;
        switch (sort.key) {
            case 'token': return a.token.localeCompare(b.token) * dir;
            case 'device': {
                const da = parseDevice(a.user_agent);
                const db = parseDevice(b.user_agent);
                return `${da.name} ${da.browser}`.localeCompare(`${db.name} ${db.browser}`) * dir;
            }
            case 'date': return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
            case 'protected': return (Number(a.password_protected) - Number(b.password_protected)) * dir;
            case 'revoked': return (Number(a.revoked) - Number(b.revoked)) * dir;
            default: return 0;
        }
    });

    return (
        <>
            {!account && <div>Loading...</div>}
            {account &&
                <div className='profile-section'>
                    <div className='profile-preview'>
                        <div className='profile-section-info'>
                            <img draggable="false" className="profile-section-avatar" src={account?.avatar_b64 || defaultPfp} alt={account?.name} />
                            <div className='profile-section-info-nickname'>{account.nickname || account.name}</div>
                            <div className='profile-section-info-name'>@{account.name}</div>
                        </div>
                        <div className='profile-section-about'>
                            <p className='profile-section-about-title'>About Me</p>
                            <div className='profile-section-about-pills'>
                                <Tooltip id="pill-tooltip" />
                                <span className='profile-section-about-pill' data-tooltip-id="pill-tooltip" data-tooltip-content="This is your role on OmniPlayr">{account?.role}</span>
                                <span className='profile-section-about-pill' data-tooltip-id="pill-tooltip" data-tooltip-content="This is when you created your account">{account?.created_at && new Date(account.created_at).toLocaleDateString(undefined, {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                })}</span>
                            </div>
                            <p className={'profile-section-about-bio' + (account?.about ? "" : " empty")}>{account?.about || "No bio set"}</p>
                        </div>
                    </div>
                    <div className='profile-tokens'>
                        <p className='profile-tokens-title'>Logins</p>
                        <table className='profile-tokens-table'>
                            <thead>
                                <tr>
                                    {(['token', 'device', 'date', 'protected', 'revoked'] as SortKey[]).map(col => (
                                        <th key={col} className='profile-tokens-th' onClick={() => toggleSort(col)}>
                                            {col.charAt(0).toUpperCase() + col.slice(1)}
                                            <span className='profile-tokens-sort-icon'>
                                                {sort.key === col ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
                                            </span>
                                        </th>
                                    ))}
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedTokens?.map((token: any) => {
                                    const device = parseDevice(token.user_agent);
                                    return (
                                        <tr key={token.token}>
                                            <td className='profile-tokens-token'>{token.token}</td>
                                            <td className='profile-tokens-device'>
                                                <span className='profile-tokens-device-name'>{device.name} · {device.browser}</span>
                                                <span className='profile-tokens-device-ip'>{token.ip_address ?? 'No IP'}</span>
                                            </td>
                                            <td className='profile-tokens-date'>
                                                {new Date(token.created_at).toLocaleDateString(undefined, {
                                                    year: 'numeric',
                                                    month: 'short',
                                                    day: 'numeric',
                                                })}
                                            </td>
                                            <td>{token.password_protected ? 'Yes' : 'No'}</td>
                                            <td>{token.revoked ? 'Yes' : 'No'}</td>
                                            <td className='profile-tokens-revoke-cell'>
                                                <button
                                                    className={'profile-tokens-revoke' + (token.revoked ? ' revoked' : '')}
                                                    disabled={token.revoked}
                                                    onClick={() => revokeToken(token.token)}
                                                >
                                                    {token.revoked ? 'Revoked' : 'Revoke'}
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