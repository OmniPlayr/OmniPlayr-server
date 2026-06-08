import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { ChevronLeft, X } from "lucide-react";
import { useIsMobile } from "../main";

interface PopupButton {
    label: string;
    type: 'primary' | 'secondary' | 'danger';
    onClick: () => void;
}

interface Popup {
    id: string;
    title: string;
    subtitle?: string | string[];
    close_button: boolean;
    content?: React.ReactNode;
    buttons?: PopupButton[];
    onClose?: () => void;
    mobileFullscreen?: boolean;
}

const popupRoots = new Map<string, { root: Root; container: HTMLDivElement }>();

function PopupComponent({ popup, onDismiss }: { popup: Popup; onDismiss: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const subtitles = Array.isArray(popup.subtitle) ? popup.subtitle : popup.subtitle ? [popup.subtitle] : [];

    const dragStart = useRef(0);
    const dragDelta = useRef(0);
    const isDragging = useRef(false);
    const isClosing = useRef(false);
    const isMobile = useIsMobile();

    function dismiss() {
        if (isClosing.current) return;
        isClosing.current = true;
        if (ref.current) ref.current.classList.add('closing');
        if (contentRef.current && isMobile) {
            contentRef.current.style.animation = 'none';
            contentRef.current.style.transition = 'transform 0.3s ease';
            contentRef.current.style.transform = popup.mobileFullscreen
                ? 'translate3d(100%, 0, 0)'
                : 'translate3d(0, 100%, 0)';
        }
        popup.onClose?.();
        setTimeout(onDismiss, 300);
    }

    function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
        if (!isMobile) return;
        const target = e.target as HTMLElement;
        if (target.closest('.op-popup-button') || target.closest('.op-popup-close-button')) return;
        isDragging.current = true;
        dragDelta.current = 0;
        dragStart.current = popup.mobileFullscreen ? e.clientX : e.clientY;
        if (contentRef.current) {
            contentRef.current.style.animation = 'none';
            void contentRef.current.offsetHeight;
            contentRef.current.style.transition = 'none';
            contentRef.current.style.willChange = 'transform';
        }
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }

    function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
        if (!isMobile || !isDragging.current || !contentRef.current) return;
        const delta = popup.mobileFullscreen
            ? Math.max(0, e.clientX - dragStart.current)
            : Math.max(0, e.clientY - dragStart.current);
        dragDelta.current = delta;
        contentRef.current.style.transform = popup.mobileFullscreen
            ? `translate3d(${delta}px, 0, 0)`
            : `translate3d(0, ${delta}px, 0)`;
    }

    function handlePointerUp() {
        if (!isMobile || !isDragging.current || !contentRef.current) return;
        isDragging.current = false;
        const threshold = popup.mobileFullscreen
            ? window.innerWidth * 0.28
            : window.innerHeight * 0.28;

        if (dragDelta.current > threshold) {
            isClosing.current = true;
            contentRef.current.style.transition = 'transform 0.38s cubic-bezier(0.4, 0, 0.2, 1)';
            contentRef.current.style.transform = popup.mobileFullscreen
                ? 'translate3d(100%, 0, 0)'
                : 'translate3d(0, 100%, 0)';
            popup.onClose?.();
            setTimeout(onDismiss, 380);
        } else {
            contentRef.current.style.transition = 'transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)';
            contentRef.current.style.transform = 'translate3d(0, 0, 0)';
            contentRef.current.addEventListener('transitionend', () => {
                if (contentRef.current) contentRef.current.style.willChange = 'auto';
            }, { once: true });
        }
    }

    useEffect(() => {
        if (!isMobile) return;

        function handleOutside(e: PointerEvent) {
            if (isClosing.current) return;
            if (!contentRef.current) return;

            const target = e.target as Node;

            if (!contentRef.current.contains(target)) {
                dismiss();
            }
        }

        document.addEventListener("pointerdown", handleOutside);

        return () => {
            document.removeEventListener("pointerdown", handleOutside);
        };
    }, []);

    return (
        <div
            className={'op-popup' + (popup.mobileFullscreen && isMobile ? ' mobile-fullscreen' : '')}
            data-id={popup.id}
            ref={ref}
            onClick={dismiss}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        >
            <div className='op-popup-content' ref={contentRef} onClick={e => e.stopPropagation()}>
                <div className='op-popup-header'>
                    {popup.close_button && popup.mobileFullscreen && isMobile && <ChevronLeft className='op-popup-close-button' onClick={dismiss} />}
                    <div className='op-popup-title-content'>
                        <p className='op-popup-title'>{popup.title}</p>
                        {subtitles.map((s, i) => <p key={i} className='op-popup-subtitle'>{s}</p>)}
                    </div>
                    {popup.close_button && (!popup.mobileFullscreen || !isMobile) && <X className='op-popup-close-button' onClick={dismiss} />}
                </div>
                {popup.content && <div className='op-popup-body'>{popup.content}</div>}
                {popup.buttons && popup.buttons.length > 0 && (
                    <div className='op-popup-footer'>
                        {popup.buttons.map(button => (
                            <button key={button.label} className={`op-popup-button ${button.type}`} data-type={button.type} onClick={button.onClick}>
                                {button.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function createPopup(popup: Popup) {
    const container = document.createElement('div');
    container.className = 'op-popup-container';

    const dashboardHor = document.querySelector('.dashboard-hor');
    (dashboardHor ?? document.body).appendChild(container);

    const root = createRoot(container);
    popupRoots.set(popup.id, { root, container });

    root.render(
        <PopupComponent
            popup={popup}
            onDismiss={() => {
                root.unmount();
                container.remove();
                popupRoots.delete(popup.id);
            }}
        />
    );
}

function closePopup(id: string) {
    const entry = popupRoots.get(id);
    if (!entry) return;
    const el = entry.container.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
    if (el) el.classList.add('closing');
    setTimeout(() => {
        entry.root.unmount();
        entry.container.remove();
        popupRoots.delete(id);
    }, 300);
}

export { createPopup, closePopup };
export type { Popup, PopupButton };