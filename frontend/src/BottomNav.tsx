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
    updateAvailable?: boolean;
}

function BottomNav({ onMenuToggle, onHome, onSettings, onNotifications, activeTabId, isMenuOpen, updateAvailable }: BottomNavProps) {
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
                {updateAvailable && <span className="update-badge">1</span>}
            </div>
        </nav>
    );
}

export default BottomNav;