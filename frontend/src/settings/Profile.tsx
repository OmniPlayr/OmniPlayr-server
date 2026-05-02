import '../styles/settings/Profile.css';
import api from '../modules/api';
import { useEffect, useState } from 'react';
import defaultPfp from '../assets/images/default-pfp-dark.svg';

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
                    <div className='profile-section-info'>
                        <img draggable="false" className="profile-section-avatar" src={account?.avatar_b64 || defaultPfp} alt={account?.name} />
                        <div className='profile-section-info-nickname'>{account.nickname || account.name}</div>
                        <div className='profile-section-info-name'>@{account.name}</div>
                    </div>
                </div>
            }
        </>
    )
}

export default Profile