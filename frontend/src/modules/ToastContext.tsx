import type { LucideProps } from 'lucide-react';
import { useEffect, useRef, type ComponentType } from 'react';
import { createRoot, type Root } from "react-dom/client";

interface Toast {
    id: string;
    message: string;
    duration: number;
    type: 'success' | 'error' | 'warning' | 'info';
    icon?: ComponentType<LucideProps>;
    dismissable?: boolean;
}

interface ToastEntry {
    root: Root;
    container: HTMLDivElement;
}

const toastQueue: Toast[] = [];
let activeToast: ToastEntry | null = null;

function ToastComponent({ toast: initialToast, onDismiss } : { toast: Toast; onDismiss: () => void }) {
    const ref = useRef<HTMLDivElement>(null);

    const dismiss = () => {
        if (!ref.current) return;
        ref.current.classList.add('closing');
        setTimeout(() => {
            if (!ref.current) return;
            ref.current.style.animation = 'none';
            ref.current.remove();
            onDismiss();
        }, 300);
    };

    useEffect(() => {
        if (initialToast.duration === -1) return;

        const timeout = setTimeout(dismiss, initialToast.duration);

        return () => clearTimeout(timeout);
    }, []);

    return (
        <div 
            className={`op-toast op-toast-${initialToast.type} ${initialToast.dismissable ? 'op-toast-dismissible' : ''}`}
            data-id={initialToast.id}
            data-duration={initialToast.duration}
            ref={ref}
            onClick={initialToast.dismissable ? dismiss : undefined}
        >
            <div className='op-toast-content'>
                { initialToast.icon && <initialToast.icon className="op-toast-icon" /> }
                <div className="op-toast-message">{initialToast.message}</div>
            </div>
        </div>
    )
}

function showNextToast() {
    if (activeToast || toastQueue.length === 0) return;

    const toast = toastQueue.shift()!;

    let container = document.querySelector('.op-toast-container') as HTMLDivElement | null;

    if (!container) {
        container = document.createElement('div');
        container.className = 'op-toast-container';

        const dashboardHor = document.querySelector('.dashboard-hor');
        (dashboardHor ?? document.body).appendChild(container);
    }

    const toastContainer = document.createElement('div');
    container.appendChild(toastContainer);

    const root = createRoot(toastContainer);

    activeToast = {
        root,
        container: toastContainer
    };

    root.render(
        <ToastComponent
            toast={toast}
            onDismiss={() => {
                if (!activeToast) return;

                activeToast.root.unmount();
                activeToast.container.remove();
                activeToast = null;

                showNextToast();
            }}
        />
    );
}

function createToast(toast: Toast) {
    toastQueue.push(toast);
    showNextToast();
}

export { createToast };