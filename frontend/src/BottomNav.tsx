import './styles/BottomNav.css';
import { Menu, House, Settings, X, Bell } from 'lucide-react';
import { useNotificationsContext } from './modules/NotificationsContext';

interface BottomNavProps {
    onMenuToggle: () => void;
    onHome: () => void;
    onSettings: () => void;
    onNotifications: () => void;
    activeTabId: string | null;
    isMenuOpen: boolean;
    settingsBadgeCount?: number;
}

function BottomNav({ onMenuToggle, onHome, onSettings, onNotifications, activeTabId, isMenuOpen, settingsBadgeCount }: BottomNavProps) {
    const { unreadCount, unreadDisplay } = useNotificationsContext();

    return (
        <nav className="bottom-nav">
            <div className="bottom-nav-item" onClick={onMenuToggle}>
                {isMenuOpen ? (
                    <X className="bottom-nav-icon" />
                ) : (
                    <Menu className="bottom-nav-icon" />
                )}
            </div>

            <div
                className={`bottom-nav-item${activeTabId === null ? ' active' : ''}`}
                onClick={onHome}
            >
                <House className="bottom-nav-icon" />
            </div>

            <div
                className={`bottom-nav-item${activeTabId === '__mobile_notifications' ? ' active' : ''}`}
                onClick={onNotifications}
            >
                <Bell className="bottom-nav-icon" />
                {unreadCount > 0 && <span className="notification-badge">{unreadDisplay}</span>}
            </div>

            <div className={`bottom-nav-item${activeTabId === '__settings' ? ' active' : ''}`} onClick={onSettings}>
                <Settings className="bottom-nav-icon" />
                {(settingsBadgeCount ?? 0) > 0 && (
                    <span className="update-badge">
                        {(settingsBadgeCount ?? 0) > 9 ? "9+" : settingsBadgeCount}
                    </span>
                )}
            </div>
        </nav>
    );
}

export default BottomNav;