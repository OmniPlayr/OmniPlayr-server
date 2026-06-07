import { ChevronLeft, ChevronRight, Menu, X, ShieldAlert, RefreshCw, Bell, MoreVertical, Trash2, ExternalLink } from "lucide-react"
import "./styles/Header.css"
import { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNotificationsContext } from './modules/NotificationsContext'
import { toAction } from './modules/useNotifications'
import { useTranslation } from 'react-i18next';

interface HeaderProps {
    canGoBack: boolean;
    canGoForward: boolean;
    onBack: () => void;
    onForward: () => void;
    onMenuToggle?: () => void;
    isMobile?: boolean;
    sidebarOpen?: boolean;
    safeMode?: boolean;
    updateAvailable?: boolean;
    onUpdateClick?: () => void;
}

function Header({ canGoBack, canGoForward, onBack, onForward, onMenuToggle, isMobile, sidebarOpen, safeMode, updateAvailable, onUpdateClick }: HeaderProps) {
    const { notifications, deleteNotification, markRead, unreadCount } = useNotificationsContext();
    const [popupOpen, setPopupOpen] = useState(false);
    const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const bellRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    const {t} = useTranslation();

    useEffect(() => {
        if (!popupOpen) return;
        const handler = (e: MouseEvent) => {
            if (
                popupRef.current && !popupRef.current.contains(e.target as Node) &&
                bellRef.current && !bellRef.current.contains(e.target as Node)
            ) {
                setPopupOpen(false);
                setMenuOpenId(null);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [popupOpen]);

    useEffect(() => {
        const POPUP_HEIGHT = 360;
        document.documentElement.style.setProperty(
            '--desktop-popup-offset',
            popupOpen ? `${POPUP_HEIGHT}px` : '0px'
        );
        return () => document.documentElement.style.setProperty('--desktop-popup-offset', '0px');
    }, [popupOpen]);

    useEffect(() => {
        if (!popupOpen) return;

        notifications.forEach(n => {
            const action = toAction(n.action_type, n.action_url);
            if (!action || action.type !== 'external') {
                markRead(n.id);
            }
        });
    }, [popupOpen, notifications, markRead]);

    const handleBellClick = () => {
        setPopupOpen(prev => !prev);
        setMenuOpenId(null);
    };

    const handleNotificationClick = (id: number, action_type: string | null, action_url: string | null) => {
        const action = toAction(action_type, action_url);
        if (!action) return;
        markRead(id);
        if (action.type === 'external') {
            window.open(action.url, '_blank', 'noreferrer');
        } else if (action.type === 'internal') {
            navigate(action.path);
            setPopupOpen(false);
        }
    };

    const renderText = (text: string): React.ReactNode => {
        const parts = text.split(/(<highlight>.*?<\/highlight>|<link href=".*?">.*?<\/link>)/g);
        return parts.map((part, i) => {
            const hm = part.match(/^<highlight>(.*?)<\/highlight>$/);
            if (hm) return <span key={i} className="desktop-notif-highlight">{hm[1]}</span>;
            const lm = part.match(/^<link href="(.*?)">(.*?)<\/link>$/);
            if (lm) return <a key={i} href={lm[1]} target="_blank" rel="noreferrer" className="desktop-notif-link" onClick={e => e.stopPropagation()}>{lm[2]}</a>;
            return part;
        });
    };

    const formatExactDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleString();
    };

    const diffDays = (dateStr: string) => {
        const d = new Date(dateStr);
        const now = new Date();
        return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    };

    const getGroupLabel = (dateStr: string) => {
        const d = new Date(dateStr);
        const now = new Date();

        const days = diffDays(dateStr);

        if (days === 0) return t('common.today');
        if (days === 1) return t('common.yesterday');
        if (days <= 6) return t('common.daysAgo', { days: days });
        if (days <= 30) return t('common.weeksAgo', { weeks: Math.ceil(days / 7) });
        if (days <= 90) return t('common.monthsAgo', { months: Math.ceil(days / 30) });

        return d.toLocaleDateString();
    };

    const groupNotifications = (items: typeof notifications) => {
        const groups: Record<string, typeof notifications> = {};

        [...items]
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .forEach(n => {
                const label = getGroupLabel(n.created_at);
                if (!groups[label]) groups[label] = [];
                groups[label].push(n);
            });

        return groups;
    };

    const groupedNotifications = groupNotifications(notifications);

    const formatTimeLabel = (dateStr: string) => {
        const d = new Date(dateStr);
        const days = diffDays(dateStr);

        const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (days === 0) return time;
        if (days === 1) return t('common.yesterday.time', { time: time });

        return time;
    };

    return (
        <div className="header">
            <div className="header-left">
                {isMobile && (
                    <div className="header-menu-btn" onClick={onMenuToggle}>
                        {sidebarOpen ? (
                            <X className="menu-icon" />
                        ) : (
                            <Menu className="menu-icon" />
                        )}
                    </div>
                )}
                <div className="header-page-controls">
                    <ChevronLeft
                        className={`page-control${canGoBack ? " allowed" : ""}`}
                        onClick={canGoBack ? onBack : undefined}
                    />
                    <ChevronRight
                        className={`page-control${canGoForward ? " allowed" : ""}`}
                        onClick={canGoForward ? onForward : undefined}
                    />
                </div>
            </div>
            <div className="header-right">
                {updateAvailable && (
                    <div className="header-update-badge" onClick={onUpdateClick}>
                        <RefreshCw size={12} className="spin-hover" />
                        {t('header.update')}
                    </div>
                )}
                {safeMode && (
                    <div className="header-safe-mode-badge">
                        <ShieldAlert size={12} />
                        {t('header.safemode')}
                    </div>
                )}
                <div className="header-notifications-wrapper" ref={bellRef}>
                    <div
                        className={`header-notifications-badge${popupOpen ? ' header-notifications-badge--active' : ''}`}
                        onClick={handleBellClick}
                    >
                        <Bell className="desktop-notification-badge" />
                        {unreadCount > 0 && <span className="header-notif-dot" />}
                    </div>

                    {popupOpen && (
                        <div className="desktop-notifications-popup" ref={popupRef}>
                            <div className="desktop-notifications-popup-header">{t('notifications.title')}</div>
                            <div className="desktop-notifications-popup-list">
                                {notifications.length === 0 ? (
                                    <p className="desktop-notifications-empty">{t('notifications.empty')}</p>
                                ) : (Object.entries(groupedNotifications).map(([group, items]) => (
                                    <div key={group} className="desktop-notification-group">
                                        <div className="desktop-notification-group-header">
                                            {group}
                                        </div>

                                        {items.map(n => {
                                            const action = toAction(n.action_type, n.action_url);
                                            const isMenuOpen = menuOpenId === n.id;

                                            return (
                                                <div
                                                    key={n.id}
                                                    className={[
                                                        'desktop-notification-item',
                                                        action ? 'desktop-notification-clickable' : '',
                                                        !n.read ? 'desktop-notification-unread' : '',
                                                    ].filter(Boolean).join(' ')}
                                                    onClick={() => handleNotificationClick(n.id, n.action_type, n.action_url)}
                                                    title={formatExactDate(n.created_at)}
                                                >
                                                    <div className="desktop-notification-body">
                                                        <div className="desktop-notification-title">{n.title}</div>
                                                        <div className="desktop-notification-text">{renderText(n.text)}</div>
                                                        <div className="desktop-notification-timestamp" title={formatExactDate(n.created_at)}>
                                                            {formatTimeLabel(n.created_at)}
                                                        </div>
                                                    </div>

                                                    {action?.type === 'external' && (
                                                        <ExternalLink size={11} className="desktop-notification-external-icon" />
                                                    )}

                                                    <div className="desktop-notification-more-wrapper">
                                                        <button
                                                            className="desktop-notification-more-btn"
                                                            onClick={e => {
                                                                e.stopPropagation();
                                                                setMenuOpenId(prev => prev === n.id ? null : n.id);
                                                            }}
                                                        >
                                                            <MoreVertical size={14} />
                                                        </button>

                                                        {isMenuOpen && (
                                                            <div className="desktop-notification-menu">
                                                                <button
                                                                    className="desktop-notification-menu-item desktop-notification-menu-delete"
                                                                    onClick={e => {
                                                                        e.stopPropagation();
                                                                        deleteNotification(n.id);
                                                                        setMenuOpenId(null);
                                                                    }}
                                                                >
                                                                    <Trash2 size={12} />
                                                                    {t('notifications.delete')}
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default Header;