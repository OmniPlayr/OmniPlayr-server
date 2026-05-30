import api from "../modules/api";
import { useEffect, useState } from "react";
import '../styles/settings/OtherPeople.css';
import defaultPfp from '../assets/images/default-pfp-dark.svg';
import { Grid2x2, ImageOff, RotateCcwKey, Rows3, Search, Shield, Trash2, User, UserPlus } from "lucide-react";
import { Tooltip } from "react-tooltip";
import { getAccount } from "../modules/account";

let cachedProfiles: any = null;
let fetchPromise: Promise<any> | null = null;

async function loadAccount() {
    return await api("get_account", undefined, { account_id: "me" }) as any;
}

async function loadOtherPeople() {
    if (!fetchPromise) {
        fetchPromise = api("get_accounts");
    }
    cachedProfiles = await fetchPromise;
    return cachedProfiles;
}

async function editRole(profile: any, role: string) {
    await api("/accounts/" + profile.id, { role }, undefined, true, false, 'PATCH');
}

function OtherPeople() {
    const [profiles, setProfiles] = useState<any>(cachedProfiles);
    const [viewType, setViewType] = useState('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedProfile, setSelectedProfile] = useState<any>(null);
    const [account, setAccount] = useState<any>(null);
    const [rolePopup, setRolePopup] = useState<{ open: boolean; pendingRole: string }>({ open: false, pendingRole: '' });
    const [confirmDeletion, setConfirmDeletion] = useState<{ open: boolean; profile: any }>({ open: false, profile: null });
    const [createPopup, setCreatePopup] = useState<{ open: boolean; name: string; role: string; avatar_b64: string | null }>({ open: false, name: '', role: 'user', avatar_b64: null });
    const [confirmRevoke, setConfirmRevoke] = useState<{ open: boolean; profile: any }>({ open: false, profile: null });
    const [confirmDeletePfp, setConfirmDeletePfp] = useState<{ open: boolean; profile: any }>({ open: false, profile: null });

    useEffect(() => {
        if (profiles) return;
        loadOtherPeople().then(setProfiles);
    }, []);

    useEffect(() => {
        if (account) return;
        loadAccount().then(setAccount);
    }, []);

    function openRolePopup() {
        setRolePopup({ open: true, pendingRole: selectedProfile?.role ?? 'user' });
    }

    function closeRolePopup() {
        setRolePopup({ open: false, pendingRole: '' });
    }

    async function applyRole() {
        await editRole(selectedProfile, rolePopup.pendingRole);
        setProfiles((prev: any[]) =>
            prev.map((p: any) => p.id === selectedProfile.id ? { ...p, role: rolePopup.pendingRole } : p)
        );
        setSelectedProfile((prev: any) => ({ ...prev, role: rolePopup.pendingRole }));
        closeRolePopup();
    }

    function openConfirmDeletion() {
        setConfirmDeletion({ open: true, profile: selectedProfile });
    }

    function closeConfirmDeletion() {
        setConfirmDeletion({ open: false, profile: null });
    }

    async function applyDeletion() {
        await api("/accounts/" + selectedProfile.id, undefined, undefined, true, false, 'DELETE');
        setProfiles((prev: any[]) => prev.filter((p: any) => p.id !== selectedProfile.id));
        setSelectedProfile(null);
        closeConfirmDeletion();
    }

    function openConfirmDeletePfp() {
        setConfirmDeletePfp({ open: true, profile: selectedProfile });
    }

    function closeConfirmDeletePfp() {
        setConfirmDeletePfp({ open: false, profile: null });
    }

    async function applyDeletePfp() {
        await api("/accounts/" + selectedProfile.id + "/pfp", undefined, undefined, true, false, 'DELETE');
        setProfiles((prev: any[]) =>
            prev.map((p: any) => p.id === selectedProfile.id ? { ...p, avatar_b64: null } : p)
        );
        setSelectedProfile((prev: any) => ({ ...prev, avatar_b64: null }));
        closeConfirmDeletePfp();
    }

    function openConfirmRevoke() {
        setConfirmRevoke({ open: true, profile: selectedProfile });
    }

    function closeConfirmRevoke() {
        setConfirmRevoke({ open: false, profile: null });
    }

    async function applyRevoke() {
        await api("/accounts/revoke_all", { user_id: selectedProfile.id }, undefined, true, false, 'POST');
        closeConfirmRevoke();
        if (selectedProfile.id === account.id) {
            window.location.href = '/';
        }
    }

    function openCreatePopup() {
        setCreatePopup({ open: true, name: '', role: 'user', avatar_b64: null });
    }

    function closeCreatePopup() {
        setCreatePopup({ open: false, name: '', role: 'user', avatar_b64: null });
    }

    async function applyCreate() {
        if (!createPopup.name.trim()) return;
        const result = await api("/accounts/", { name: createPopup.name.trim(), role: createPopup.role, avatar_b64: createPopup.avatar_b64 }, undefined, true, false, 'POST');
        setProfiles((prev: any[]) => [...prev, result]);
        closeCreatePopup();
    }

    function handleCreateAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => setCreatePopup(prev => ({ ...prev, avatar_b64: reader.result as string }));
        reader.readAsDataURL(file);
    }

    return (
        <>
            {!profiles || !account && <div>Loading...</div>}
            {profiles && account &&
                <div className='other-people-section'>
                    <div className={'other-people-grid ' + viewType}>
                        <div className='other-people-grid-filter-options'>
                            <Tooltip id="view-type-tooltip" />
                            <div className="view-type" data-tooltip-id="view-type-tooltip" data-tooltip-content="Change view">
                                {viewType === 'grid' ? <Rows3 className='view-type-icon' onClick={() => setViewType('list')} /> : <Grid2x2 className='view-type-icon' onClick={() => setViewType('grid')} />}
                            </div>
                            <div className="filter-search-bar">
                                <Search className="filter-search-icon" />
                                <input type="text" placeholder="Search..." className="filter-search-input" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}/>
                            </div>
                        </div>
                        {profiles.map((profile: any) => {
                            const query = searchQuery.toLowerCase();

                            return (
                                profile.name?.toLowerCase().includes(query) ||
                                profile.nickname?.toLowerCase().includes(query) ||
                                profile.role?.toLowerCase().includes(query)
                            ) && (
                                <div key={profile.id} className={'other-people-profile ' + (selectedProfile?.id === profile.id ? 'selected' : '')} onClick={() => selectedProfile?.id === profile.id ? setSelectedProfile(null) : setSelectedProfile(profile)}>
                                    <img src={profile?.avatar_b64 ?? defaultPfp} className='other-people-profile-pfp' draggable={false} />
                                    <div className='other-people-profile-info'>
                                        <div className='other-people-profile-info-group'>
                                            <div className='other-people-profile-nickname'>{profile.nickname || profile.name}</div>
                                            <div className='other-people-profile-name'>@{profile.name}</div>
                                        </div>
                                        <div className={'other-people-profile-role ' + profile.role}>{profile.role}</div>
                                    </div>
                                </div>
                            );
                        })}
                        <div className='other-people-profile' onClick={openCreatePopup}>
                            <div className='other-people-profile-pfp other-people-profile-pfp-add'>
                                <UserPlus className='other-people-profile-icon other-people-profile-icon-add' />
                            </div>
                            <div className='other-people-profile-info other-people-profile-info-add'>
                                <div className='other-people-profile-nickname'>New User</div>
                                <div className='other-people-profile-name'>Create a new user</div>
                            </div>
                        </div>
                    </div>
                    <div className='other-people-mod-view'>
                        {!selectedProfile && 
                            <div className='other-people-mod-view-empty'>
                                <User className='other-people-mod-view-empty-icon' />
                                <p className="other-people-mod-view-empty-text">Select a profile to edit</p>
                            </div>
                        }

                        {selectedProfile &&
                            <>
                                <div className='other-people-mod-view-profile'>
                                    <img src={selectedProfile?.avatar_b64 ?? defaultPfp} className='other-people-mod-view-profile-pfp' draggable={false} />
                                    <div className='other-people-mod-view-profile-info'>
                                        <div className='other-people-mod-view-profile-name'>@{selectedProfile.name}</div>
                                        <div className='other-people-mod-view-profile-role'>{selectedProfile.role}</div>
                                    </div>
                                </div>
                                <div className='other-people-mod-view-actions'>
                                    <div className="opmva-group">
                                        <p className="opmva-group-title">Account Options</p>
                                        <div className="opmva-group-options">
                                            { account?.id !== selectedProfile?.id &&
                                                <div className="opmva-group-option" onClick={openRolePopup}>
                                                    <Shield className="opmva-group-option-icon" />
                                                    <div className="opmva-group-option-text">Edit Role</div>
                                                </div>
                                            }
                                            <div className="opmva-group-option danger" onClick={openConfirmDeletePfp}>
                                                <ImageOff className="opmva-group-option-icon" />
                                                <div className="opmva-group-option-text">Remove Profile Picture</div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="opmva-group">
                                        <p className="opmva-group-title">Actions</p>
                                        <div className="opmva-group-options">
                                            { account?.id !== selectedProfile?.id &&
                                                <div className="opmva-group-option danger" onClick={openConfirmDeletion}>
                                                    <Trash2 className="opmva-group-option-icon" />
                                                    <div className="opmva-group-option-text">Delete Account</div>
                                                </div>
                                            }
                                            <div className="opmva-group-option danger" onClick={openConfirmRevoke}>
                                                <RotateCcwKey className="opmva-group-option-icon" />
                                                <div className="opmva-group-option-text">Revoke All Tokens</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        }
                    </div>
                </div>
            }

            {rolePopup.open &&
                <div className='role-popup-overlay' onClick={closeRolePopup}>
                    <div className='role-popup' onClick={e => e.stopPropagation()}>
                        <p className='role-popup-title'>Edit Role</p>
                        <p className='role-popup-subtitle'>Select a role for @{selectedProfile?.name}</p>
                        <div className='role-popup-options'>
                            <div
                                className={'role-popup-option ' + (rolePopup.pendingRole === 'user' ? 'selected' : '')}
                                onClick={() => setRolePopup(prev => ({ ...prev, pendingRole: 'user' }))}
                            >
                                <User className='role-popup-option-icon' />
                                <div className='role-popup-option-text'>User</div>
                            </div>
                            <div
                                className={'role-popup-option ' + (rolePopup.pendingRole === 'admin' ? 'selected' : '')}
                                onClick={() => setRolePopup(prev => ({ ...prev, pendingRole: 'admin' }))}
                            >
                                <Shield className='role-popup-option-icon' />
                                <div className='role-popup-option-text'>Admin</div>
                            </div>
                        </div>
                        <div className='role-popup-actions'>
                            <div className='role-popup-btn cancel' onClick={closeRolePopup}>Cancel</div>
                            <div className='role-popup-btn apply' onClick={applyRole}>Apply</div>
                        </div>
                    </div>
                </div>
            }

            {confirmDeletion.open &&
                <div className='role-popup-overlay' onClick={closeConfirmDeletion}>
                    <div className='role-popup' onClick={e => e.stopPropagation()}>
                        <p className='role-popup-title'>Delete '{selectedProfile?.name}'?</p>
                        <p className='role-popup-subtitle'>Are you sure you want to delete this account? This action cannot be undone.</p>
                        <p className='role-popup-subtitle'>All data associated with this account will be permanently deleted and cannot be recovered.</p>
                        <p className='role-popup-subtitle'>This user will also be logged out of all devices.</p>
                        <div className='role-popup-actions'>
                            <div className='role-popup-btn cancel' onClick={closeConfirmDeletion}>Cancel</div>
                            <div className='role-popup-btn danger' onClick={applyDeletion}>Confirm Deletion</div>
                        </div>
                    </div>
                </div>
            }

            {confirmRevoke.open &&
                <div className='role-popup-overlay' onClick={closeConfirmRevoke}>
                    <div className='role-popup' onClick={e => e.stopPropagation()}>
                        <p className='role-popup-title'>Revoke all tokens for '{selectedProfile?.name}'?</p>
                        <p className='role-popup-subtitle'>Are you sure you want to revoke all tokens for this account? This action cannot be undone.</p>
                        <p className='role-popup-subtitle'>This user will be logged out of all devices. And all tokens will be revoked.</p>
                        <div className='role-popup-actions'>
                            <div className='role-popup-btn cancel' onClick={closeConfirmRevoke}>Cancel</div>
                            <div className='role-popup-btn danger' onClick={applyRevoke}>Revoke Tokens</div>
                        </div>
                    </div>
                </div>
            }

            {confirmDeletePfp.open &&
                <div className='role-popup-overlay' onClick={closeConfirmDeletePfp}>
                    <div className='role-popup' onClick={e => e.stopPropagation()}>
                        <p className='role-popup-title'>Remove profile picture for '{selectedProfile?.name}'?</p>
                        <p className='role-popup-subtitle'>Are you sure you want to remove the profile picture for this account? This action cannot be undone.</p>
                        <p className='role-popup-subtitle'>The user will need to upload a new profile picture.</p>
                        <div className='role-popup-actions'>
                            <div className='role-popup-btn cancel' onClick={closeConfirmDeletePfp}>Cancel</div>
                            <div className='role-popup-btn danger' onClick={applyDeletePfp}>Remove Profile Picture</div>
                        </div>
                    </div>
                </div>
            }

            {createPopup.open &&
                <div className='role-popup-overlay' onClick={closeCreatePopup}>
                    <div className='role-popup' onClick={e => e.stopPropagation()}>
                        <p className='role-popup-title'>Create Account</p>
                        <p className='role-popup-subtitle'>Fill in the details for the new user.</p>

                        <div className='create-popup-avatar-row'>
                            <label className='create-popup-avatar-upload' htmlFor="create-avatar-input">
                                {createPopup.avatar_b64
                                    ? <img src={createPopup.avatar_b64} className='create-popup-avatar-preview' draggable={false} />
                                    : <UserPlus className='create-popup-avatar-placeholder-icon' />
                                }
                                <input id="create-avatar-input" type="file" accept="image/*" style={{ display: 'none' }} onChange={handleCreateAvatarUpload} />
                            </label>
                            <input
                                className='create-popup-name-input'
                                type='text'
                                placeholder='Username...'
                                value={createPopup.name}
                                onChange={e => setCreatePopup(prev => ({ ...prev, name: e.target.value }))}
                            />
                        </div>

                        <div className='role-popup-options'>
                            <div
                                className={'role-popup-option ' + (createPopup.role === 'user' ? 'selected' : '')}
                                onClick={() => setCreatePopup(prev => ({ ...prev, role: 'user' }))}
                            >
                                <User className='role-popup-option-icon' />
                                <div className='role-popup-option-text'>User</div>
                            </div>
                            <div
                                className={'role-popup-option ' + (createPopup.role === 'admin' ? 'selected' : '')}
                                onClick={() => setCreatePopup(prev => ({ ...prev, role: 'admin' }))}
                            >
                                <Shield className='role-popup-option-icon' />
                                <div className='role-popup-option-text'>Admin</div>
                            </div>
                        </div>

                        <div className='role-popup-actions'>
                            <div className='role-popup-btn cancel' onClick={closeCreatePopup}>Cancel</div>
                            <div className={'role-popup-btn apply ' + (!createPopup.name.trim() ? 'disabled' : '')} onClick={applyCreate}>Create</div>
                        </div>
                    </div>
                </div>
            }
        </>
    )
}

export default OtherPeople