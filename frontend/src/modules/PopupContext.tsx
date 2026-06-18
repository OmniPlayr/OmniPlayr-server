import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
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
    group?: string;
    navigationIndex?: number;
}

interface PopupEntry {
    root: Root;
    container: HTMLDivElement;
    group?: string;
    transitionTo: (popup: Popup) => void;
    transitionBack: () => void;
}

const popupRoots = new Map<string, PopupEntry>();

function PopupSlideContent({ popup, dismiss, goBack, canGoBack, isMobile }: {
    popup: Popup;
    dismiss: () => void;
    goBack: () => void;
    canGoBack: boolean;
    isMobile: boolean;
}) {
    const subtitles = Array.isArray(popup.subtitle) ? popup.subtitle : popup.subtitle ? [popup.subtitle] : [];

    return (
        <React.Fragment>
            <div className='op-popup-header'>
                {popup.close_button && popup.mobileFullscreen && isMobile && (
                    <ChevronLeft className='op-popup-close-button' onClick={canGoBack ? goBack : dismiss} />
                )}
                <div className='op-popup-title-content'>
                    <p className='op-popup-title'>{popup.title}</p>
                    {subtitles.map((s, i) => <p key={i} className='op-popup-subtitle'>{s}</p>)}
                </div>
                {popup.close_button && (!popup.mobileFullscreen || !isMobile) && (
                    <X className='op-popup-close-button' onClick={dismiss} />
                )}
            </div>
            {popup.content && <div className='op-popup-body'>{popup.content}</div>}
            {popup.buttons && popup.buttons.length > 0 && (
                <div className='op-popup-footer'>
                    {popup.buttons.map(button => (
                        <button
                            key={button.label}
                            className={`op-popup-button ${button.type}`}
                            data-type={button.type}
                            onClick={button.onClick}
                        >
                            {button.label}
                        </button>
                    ))}
                </div>
            )}
        </React.Fragment>
    );
}

type TransitionDirection = 'forward' | 'backward';

function PopupComponent({
    popup: initialPopup,
    onDismiss,
    onMount,
    onTransitioned,
}: {
    popup: Popup;
    onDismiss: () => void;
    onMount: (transitionTo: (popup: Popup) => void, transitionBack: () => void) => void;
    onTransitioned: (oldId: string, newId: string) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const heightRef = useRef<HTMLDivElement>(null);
    const slidesRef = useRef<HTMLDivElement>(null);
    const currentSlideRef = useRef<HTMLDivElement>(null);
    const nextSlideRef = useRef<HTMLDivElement>(null);

    const [currentPopup, setCurrentPopup] = useState(initialPopup);
    const [nextPopup, setNextPopup] = useState<Popup | null>(null);
    const [direction, setDirection] = useState<TransitionDirection>('forward');
    const [popupId, setPopupId] = useState(initialPopup.id);
    const [history, setHistory] = useState<Popup[]>([]);

    const isTransitioning = useRef(false);
    const isClosing = useRef(false);
    const isMobile = useIsMobile();

    const dragStart = useRef(0);
    const dragDelta = useRef(0);
    const isDragging = useRef(false);

    const currentPopupRef = useRef(currentPopup);
    currentPopupRef.current = currentPopup;

    const directionRef = useRef<TransitionDirection>('forward');

    function dismiss() {
        if (isClosing.current) return;
        isClosing.current = true;
        if (ref.current) ref.current.classList.add('closing');
        if (contentRef.current && isMobile) {
            contentRef.current.style.animation = 'none';
            contentRef.current.style.transition = 'transform 0.3s ease';
            contentRef.current.style.transform = currentPopupRef.current.mobileFullscreen
                ? 'translate3d(100%, 0, 0)'
                : 'translate3d(0, 100%, 0)';
        }
        currentPopupRef.current.onClose?.();
        setTimeout(onDismiss, 300);
    }

    const dismissRef = useRef(dismiss);
    dismissRef.current = dismiss;

    useLayoutEffect(() => {
        if (!nextPopup || !slidesRef.current || !contentRef.current) return;

        const slides = slidesRef.current;
        const content = contentRef.current;
        const oldId = currentPopup.id;
        const isBackward = directionRef.current === 'backward';

        const fromHeight = currentSlideRef.current?.offsetHeight ?? content.offsetHeight;
        const toHeight = nextSlideRef.current?.offsetHeight ?? fromHeight;
        const tallest = Math.max(fromHeight, toHeight, parseFloat(content.style.height) || 0);

        content.style.height = `${tallest}px`;

        if (isBackward) {
            slides.style.transition = 'none';
            slides.style.transform = 'translateX(-100%)';
        }

        requestAnimationFrame(() => {
            slides.style.transition = 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)';
            slides.style.transform = isBackward ? 'translateX(0)' : 'translateX(-100%)';
        });

        const timer = setTimeout(() => {
            slides.style.transition = 'none';
            slides.style.transform = 'translateX(0)';
            setCurrentPopup(nextPopup);
            setNextPopup(null);
            setDirection('forward');
            setPopupId(nextPopup.id);
            isTransitioning.current = false;
            onTransitioned(oldId, nextPopup.id);
        }, 350);

        return () => clearTimeout(timer);
    }, [nextPopup]);

    function transitionTo(popup: Popup) {
        if (isTransitioning.current || isClosing.current) return;
        isTransitioning.current = true;
        const currentIndex = currentPopupRef.current.navigationIndex ?? 0;
        const nextIndex = popup.navigationIndex ?? 0;
        const dir: TransitionDirection = nextIndex < currentIndex ? 'backward' : 'forward';
        directionRef.current = dir;
        setDirection(dir);
        setHistory(prev => [...prev, currentPopupRef.current]);
        setNextPopup(popup);
    }

    function transitionBack() {
        if (isTransitioning.current || isClosing.current) return;
        setHistory(prev => {
            if (prev.length === 0) return prev;
            const previous = prev[prev.length - 1];
            const newHistory = prev.slice(0, -1);
            isTransitioning.current = true;
            directionRef.current = 'backward';
            setDirection('backward');
            setNextPopup(previous);
            return newHistory;
        });
    }

    const transitionToRef = useRef(transitionTo);
    transitionToRef.current = transitionTo;

    const transitionBackRef = useRef(transitionBack);
    transitionBackRef.current = transitionBack;

    useEffect(() => {
        onMount(
            (popup) => transitionToRef.current(popup),
            () => transitionBackRef.current(),
        );
    }, []);

    function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
        if (!isMobile) return;
        const target = e.target as HTMLElement;
        if (target.closest('.op-popup-button') || target.closest('.op-popup-close-button')) return;
        isDragging.current = true;
        dragDelta.current = 0;
        dragStart.current = currentPopupRef.current.mobileFullscreen ? e.clientX : e.clientY;
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
        const delta = currentPopupRef.current.mobileFullscreen
            ? Math.max(0, e.clientX - dragStart.current)
            : Math.max(0, e.clientY - dragStart.current);
        dragDelta.current = delta;
        contentRef.current.style.transform = currentPopupRef.current.mobileFullscreen
            ? `translate3d(${delta}px, 0, 0)`
            : `translate3d(0, ${delta}px, 0)`;
    }

    function handlePointerUp() {
        if (!isMobile || !isDragging.current || !contentRef.current) return;
        isDragging.current = false;
        const threshold = currentPopupRef.current.mobileFullscreen
            ? window.innerWidth * 0.28
            : window.innerHeight * 0.28;

        if (dragDelta.current > threshold) {
            isClosing.current = true;
            contentRef.current.style.transition = 'transform 0.38s cubic-bezier(0.4, 0, 0.2, 1)';
            contentRef.current.style.transform = currentPopupRef.current.mobileFullscreen
                ? 'translate3d(100%, 0, 0)'
                : 'translate3d(0, 100%, 0)';
            currentPopupRef.current.onClose?.();
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
            if (isClosing.current || !contentRef.current) return;
            if (!contentRef.current.contains(e.target as Node)) {
                dismissRef.current();
            }
        }

        document.addEventListener("pointerdown", handleOutside);
        return () => document.removeEventListener("pointerdown", handleOutside);
    }, []);

    const canGoBack = history.length > 0;

    const nextIsBackward = direction === 'backward';

    return (
        <div
            className={'op-popup' + (currentPopup.mobileFullscreen && isMobile ? ' mobile-fullscreen' : '')}
            data-id={popupId}
            ref={ref}
            onClick={dismiss}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        >
            <div className='op-popup-content' ref={contentRef} onClick={e => e.stopPropagation()}>
                <div style={{ overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div ref={slidesRef} style={{ display: 'flex', flex: 1 }}>
                        {nextIsBackward && nextPopup && (
                            <div ref={nextSlideRef} style={{ flex: '0 0 100%', display: 'flex', flexDirection: 'column' }}>
                                <PopupSlideContent
                                    popup={nextPopup}
                                    dismiss={dismiss}
                                    goBack={transitionBack}
                                    canGoBack={history.length > 1}
                                    isMobile={isMobile}
                                />
                            </div>
                        )}
                        <div ref={currentSlideRef} style={{ flex: '0 0 100%', display: 'flex', flexDirection: 'column' }}>
                            <PopupSlideContent
                                popup={currentPopup}
                                dismiss={dismiss}
                                goBack={transitionBack}
                                canGoBack={canGoBack}
                                isMobile={isMobile}
                            />
                        </div>
                        {!nextIsBackward && nextPopup && (
                            <div ref={nextSlideRef} style={{ flex: '0 0 100%', display: 'flex', flexDirection: 'column' }}>
                                <PopupSlideContent
                                    popup={nextPopup}
                                    dismiss={dismiss}
                                    goBack={transitionBack}
                                    canGoBack={true}
                                    isMobile={isMobile}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function createPopup(popup: Popup) {
    if (popup.group) {
        for (const [, entry] of popupRoots) {
            if (entry.group === popup.group) {
                entry.transitionTo(popup);
                return;
            }
        }
    }

    const container = document.createElement('div');
    container.className = 'op-popup-container';

    const dashboardHor = document.querySelector('.dashboard-hor');
    (dashboardHor ?? document.body).appendChild(container);

    const root = createRoot(container);

    const currentIdRef = { value: popup.id };

    const entry: PopupEntry = {
        root,
        container,
        group: popup.group,
        transitionTo: () => {},
        transitionBack: () => {},
    };
    popupRoots.set(popup.id, entry);

    root.render(
        <PopupComponent
            popup={popup}
            onDismiss={() => {
                root.unmount();
                container.remove();
                popupRoots.delete(currentIdRef.value);
            }}
            onMount={(transitionTo, transitionBack) => {
                entry.transitionTo = transitionTo;
                entry.transitionBack = transitionBack;
            }}
            onTransitioned={(oldId, newId) => {
                popupRoots.delete(oldId);
                popupRoots.set(newId, entry);
                currentIdRef.value = newId;
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

function goBackPopup(id: string) {
    const entry = popupRoots.get(id);
    if (!entry) return;
    entry.transitionBack();
}

export { createPopup, closePopup, goBackPopup };
export type { Popup, PopupButton };