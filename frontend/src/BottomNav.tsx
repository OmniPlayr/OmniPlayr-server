import './styles/BottomNav.css';
import { Menu, House, Settings, X } from 'lucide-react';

interface BottomNavProps {
    onMenuToggle: () => void;
    onHome: () => void;
    onSettings: () => void;
    activeTabId: string | null;
    isMenuOpen: boolean;
    updateAvailable?: boolean;
}

function BottomNav({ onMenuToggle, onHome, onSettings, activeTabId, isMenuOpen, updateAvailable }: BottomNavProps) {
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
    
            <div className={`bottom-nav-item${activeTabId === '__settings' ? ' active' : ''}`} onClick={onSettings}>
                <Settings className="bottom-nav-icon" />
                {updateAvailable && <span className="update-badge">1</span>}
            </div>
        </nav>
    );
}

export default BottomNav;