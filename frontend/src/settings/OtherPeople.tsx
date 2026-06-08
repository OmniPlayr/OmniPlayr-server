import api from "../modules/api";
import { useEffect, useState, useRef } from "react";
import { useTranslation } from 'react-i18next';
import '../styles/settings/OtherPeople.css';
import defaultPfp from '../assets/images/default-pfp-dark.svg';
import { Grid2x2, ImageOff, RotateCcwKey, Rows3, Search, Shield, Trash2, User, UserPlus } from "lucide-react";
import { Tooltip } from "react-tooltip";
import { useIsMobile } from "../main";
import { createPopup, closePopup } from "../modules/PopupContext";

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
        const roleRef = { current: selectedProfile?.role ?? 'user' };

        function RoleOptions() {
            const [role, setRole] = useState(roleRef.current);
            function handleSetRole(r: string) {
                roleRef.current = r;
                setRole(r);
            }
            return (
                <div className='role-popup-options'>
                    <div className={'role-popup-option ' + (role === 'user' ? 'selected' : '')} onClick={() => handleSetRole('user')}>
                        <User className='role-popup-option-icon' />
                        <div className='role-popup-option-text'>{t('settings.people.other.role.user')}</div>
                    </div>
                    <div className={'role-popup-option ' + (role === 'admin' ? 'selected' : '')} onClick={() => handleSetRole('admin')}>
                        <Shield className='role-popup-option-icon' />
                        <div className='role-popup-option-text'>{t('settings.people.other.role.admin')}</div>
                    </div>
                </div>
            );
        }

        createPopup({
            id: 'role-popup',
            title: t('settings.people.other.role.title'),
            subtitle: t('settings.people.other.role.subtitle', { name: selectedProfile?.name }),
            close_button: true,
            content: <RoleOptions />,
            mobileFullscreen: true,
            buttons: [
                {
                    label: t('common.cancel'),
                    type: 'secondary',
                    onClick: () => closePopup('role-popup')
                },
                {
                    label: t('settings.people.other.role.apply'),
                    type: 'primary',
                    onClick: async () => {
                        await editRole(selectedProfile, roleRef.current);
                        setProfiles((prev: any[]) =>
                            prev.map((p: any) => p.id === selectedProfile.id ? { ...p, role: roleRef.current } : p)
                        );
                        setSelectedProfile((prev: any) => ({ ...prev, role: roleRef.current }));
                        setIsFullscreen(true);
                        closePopup('role-popup');
                    }
                }
            ]
        });
    }

    function openConfirmDeletion() {
        function ConfirmDeletionText() {
            return (
                <div className='confirm-delete-text'>
                    {t('settings.people.other.delete.desc1')}
                    <br />
                    {t('settings.people.other.delete.desc2')}
                    <br />
                    {t('settings.people.other.delete.desc3')}
                </div>
            )
        }
        createPopup({
            id: 'confirm-deletion',
            title: t('settings.people.other.delete.title', { name: selectedProfile?.name }),
            close_button: true,
            content: <ConfirmDeletionText />,
            mobileFullscreen: false,
            buttons: [
                {
                    label: t('common.cancel'),
                    type: 'secondary',
                    onClick: () => closePopup('confirm-deletion')
                },
                {
                    label: t('settings.people.other.delete.confirm'),
                    type: 'danger',
                    onClick: async () => {
                        await api("/accounts/" + selectedProfile.id, undefined, undefined, true, false, 'DELETE');
                        setProfiles((prev: any[]) => prev.filter((p: any) => p.id !== selectedProfile.id));
                        setSelectedProfile(null);
                        setIsFullscreen(false);
                        closePopup('confirm-deletion');
                    }
                }
            ]
        });
    }

    function openConfirmDeletePfp() {
        function ConfirmDeletePfpText() {
            return (
                <div className='confirm-pfp-delete-text'>
                    {t('settings.people.other.remove_pfp.desc1')}
                    <br />
                    {t('settings.people.other.remove_pfp.desc2')}
                </div>
            )
        }
        createPopup({
            id: 'confirm-delete-pfp',
            title: t('settings.people.other.remove_pfp.title', { name: selectedProfile?.name }),
            close_button: true,
            content: <ConfirmDeletePfpText />,
            mobileFullscreen: false,
            buttons: [
                {
                    label: t('common.cancel'),
                    type: 'secondary',
                    onClick: () => closePopup('confirm-delete-pfp')
                },
                {
                    label: t('settings.people.other.remove_pfp.confirm'),
                    type: 'danger',
                    onClick: async () => {
                        await api("/accounts/" + selectedProfile.id + "/pfp", undefined, undefined, true, false, 'DELETE');
                        setProfiles((prev: any[]) =>
                            prev.map((p: any) => p.id === selectedProfile.id ? { ...p, avatar_b64: null } : p)
                        );
                        setSelectedProfile((prev: any) => ({ ...prev, avatar_b64: null }));
                        setIsFullscreen(true);
                        closePopup('confirm-delete-pfp');
                    }
                }
            ]
        });
    }

    function openConfirmRevoke() {
        function RevokeText() {
            return (
                <div className='revoke-text'>
                    {t('settings.people.other.revoke.desc1')}
                    <br />
                    {t('settings.people.other.revoke.desc2')}
                </div>
            )
        }

        createPopup({
            id: 'confirm-revoke',
            title: t('settings.people.other.revoke.title', { name: selectedProfile?.name }),
            close_button: true,
            mobileFullscreen: false,
            content: <RevokeText />,
            buttons: [
                {
                    label: t('common.cancel'),
                    type: 'secondary',
                    onClick: () => closePopup('confirm-revoke')
                },
                {
                    label: t('settings.people.other.revoke.confirm'),
                    type: 'danger',
                    onClick: async () => {
                        await api("/accounts/revoke_all", { user_id: selectedProfile.id }, undefined, true, false, 'POST');
                        closePopup('confirm-revoke');
                        if (selectedProfile.id === account.id) {
                            window.location.href = '/';
                        }
                    }
                }
            ]
        });
    }

    function openCreatePopup() {
        const formRef = { name: '', role: 'user', avatar_b64: null as string | null };

        function CreateContent() {
            const [name, setName] = useState('');
            const [role, setRole] = useState('user');
            const [avatarB64, setAvatarB64] = useState<string | null>(null);

            function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
                formRef.name = e.target.value;
                setName(e.target.value);
            }

            function handleRoleChange(r: string) {
                formRef.role = r;
                setRole(r);
            }

            function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                    formRef.avatar_b64 = reader.result as string;
                    setAvatarB64(reader.result as string);
                };
                reader.readAsDataURL(file);
            }

            return (
                <div className='create-popup-content'>
                    <div className='create-popup-avatar-row'>
                        <label className='create-popup-avatar-upload' htmlFor="create-avatar-input">
                            {avatarB64
                                ? <img src={avatarB64} className='create-popup-avatar-preview' draggable={false} />
                                : <UserPlus className='create-popup-avatar-placeholder-icon' />
                            }
                            <input id="create-avatar-input" type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarUpload} />
                        </label>
                        <div className='create-popup-inputs'>
                            <input
                                className='create-popup-name-input'
                                type='text'
                                placeholder={t('settings.people.other.create.username_placeholder')}
                                value={name}
                                onChange={handleNameChange}
                            />
                            <div className='role-popup-options mobile'>
                                <div className={'role-popup-option ' + (role === 'user' ? 'selected' : '')} onClick={() => handleRoleChange('user')}>
                                    <User className='role-popup-option-icon' />
                                    <div className='role-popup-option-text'>{t('settings.people.other.role.user')}</div>
                                </div>
                                <div className={'role-popup-option ' + (role === 'admin' ? 'selected' : '')} onClick={() => handleRoleChange('admin')}>
                                    <Shield className='role-popup-option-icon' />
                                    <div className='role-popup-option-text'>{t('settings.people.other.role.admin')}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className='role-popup-options pc'>
                        <div className={'role-popup-option ' + (role === 'user' ? 'selected' : '')} onClick={() => handleRoleChange('user')}>
                            <User className='role-popup-option-icon' />
                            <div className='role-popup-option-text'>{t('settings.people.other.role.user')}</div>
                        </div>
                        <div className={'role-popup-option ' + (role === 'admin' ? 'selected' : '')} onClick={() => handleRoleChange('admin')}>
                            <Shield className='role-popup-option-icon' />
                            <div className='role-popup-option-text'>{t('settings.people.other.role.admin')}</div>
                        </div>
                    </div>
                </div>
            );
        }

        createPopup({
            id: 'create-user',
            title: t('settings.people.other.create.title'),
            subtitle: t('settings.people.other.create.subtitle'),
            close_button: true,
            content: <CreateContent />,
            mobileFullscreen: true,
            buttons: [
                {
                    label: t('common.cancel'),
                    type: 'secondary',
                    onClick: () => closePopup('create-user')
                },
                {
                    label: t('settings.people.other.create.confirm'),
                    type: 'primary',
                    onClick: async () => {
                        if (!formRef.name.trim()) return;
                        const result = await api("/accounts/", { name: formRef.name.trim(), role: formRef.role, avatar_b64: formRef.avatar_b64 }, undefined, true, false, 'POST');
                        setProfiles((prev: any[]) => [...prev, result]);
                        closePopup('create-user');
                    }
                }
            ]
        });
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
                                <input type="text" placeholder={t('settings.people.other.search_placeholder')} className="filter-search-input" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
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
                                            {account?.id !== selectedProfile?.id &&
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
                                            {account?.id !== selectedProfile?.id &&
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
        </>
    );
}

export default OtherPeople;