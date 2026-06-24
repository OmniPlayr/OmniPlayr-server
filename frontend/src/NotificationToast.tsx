import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as LucideIcons from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import type { ComponentType } from 'react';
import { toAction, type Notification } from './modules/useNotifications';

const TOAST_DURATION = 4000;
const EXIT_DURATION = 320;

function resolveIcon(name: string): ComponentType<LucideProps> | null {
    const icon = (LucideIcons as unknown as Record<string, unknown>)[name];
    if (icon != null && (typeof icon === 'function' || typeof icon === 'object')) {
        return icon as ComponentType<LucideProps>;
    }
    return null;
}

function stripTags(text: string): string {
    return text
        .replace(/<highlight>(.*?)<\/highlight>/g, '$1')
        .replace(/<link href=".*?">(.*?)<\/link>/g, '$1');
}

interface ToastItemProps {
    notification: Notification;
    onDismiss: () => void;
}

function ToastItem({ notification, onDismiss }: ToastItemProps) {
    const navigate = useNavigate();
    const [exiting, setExiting] = useState(false);

    const dismiss = useCallback(() => {
        if (exiting) return;
        setExiting(true);
        setTimeout(onDismiss, EXIT_DURATION);
    }, [exiting, onDismiss]);

    useEffect(() => {
        const t = setTimeout(dismiss, TOAST_DURATION);
        return () => clearTimeout(t);
    }, []);

    const handleClick = () => {
        dismiss();
        const action = toAction(notification.action_type, notification.action_url);
        if (action?.type === 'internal') {
            navigate(action.path);
            return;
        }
        if (action?.type === 'external') {
            window.open(action.url, '_blank', 'noreferrer');
            return;
        }
        navigate(`/notifications?highlight=${notification.id}`);
    };

    const IconComponent = resolveIcon(notification.icon);

    return (
        <div
            className={`notification-toast${exiting ? ' notification-toast-exit' : ''}`}
            onClick={handleClick}
        >
            {IconComponent && <IconComponent className="notification-toast-icon" />}
            <div className="notification-toast-content">
                <p className="notification-toast-title">{notification.title}</p>
                <p className="notification-toast-text">{stripTags(notification.text)}</p>
            </div>
        </div>
    );
}

interface NotificationToastManagerProps {
    toasts: Notification[];
    onDismiss: (id: number) => void;
}

export function NotificationToastManager({ toasts, onDismiss }: NotificationToastManagerProps) {
    return (
        <div className="notification-toast-container">
            {toasts.map(t => (
                <ToastItem key={t.id} notification={t} onDismiss={() => onDismiss(t.id)} />
            ))}
        </div>
    );
}
