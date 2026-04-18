import { ChevronLeft, ChevronRight, Menu, X } from "lucide-react"
import "./styles/Header.css"

interface HeaderProps {
    canGoBack: boolean;
    canGoForward: boolean;
    onBack: () => void;
    onForward: () => void;
    onMenuToggle?: () => void;
    isMobile?: boolean;
    sidebarOpen?: boolean;
}

function Header({ canGoBack, canGoForward, onBack, onForward, onMenuToggle, isMobile, sidebarOpen }: HeaderProps) {
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
        </div>
    )
}

export default Header