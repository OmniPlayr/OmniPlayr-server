import './styles/BottomNav.css';
import { Menu, House, Settings } from 'lucide-react';

interface BottomNavProps {
    onMenuToggle: () => void;
    onHome: () => void;
    onSettings: () => void;
    activeTabId: string | null;
}

function BottomNav({ onMenuToggle, onHome, onSettings, activeTabId }: BottomNavProps) {
    return (
        <nav className="bottom-nav">
            <div className="bottom-nav-item" onClick={onMenuToggle}>
                <Menu className="bottom-nav-icon" />
            </div>
            <div
                className={`bottom-nav-item${activeTabId === null ? ' active' : ''}`}
                onClick={onHome}
            >
                <House className="bottom-nav-icon" />
            </div>
            <div
                className={`bottom-nav-item${activeTabId === '__settings' ? ' active' : ''}`}
                onClick={onSettings}
            >
                <Settings className="bottom-nav-icon" />
            </div>
        </nav>
    );
}

export default BottomNav;