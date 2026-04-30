interface NotificationBadgeProps {
    display: string;
    count: number;
}

export function NotificationBadge({ display, count }: NotificationBadgeProps) {
    if (count === 0) return null;
    return <span className="notification-badge">{display}</span>;
}