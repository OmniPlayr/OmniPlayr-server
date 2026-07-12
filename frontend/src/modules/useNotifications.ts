import { useState, useEffect, useRef, useCallback } from 'react';
import { getConfig } from './config';

export type NotificationAction =
    | { type: 'external'; url: string }
    | { type: 'internal'; path: string }
    | null;

export interface Notification {
    id: number;
    icon: string;
    title: string;
    text: string;
    action_type: string | null;
    action_url: string | null;
    read: boolean;
    created_at: string;
}

export function toAction(action_type: string | null, action_url: string | null): NotificationAction {
    if (!action_type || !action_url) return null;
    if (action_type === 'external') return { type: 'external', url: action_url };
    if (action_type === 'internal') return { type: 'internal', path: action_url };
    return null;
}

function buildWsUrl(): string {
    const token = localStorage.getItem('access_token') ?? '';
    const accountStoreName = getConfig<string>('accounts.accountStore', 'sessionStorage')!;
    const accountStore = accountStoreName === 'localStorage' ? localStorage : sessionStorage;
    const accountToken = accountStore.getItem('account_token') ?? '';
    const wsBase = (getConfig<string>('api.terminalUrl') ?? `ws://${location.hostname}:8224`).replace(/\/$/, '');
    return `${wsBase}/api/notifications/ws?token=${encodeURIComponent(token)}&account_token=${encodeURIComponent(accountToken)}`;
}

export interface UseNotificationsResult {
    notifications: Notification[];
    unreadCount: number;
    unreadDisplay: string;
    deleteNotification: (id: number) => void;
    markRead: (id: number) => void;
    connected: boolean;
    toastQueue: Notification[];
    dismissToast: (id: number) => void;
    refreshNotifications: () => void;
}

export function useNotifications(): UseNotificationsResult {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [unreadDisplay, setUnreadDisplay] = useState('0');
    const [connected, setConnected] = useState(false);
    const [toastQueue, setToastQueue] = useState<Notification[]>([]);
    const [refreshKey, setRefreshKey] = useState(0);
    const wsRef = useRef<WebSocket | null>(null);

    const applyUnread = (count: number, display: string) => {
        setUnreadCount(count);
        setUnreadDisplay(display);
    };

    useEffect(() => {
        let ws: WebSocket;
        let reconnectTimeout: ReturnType<typeof setTimeout>;
        let cancelled = false;

        const connect = () => {
            if (cancelled) return;
            ws = new WebSocket(buildWsUrl());
            wsRef.current = ws;

            ws.onopen = () => {
                if (!cancelled) setConnected(true);
            };

            ws.onmessage = (e) => {
                if (cancelled) return;
                const msg = JSON.parse(e.data);

                if (msg.type === 'init') {
                    setNotifications(msg.notifications ?? []);
                    applyUnread(msg.unread_count ?? 0, msg.unread_display ?? '0');
                } else if (msg.type === 'notification') {
                    setNotifications(prev => [msg.data, ...prev]);
                    setToastQueue(prev => [...prev, msg.data]);
                    applyUnread(msg.unread_count ?? 0, msg.unread_display ?? '0');
                } else if (msg.type === 'deleted') {
                    setNotifications(prev => prev.filter(n => n.id !== msg.id));
                    applyUnread(msg.unread_count ?? 0, msg.unread_display ?? '0');
                } else if (msg.type === 'read') {
                    setNotifications(prev =>
                        prev.map(n => n.id === msg.id ? { ...n, read: true } : n)
                    );
                    applyUnread(msg.unread_count ?? 0, msg.unread_display ?? '0');
                } else if (msg.type === 'frontend_event') {
                    window.dispatchEvent(new CustomEvent('omniplayr:frontend-event', {
                        detail: {
                            event: msg.event,
                            data: msg.data ?? {},
                        },
                    }));
                }
            };

            ws.onclose = () => {
                if (cancelled) return;
                setConnected(false);
                reconnectTimeout = setTimeout(connect, 3000);
            };

            ws.onerror = () => ws.close();
        };

        connect();

        return () => {
            cancelled = true;
            clearTimeout(reconnectTimeout);
            if (!ws) return;

            if (ws.readyState === WebSocket.CONNECTING) {
                ws.onmessage = null;
                ws.onerror = null;
                ws.onclose = null;
                ws.onopen = () => ws.close();
            } else {
                ws.close();
            }
        };
    }, [refreshKey]);

    const deleteNotification = useCallback((id: number) => {
        wsRef.current?.send(JSON.stringify({ action: 'delete', id }));
        setNotifications(prev => prev.filter(n => n.id !== id));
    }, []);

    const markRead = useCallback((id: number) => {
        wsRef.current?.send(JSON.stringify({ action: 'read', id }));
    }, []);

    const dismissToast = useCallback((id: number) => {
        setToastQueue(prev => prev.filter(n => n.id !== id));
    }, []);

    const refreshNotifications = useCallback(() => {
        setRefreshKey(k => k + 1);
    }, []);

    return { notifications, unreadCount, unreadDisplay, deleteNotification, markRead, connected, toastQueue, dismissToast, refreshNotifications };
}
