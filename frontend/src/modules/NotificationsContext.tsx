import { createContext, useContext, type ReactNode } from 'react';
import { useNotifications, type UseNotificationsResult } from './useNotifications';
import { NotificationToastManager } from '../NotificationToast';

const NotificationsContext = createContext<UseNotificationsResult | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
    const value = useNotifications();
    return (
        <NotificationsContext.Provider value={value}>
            {children}
            <NotificationToastManager toasts={value.toastQueue} onDismiss={value.dismissToast} />
        </NotificationsContext.Provider>
    );
}

export function useNotificationsContext(): UseNotificationsResult {
    const ctx = useContext(NotificationsContext);
    if (!ctx) throw new Error('useNotificationsContext must be used within NotificationsProvider');
    return ctx;
}