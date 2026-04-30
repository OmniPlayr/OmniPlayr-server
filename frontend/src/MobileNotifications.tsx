import './styles/Notifications.css';
import * as LucideIcons from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { ExternalLink, Trash2, RefreshCw  } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ComponentType } from 'react';
import { useRef, useEffect } from 'react';
import { useNotificationsContext } from './modules/NotificationsContext';
import { toAction } from './modules/useNotifications';

const SWIPE_MAX = 80;
const SWIPE_THRESHOLD = SWIPE_MAX * 0.5;

type DeletingPhase = 'sliding' | 'collapsing';

import { useState } from 'react';

function MobileNotifications() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const highlightId = searchParams.get('highlight') ? Number(searchParams.get('highlight')) : null;
    const { notifications, deleteNotification, markRead } = useNotificationsContext();
    const [swipeX, setSwipeX] = useState<Record<number, number>>({});
    const [isSwiping, setIsSwiping] = useState<Record<number, boolean>>({});
    const [deletingPhase, setDeletingPhase] = useState<Record<number, DeletingPhase>>({});
    const touchStartX = useRef<Record<number, number>>({});
    const touchBaseX = useRef<Record<number, number>>({});
    const highlightRef = useRef<HTMLDivElement | null>(null);
    const { refreshNotifications } = useNotificationsContext();
    const containerRef = useRef<HTMLDivElement>(null);
    const pullStartY = useRef(-1);
    const [pullDistance, setPullDistance] = useState(0);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const PULL_THRESHOLD = 72;
    const activeSwipeId = useRef<number | null>(null);

    const handleContainerTouchStart = (e: React.TouchEvent) => {
        if (activeSwipeId.current !== null) return;

        const scrollTop = containerRef.current?.scrollTop ?? 0;
        if (scrollTop <= 0) {
            pullStartY.current = e.touches[0].clientY;
        } else {
            pullStartY.current = -1;
        }
    };
    const handleContainerTouchMove = (e: React.TouchEvent) => {
        if (activeSwipeId.current !== null) return;
        if (pullStartY.current < 0) return;

        const delta = e.touches[0].clientY - pullStartY.current;
        if (delta > 0) {
            setPullDistance(Math.min(delta * 0.5, PULL_THRESHOLD * 1.2));
        }
    };

    const handleContainerTouchEnd = () => {
        if (activeSwipeId.current !== null) return;

        if (pullDistance >= PULL_THRESHOLD) {
            setIsRefreshing(true);
            refreshNotifications();
            setTimeout(() => setIsRefreshing(false), 1200);
        }
        setPullDistance(0);
        pullStartY.current = -1;
    };

    const handleAction = (id: number, action_type: string | null, action_url: string | null) => {
        if (swipeX[id] !== 0 && swipeX[id] !== undefined) return;
        const action = toAction(action_type, action_url);
        if (!action) return;
        markRead(id);
        if (action.type === 'external') window.open(action.url, '_blank');
        else if (action.type === 'internal') navigate(action.path);
    };

    const resolveIcon = (name: string): ComponentType<LucideProps> | null => {
        const icon = (LucideIcons as unknown as Record<string, unknown>)[name];
        if (icon != null && (typeof icon === 'function' || typeof icon === 'object')) {
            return icon as ComponentType<LucideProps>;
        }
        return null;
    };

    const triggerDelete = (id: number) => {
        setDeletingPhase(prev => ({ ...prev, [id]: 'collapsing' }));
        setSwipeX(prev => ({ ...prev, [id]: -window.innerWidth }));

        setTimeout(() => {
            deleteNotification(id);
            setDeletingPhase(prev => { const next = { ...prev }; delete next[id]; return next; });
            setSwipeX(prev => { const next = { ...prev }; delete next[id]; return next; });
        }, 350);
    };

    useEffect(() => {
        notifications
            .filter(n => !n.read && !toAction(n.action_type, n.action_url))
            .forEach(n => markRead(n.id));
    }, []);

    useEffect(() => {
        if (highlightRef.current) {
            highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [highlightId, notifications.length]);

    const handleTouchStart = (id: number, e: React.TouchEvent) => {
        if (isRefreshing) return;
        if (activeSwipeId.current !== null && activeSwipeId.current !== id) return;
        if (pullStartY.current >= 0) return;

        activeSwipeId.current = id;

        touchStartX.current[id] = e.touches[0].clientX;
        touchBaseX.current[id] = swipeX[id] ?? 0;
        setIsSwiping(prev => ({ ...prev, [id]: true }));
    };

    const handleTouchMove = (id: number, e: React.TouchEvent) => {
        if (activeSwipeId.current !== id) return;

        const delta = e.touches[0].clientX - touchStartX.current[id];
        const newX = Math.min(0, Math.max(-SWIPE_MAX, touchBaseX.current[id] + delta));
        setSwipeX(prev => ({ ...prev, [id]: newX }));
    };

    const handleTouchEnd = (id: number) => {
        if (activeSwipeId.current !== id) return;

        setIsSwiping(prev => ({ ...prev, [id]: false }));
        activeSwipeId.current = null;

        const current = swipeX[id] ?? 0;
        if (Math.abs(current) >= SWIPE_THRESHOLD) {
            triggerDelete(id);
        } else {
            setSwipeX(prev => ({ ...prev, [id]: 0 }));
        }
    };

    const renderText = (text: string): React.ReactNode => {
        const parts = text.split(/(<highlight>.*?<\/highlight>|<link href=".*?">.*?<\/link>)/g);
        return parts.map((part, i) => {
            const highlightMatch = part.match(/^<highlight>(.*?)<\/highlight>$/);
            if (highlightMatch) {
                return <span key={i} className="mobile-notification-highlight">{highlightMatch[1]}</span>;
            }
            const linkMatch = part.match(/^<link href="(.*?)">(.*?)<\/link>$/);
            if (linkMatch) {
                return <a key={i} href={linkMatch[1]} target="_blank" rel="noreferrer" className="mobile-notification-link">{linkMatch[2]}</a>;
            }
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
        const days = diffDays(dateStr);

        if (days === 0) return "Today";
        if (days === 1) return "Yesterday";
        if (days <= 6) return `${days} days ago`;
        if (days <= 30) return "1 week ago";
        if (days <= 90) return "1 month ago";

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
        if (days === 1) return `Yesterday ${time}`;

        return time;
    };

    return (
    <div className="mobile-notifications">
            <h1 className="mobile-notifications-title">Notifications</h1>
            <div className={`mobile-notifications-list${notifications.length === 0 ? ' mobile-no-notifications' : ''}`} 
                ref={containerRef}
                onTouchStart={handleContainerTouchStart}
                onTouchMove={handleContainerTouchMove}
                onTouchEnd={handleContainerTouchEnd}
            >
                <div
                    className="pull-to-refresh-indicator"
                    style={{
                        height: `${pullDistance}px`,
                        opacity: pullDistance / PULL_THRESHOLD,
                    }}
                >
                    <RefreshCw
                        size={20}
                        className={`pull-to-refresh-icon${isRefreshing ? ' pull-to-refresh-spinning' : ''}`}
                        style={{ transform: `rotate(${(pullDistance / PULL_THRESHOLD) * 180}deg)` }}
                    />
                </div>
                {notifications.length === 0 && (
                    <p className="mobile-notifications-text-empty">Its a little empty here...</p>
                )}
                {Object.entries(groupedNotifications).map(([group, items]) => (
                    <div key={group} className="mobile-notification-group">
                        <div className="mobile-notification-group-header">
                            {group}
                        </div>

                        {items.map((notification) => {
                            const IconComponent = resolveIcon(notification.icon);
                            const x = swipeX[notification.id] ?? 0;
                            const swiping = isSwiping[notification.id] ?? false;
                            const phase = deletingPhase[notification.id];
                            const action = toAction(notification.action_type, notification.action_url);
                            const isHighlighted = highlightId === notification.id;

                            return (
                                <div
                                    key={notification.id}
                                    ref={isHighlighted ? highlightRef : null}
                                    className={`mobile-notification-swipe-wrapper${phase === 'collapsing' ? ' mobile-notification-collapsing' : ''}`}
                                >
                                    <div className="mobile-notification-delete-bg">
                                        <Trash2 className="mobile-notification-delete-icon" />
                                    </div>

                                    <div
                                        className={`mobile-notification-item${action ? ' mobile-notification-clickable' : ''}${!notification.read ? ' mobile-notification-unread' : ''}${isHighlighted ? ' mobile-notification-highlighted' : ''}`}
                                        style={{
                                            transform: `translateX(${x}px)`,
                                            transition: swiping ? 'none' : 'transform 0.22s ease-in-out',
                                        }}
                                        onClick={() => handleAction(notification.id, notification.action_type, notification.action_url)}
                                        onTouchStart={(e) => handleTouchStart(notification.id, e)}
                                        onTouchMove={(e) => handleTouchMove(notification.id, e)}
                                        onTouchEnd={() => handleTouchEnd(notification.id)}
                                        title={formatExactDate(notification.created_at)}
                                    >
                                        {IconComponent && <IconComponent className="mobile-notification-icon" />}

                                        <div className="mobile-notification-content">
                                            <h3 className="mobile-notification-title">
                                                {notification.title}
                                            </h3>

                                            <p className="mobile-notification-text">
                                                {renderText(notification.text)}
                                            </p>

                                            <span className="mobile-notification-timestamp" title={formatExactDate(notification.created_at)}>
                                                {formatTimeLabel(notification.created_at)}
                                            </span>
                                        </div>

                                        {action?.type === 'external' && (
                                            <ExternalLink className="mobile-notification-external" />
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}

export default MobileNotifications;