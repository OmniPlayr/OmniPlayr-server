import { ChevronLeft, ChevronRight } from "lucide-react"
import "./styles/Header.css"

interface HeaderProps {
    canGoBack: boolean;
    canGoForward: boolean;
    onBack: () => void;
    onForward: () => void;
}

function Header({ canGoBack, canGoForward, onBack, onForward }: HeaderProps) {
    return (
        <>
        <div className="header">
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
        </>
    )
}

export default Header