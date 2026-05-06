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

function Profile() {
    const [account, setAccount] = useState<any>(cachedAccount);

    useEffect(() => {
        if (account) return;
        loadAccount().then(setAccount);
    }, []);

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
                                <span className='profile-section-about-pill' data-tooltip-id="pill-tooltip" data-tooltip-content="This is your role on OmniPlayr" >{account?.role}</span>
                                <span className='profile-section-about-pill' data-tooltip-id="pill-tooltip" data-tooltip-content="This is when you created your account" >{account?.created_at && new Date(account.created_at).toLocaleDateString(undefined, {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                })}</span>
                            </div>
                            <p className={'profile-section-about-bio' + (account?.about ? "" : " empty")}>{account?.about || "No bio set"}</p>
                        </div>
                    </div>
                    
                </div>
            }
        </>
    )
}

export default Profile