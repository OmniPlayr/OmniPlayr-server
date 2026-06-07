import api from "../modules/api";
import { useEffect, useState, useRef } from "react";
import { useTranslation } from 'react-i18next';
import '../styles/settings/OtherPeople.css';
import defaultPfp from '../assets/images/default-pfp-dark.svg';
import { Fullscreen, Grid2x2, ImageOff, RotateCcwKey, Rows3, Search, Shield, Trash2, User, UserPlus } from "lucide-react";
import { Tooltip } from "react-tooltip";
import { getAccount } from "../modules/account";
import { useIsMobile } from "../main";

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
    const { t } = useTranslation();
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

    const isMobile = useIsMobile();
    
    const opRef = useRef<HTMLDivElement>(null);
    const opDragStart = useRef(0);
    const opDragY = useRef(0);
    const opIsDragging = useRef(false);
    const opIsClosing = useRef(false);
    const [isOpOpen, setIsFullscreen] = useState(false);

    useEffect(() => {
        if (!isMobile) return;
        if (!opRef.current || opIsClosing.current) return;
        opRef.current.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
        opRef.current.style.transform = isOpOpen ? 'translateY(0)' : 'translateY(100%)';
    }, [isOpOpen]);


    const handleOpPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isMobile) return;
        const target = e.target as HTMLElement;
        if (target.closest('.opmva-group-option')) return;
        opIsDragging.current = true;
        opDragStart.current = e.clientY;
        opDragY.current = 0;
        if (opRef.current) opRef.current.style.transition = 'none';
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handleOpPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isMobile) return;
        if (!opIsDragging.current || !opRef.current) return;
        const dy = Math.max(0, e.clientY - opDragStart.current);
        opDragY.current = dy;
        opRef.current.style.transform = `translateY(${dy}px)`;
    };

    const handleOpPointerUp = () => {
        if (!isMobile) return;
        if (!opIsDragging.current || !opRef.current) return;
        opIsDragging.current = false;
        const dy = opDragY.current;
        if (dy > window.innerHeight * 0.28) {
            opIsClosing.current = true;
            opRef.current.style.transition = 'transform 0.38s cubic-bezier(0.4, 0, 0.2, 1)';
            opRef.current.style.transform = 'translateY(100%)';
            setTimeout(() => {
                opIsClosing.current = false;
                setIsFullscreen(false);
                setSelectedProfile(null);
            }, 380);
        } else {
            opRef.current.style.transition = 'transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)';
            opRef.current.style.transform = 'translateY(0)';
            setIsFullscreen(true);
        }
    };

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
        setIsFullscreen(true);
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
        setIsFullscreen(false);
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
        setIsFullscreen(true);
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

    function unsetSelecterdProfile() {
        setSelectedProfile(null);
        setIsFullscreen(false);
    }

    function setSelectedProfileFullscreen(profile: any) {
        setSelectedProfile(profile);
        setIsFullscreen(true);
    }

    return (
        <>
            {!profiles || !account && <div>{t('common.loading')}</div>}
            {profiles && account &&
                <div className='other-people-section'>
                    <div className={'other-people-grid ' + viewType}>
                        <div className='other-people-grid-filter-options'>
                            <Tooltip id="view-type-tooltip" />
                            <div className="view-type" data-tooltip-id="view-type-tooltip" data-tooltip-content={t('settings.people.other.tooltip.change_view')}>
                                {viewType === 'grid' ? <Rows3 className='view-type-icon' onClick={() => setViewType('list')} /> : <Grid2x2 className='view-type-icon' onClick={() => setViewType('grid')} />}
                            </div>
                            <div className="filter-search-bar">
                                <Search className="filter-search-icon" />
                                <input type="text" placeholder={t('settings.people.other.search_placeholder')} className="filter-search-input" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}/>
                            </div>
                        </div>
                        {profiles.map((profile: any) => {
                            const query = searchQuery.toLowerCase();

                            return (
                                profile.name?.toLowerCase().includes(query) ||
                                profile.nickname?.toLowerCase().includes(query) ||
                                profile.role?.toLowerCase().includes(query)
                            ) && (
                                <div key={profile.id} className={'other-people-profile ' + (selectedProfile?.id === profile.id ? 'selected' : '')} onClick={() => selectedProfile?.id === profile.id ? unsetSelecterdProfile() : setSelectedProfileFullscreen(profile)}>
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
                                <div className='other-people-profile-nickname'>{t('settings.people.other.new_user')}</div>
                                <div className='other-people-profile-name'>{t('settings.people.other.create_desc')}</div>
                            </div>
                        </div>
                    </div>
                    <div 
                        className={'other-people-mod-view' + (selectedProfile && !isMobile ? ' open' : '') + (isMobile && isOpOpen ? ' open' : '')}
                        ref={opRef}
                        onPointerDown={handleOpPointerDown}
                        onPointerMove={handleOpPointerMove}
                        onPointerUp={handleOpPointerUp}
                    >
                        {!selectedProfile && 
                            <div className='other-people-mod-view-empty'>
                                <User className='other-people-mod-view-empty-icon' />
                                <p className="other-people-mod-view-empty-text">{t('settings.people.other.select')}</p>
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
                                        <p className="opmva-group-title">{t('settings.people.other.section.account_options')}</p>
                                        <div className="opmva-group-options">
                                            { account?.id !== selectedProfile?.id &&
                                                <div className="opmva-group-option" onClick={openRolePopup}>
                                                    <Shield className="opmva-group-option-icon" />
                                                    <div className="opmva-group-option-text">{t('settings.people.other.action.edit_role')}</div>
                                                </div>
                                            }
                                            <div className="opmva-group-option danger" onClick={openConfirmDeletePfp}>
                                                <ImageOff className="opmva-group-option-icon" />
                                                <div className="opmva-group-option-text">{t('settings.people.other.action.remove_pfp')}</div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="opmva-group">
                                        <p className="opmva-group-title">{t('settings.people.other.section.actions')}</p>
                                        <div className="opmva-group-options">
                                            { account?.id !== selectedProfile?.id &&
                                                <div className="opmva-group-option danger" onClick={openConfirmDeletion}>
                                                    <Trash2 className="opmva-group-option-icon" />
                                                    <div className="opmva-group-option-text">{t('settings.people.other.action.delete_account')}</div>
                                                </div>
                                            }
                                            <div className="opmva-group-option danger" onClick={openConfirmRevoke}>
                                                <RotateCcwKey className="opmva-group-option-icon" />
                                                <div className="opmva-group-option-text">{t('settings.people.other.action.revoke_tokens')}</div>
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
                        <p className='role-popup-title'>{t('settings.people.other.role.title')}</p>
                        <p className='role-popup-subtitle'>{t('settings.people.other.role.subtitle', { name: selectedProfile?.name })}</p>
                        <div className='role-popup-options'>
                            <div
                                className={'role-popup-option ' + (rolePopup.pendingRole === 'user' ? 'selected' : '')}
                                onClick={() => setRolePopup(prev => ({ ...prev, pendingRole: 'user' }))}
                            >
                                <User className='role-popup-option-icon' />
                                <div className='role-popup-option-text'>{t('settings.people.other.role.user')}</div>
                            </div>
                            <div
                                className={'role-popup-option ' + (rolePopup.pendingRole === 'admin' ? 'selected' : '')}
                                onClick={() => setRolePopup(prev => ({ ...prev, pendingRole: 'admin' }))}
                            >
                                <Shield className='role-popup-option-icon' />
                                <div className='role-popup-option-text'>{t('settings.people.other.role.admin')}</div>
                            </div>
                        </div>
                        <div className='role-popup-actions'>
                            <div className='role-popup-btn cancel' onClick={closeRolePopup}>{t('common.cancel')}</div>
                            <div className='role-popup-btn apply' onClick={applyRole}>{t('settings.people.other.role.apply')}</div>
                        </div>
                    </div>
                </div>
            }

            {confirmDeletion.open &&
                <div className='role-popup-overlay' onClick={closeConfirmDeletion}>
                    <div className='role-popup' onClick={e => e.stopPropagation()}>
                        <p className='role-popup-title'>{t('settings.people.other.delete.title', { name: selectedProfile?.name })}</p>
                        <p className='role-popup-subtitle'>{t('settings.people.other.delete.desc1')}</p>
                        <p className='role-popup-subtitle'>{t('settings.people.other.delete.desc2')}</p>
                        <p className='role-popup-subtitle'>{t('settings.people.other.delete.desc3')}</p>
                        <div className='role-popup-actions'>
                            <div className='role-popup-btn cancel' onClick={closeConfirmDeletion}>{t('common.cancel')}</div>
                            <div className='role-popup-btn danger' onClick={applyDeletion}>{t('settings.people.other.delete.confirm')}</div>
                        </div>
                    </div>
                </div>
            }

            {confirmRevoke.open &&
                <div className='role-popup-overlay' onClick={closeConfirmRevoke}>
                    <div className='role-popup' onClick={e => e.stopPropagation()}>
                        <p className='role-popup-title'>{t('settings.people.other.revoke.title', { name: selectedProfile?.name })}</p>
                        <p className='role-popup-subtitle'>{t('settings.people.other.revoke.desc1')}</p>
                        <p className='role-popup-subtitle'>{t('settings.people.other.revoke.desc2')}</p>
                        <div className='role-popup-actions'>
                            <div className='role-popup-btn cancel' onClick={closeConfirmRevoke}>{t('common.cancel')}</div>
                            <div className='role-popup-btn danger' onClick={applyRevoke}>{t('settings.people.other.revoke.confirm')}</div>
                        </div>
                    </div>
                </div>
            }

            {confirmDeletePfp.open &&
                <div className='role-popup-overlay' onClick={closeConfirmDeletePfp}>
                    <div className='role-popup' onClick={e => e.stopPropagation()}>
                        <p className='role-popup-title'>{t('settings.people.other.remove_pfp.title', { name: selectedProfile?.name })}</p>
                        <p className='role-popup-subtitle'>{t('settings.people.other.remove_pfp.desc1')}</p>
                        <p className='role-popup-subtitle'>{t('settings.people.other.remove_pfp.desc2')}</p>
                        <div className='role-popup-actions'>
                            <div className='role-popup-btn cancel' onClick={closeConfirmDeletePfp}>{t('common.cancel')}</div>
                            <div className='role-popup-btn danger' onClick={applyDeletePfp}>{t('settings.people.other.remove_pfp.confirm')}</div>
                        </div>
                    </div>
                </div>
            }

            {createPopup.open &&
                <div className='role-popup-overlay' onClick={closeCreatePopup}>
                    <div className='role-popup' onClick={e => e.stopPropagation()}>
                        <p className='role-popup-title'>{t('settings.people.other.create.title')}</p>
                        <p className='role-popup-subtitle'>{t('settings.people.other.create.subtitle')}</p>

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
                                placeholder={t('settings.people.other.create.username_placeholder')}
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
                                <div className='role-popup-option-text'>{t('settings.people.other.role.user')}</div>
                            </div>
                            <div
                                className={'role-popup-option ' + (createPopup.role === 'admin' ? 'selected' : '')}
                                onClick={() => setCreatePopup(prev => ({ ...prev, role: 'admin' }))}
                            >
                                <Shield className='role-popup-option-icon' />
                                <div className='role-popup-option-text'>{t('settings.people.other.role.admin')}</div>
                            </div>
                        </div>

                        <div className='role-popup-actions'>
                            <div className='role-popup-btn cancel' onClick={closeCreatePopup}>{t('common.cancel')}</div>
                            <div className={'role-popup-btn apply ' + (!createPopup.name.trim() ? 'disabled' : '')} onClick={applyCreate}>{t('settings.people.other.create.confirm')}</div>
                        </div>
                    </div>
                </div>
            }
        </>
    )
}

export default OtherPeople