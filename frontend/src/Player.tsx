import { useEffect, useRef, useState } from 'react';
import './styles/Player.css';
import {
    Shuffle, SkipBack, SkipForward, Play, Pause, Loader,
    Repeat, Repeat1, Music, Volume, Volume2, VolumeX, Volume1, ChevronDown
} from 'lucide-react';
import { player, type TrackMetadata, type RepeatMode } from './modules/player';
import { usePlugins } from './modules/usePlugins';
import { useIsMobile } from './main';

function formatTime(seconds: number): string {
    if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function VolumeIcon({ volume, onClick }: { volume: number; onClick?: () => void }) {
    if (volume <= 0.001) return <VolumeX className="option-icon" onClick={onClick} />;
    if (volume < 0.33) return <Volume className="option-icon" onClick={onClick} />;
    if (volume < 0.66) return <Volume1 className="option-icon" onClick={onClick} />;
    return <Volume2 className="option-icon" onClick={onClick} />;
}

function RepeatIcon({ mode, className, onClick }: { mode: RepeatMode; className?: string; onClick?: () => void }) {
    if (mode === 'one') return <Repeat1 className={className} onClick={onClick} />;
    return <Repeat className={className} onClick={onClick} />;
}

function extractAverageColor(img: HTMLImageElement): string {
    try {
        const canvas = document.createElement('canvas');
        const size = 32;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return 'transparent';
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
        }
        return `rgb(${Math.round(r / count)},${Math.round(g / count)},${Math.round(b / count)})`;
    } catch {
        return 'transparent';
    }
}

type AnalyserState = { analyser: AnalyserNode; data: Uint8Array };

function useAudioAnalyser() {
    const ref = useRef<AnalyserState | null>(null);

    useEffect(() => {
        const attempt = (): boolean => {
            if (ref.current) return true;
            const el =
                (player as any).audioElement ??
                (player as any).audio ??
                (player as any)._audio ??
                document.querySelector<HTMLAudioElement>('audio');
            if (!el) return false;
            try {
                const actx = new AudioContext();
                const analyser = actx.createAnalyser();
                analyser.fftSize = 128;
                analyser.smoothingTimeConstant = 0.82;
                actx.createMediaElementSource(el).connect(analyser);
                analyser.connect(actx.destination);
                ref.current = { analyser, data: new Uint8Array(analyser.frequencyBinCount) };
                return true;
            } catch {
                return false;
            }
        };

        if (!attempt()) {
            const id = setInterval(() => { if (attempt()) clearInterval(id); }, 800);
            return () => clearInterval(id);
        }
    }, []);

    return ref;
}

function VisualizerCanvas({ analyserRef }: { analyserRef: React.MutableRefObject<AnalyserState | null> }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rafRef = useRef<number>(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const S = 200;
        canvas.width = S;
        canvas.height = S;

        const cx = S / 2;
        const cy = S / 2;
        const BAR_COUNT = 44;
        const INNER_R = S * 0.19;
        const MAX_BAR = S * 0.27;

        let t = 0;

        const draw = () => {
            rafRef.current = requestAnimationFrame(draw);
            t += 0.016;
            ctx.clearRect(0, 0, S, S);

            const state = analyserRef.current;
            if (state) state.analyser.getByteFrequencyData(state.data as any);

            for (let i = 0; i < BAR_COUNT; i++) {
                const angle = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;

                let val: number;
                if (state && state.data.length > 0) {
                    const idx = Math.floor((i / BAR_COUNT) * state.data.length * 0.72);
                    val = state.data[idx] / 255;
                } else {
                    val = 0.08 + 0.09 * Math.sin(t * 2.2 + i * 0.44) + 0.04 * Math.sin(t * 1.1 + i * 0.9);
                }

                const barLen = val * MAX_BAR;
                const x1 = cx + Math.cos(angle) * INNER_R;
                const y1 = cy + Math.sin(angle) * INNER_R;
                const x2 = cx + Math.cos(angle) * (INNER_R + barLen);
                const y2 = cy + Math.sin(angle) * (INNER_R + barLen);

                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.strokeStyle = `rgba(185, 145, 255, ${0.35 + val * 0.65})`;
                ctx.lineWidth = 2.8;
                ctx.lineCap = 'round';
                ctx.stroke();
            }

            let bassVal: number;
            if (state && state.data.length > 1) {
                bassVal = (state.data[0] + state.data[1] + state.data[2]) / (255 * 3);
            } else {
                bassVal = 0.18 + 0.1 * Math.sin(t * 1.4);
            }

            const orbR = INNER_R * (0.78 + bassVal * 0.52);
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, orbR);
            grad.addColorStop(0, `rgba(235, 210, 255, ${0.88 + bassVal * 0.12})`);
            grad.addColorStop(0.45, `rgba(155, 105, 240, 0.72)`);
            grad.addColorStop(1, `rgba(90, 45, 195, 0)`);
            ctx.beginPath();
            ctx.arc(cx, cy, orbR, 0, Math.PI * 2);
            ctx.fillStyle = grad;
            ctx.fill();
        };

        draw();
        return () => cancelAnimationFrame(rafRef.current);
    }, []);

    return (
        <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', display: 'block', borderRadius: 'inherit' }}
        />
    );
}

function AlbumArt({
    metadata,
    onColorChange,
    analyserRef,
}: {
    metadata: TrackMetadata | {} | null;
    onColorChange: (color: string | null) => void;
    analyserRef?: React.MutableRefObject<AnalyserState | null>;
}) {
    const [valid, setValid] = useState(true);
    const src = (metadata as TrackMetadata)?.album_art ?? undefined;

    useEffect(() => {
        setValid(true);
    }, [src]);

    if (!src || !valid) {
        return (
            <div
                className="player-album-art-placeholder"
                ref={(el) => { if (el) onColorChange(null); }}
            >
                {analyserRef ? <VisualizerCanvas analyserRef={analyserRef} /> : <Music size={22} />}
            </div>
        );
    }

    return (
        <img
            className="player-album-art"
            src={src}
            alt="Album art"
            draggable={false}
            crossOrigin="anonymous"
            onLoad={(e) => {
                const color = extractAverageColor(e.currentTarget);
                onColorChange(color);
            }}
            onError={() => {
                setValid(false);
                onColorChange(null);
            }}
        />
    );
}


function Player() {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [metadata, setMetadata] = useState<TrackMetadata | null>(null);
    const [accentColor, setAccentColor] = useState<string | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [shuffle, setShuffle] = useState(false);
    const [repeat, setRepeat] = useState<RepeatMode>('off');
    const [hasPrev, setHasPrev] = useState(false);
    const [hasNext, setHasNext] = useState(false);
    const isMobile = useIsMobile();
    const analyserRef = useAudioAnalyser();

    const [displayProgress, setDisplayProgress] = useState(0);
    const [displayTime, setDisplayTime] = useState(0);
    const [displayVolume, setDisplayVolume] = useState(() => player.volumeFraction);

    const progressBarRef = useRef<HTMLDivElement>(null);
    const isDragging = useRef(false);
    const dragFraction = useRef(0);

    const volumeSliderRef = useRef<HTMLDivElement>(null);
    const isVolumeDragging = useRef(false);
    const volumeDragFrac = useRef(player.volumeFraction);

    const prevVolume = useRef(player.volumeFraction);

    const fsRef = useRef<HTMLDivElement>(null);
    const fsDragStart = useRef(0);
    const fsDragY = useRef(0);
    const fsScrollStart = useRef(0);
    const fsGestureMode = useRef<'pending' | 'scrolling' | 'closing' | null>(null);
    const fsIsDragging = useRef(false);
    const fsIsClosing = useRef(false);

    usePlugins();

    useEffect(() => {
        if (!isMobile && isFullscreen) setIsFullscreen(false);
    }, [isMobile, isFullscreen]);

    useEffect(() => {
        return player.subscribe(() => {
            setIsPlaying(player.isPlaying);
            setIsLoading(player.isLoading);
            setCurrentTime(player.currentTime);
            setDuration(player.duration);
            setMetadata(player.currentMetadata);
            setShuffle(player.shuffle);
            setRepeat(player.repeat);
            setHasPrev(player.hasPrev);
            setHasNext(player.hasNext);

            if (!isDragging.current) {
                const frac = player.duration > 0 ? player.currentTime / player.duration : 0;
                setDisplayProgress(frac);
                setDisplayTime(player.currentTime);
            }

            const activePlugin = (player as any).activePlugin;
            if (activePlugin?.getVolume) {
                const v = activePlugin.getVolume();
                if (!isVolumeDragging.current) {
                    setDisplayVolume(v);
                }
            } else if (!isVolumeDragging.current) {
                setDisplayVolume(player.volumeFraction);
            }
        });
    }, []);

    useEffect(() => {
        const onPointerMove = (e: PointerEvent) => {
            if (isDragging.current && progressBarRef.current) {
                const rect = progressBarRef.current.getBoundingClientRect();
                const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                dragFraction.current = frac;
                setDisplayProgress(frac);
                setDisplayTime(frac * duration);
            }

            if (isVolumeDragging.current && volumeSliderRef.current) {
                const rect = volumeSliderRef.current.getBoundingClientRect();
                const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                volumeDragFrac.current = frac;
                setDisplayVolume(frac);
                player.setVolume(frac);
            }
        };

        const onPointerUp = (e: PointerEvent) => {
            if (isDragging.current) {
                isDragging.current = false;
                player.seek(dragFraction.current);
            }

            if (progressBarRef.current?.hasPointerCapture(e.pointerId)) {
                progressBarRef.current.releasePointerCapture(e.pointerId);
            }

            if (volumeSliderRef.current?.hasPointerCapture(e.pointerId)) {
                volumeSliderRef.current.releasePointerCapture(e.pointerId);
            }

            isVolumeDragging.current = false;
        };

        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);

        return () => {
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', onPointerUp);
        };
    }, [duration]);

    useEffect(() => {
        if (!fsRef.current || fsIsClosing.current) return;
        fsRef.current.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
        fsRef.current.style.transform = isFullscreen ? 'translateY(0)' : 'translateY(100%)';
    }, [isFullscreen]);

    const handleFsPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        if (target.closest('.fs-progress-bar') || target.closest('.player-fullscreen-controls') || target.closest('.player-fullscreen-close') || target.closest('.fs-play-btn')) return;
        fsIsDragging.current = false;
        fsGestureMode.current = 'pending';
        fsDragStart.current = e.clientY;
        fsDragY.current = 0;
        fsScrollStart.current = e.currentTarget.scrollTop;
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const handleFsPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!fsRef.current || !fsGestureMode.current) return;

        const dy = e.clientY - fsDragStart.current;

        if (fsGestureMode.current === 'pending') {
            if (Math.abs(dy) <= 6) return;
            fsGestureMode.current = fsScrollStart.current <= 0 && dy > 0 ? 'closing' : 'scrolling';
            fsIsDragging.current = true;
        }

        if (fsGestureMode.current === 'scrolling') {
            e.currentTarget.scrollTop = fsScrollStart.current - dy;
            return;
        }

        fsRef.current.style.transition = 'none';
        fsDragY.current = Math.max(0, dy);
        fsRef.current.style.transform = `translateY(${fsDragY.current}px)`;
    };

    const handleFsPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }

        const wasClosing = fsGestureMode.current === 'closing';
        fsGestureMode.current = null;
        fsIsDragging.current = false;

        if (!wasClosing || !fsRef.current) return;

        const dy = fsDragY.current;
        if (dy > window.innerHeight * 0.28) {
            fsIsClosing.current = true;
            fsRef.current.style.transition = 'transform 0.38s cubic-bezier(0.4, 0, 0.2, 1)';
            fsRef.current.style.transform = 'translateY(100%)';
            setTimeout(() => {
                fsIsClosing.current = false;
                setIsFullscreen(false);
            }, 380);
        } else {
            fsRef.current.style.transition = 'transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)';
            fsRef.current.style.transform = 'translateY(0)';
        }
    };

    const handleProgressPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!progressBarRef.current) return;
        progressBarRef.current.setPointerCapture(e.pointerId);
        const rect = progressBarRef.current.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        isDragging.current = true;
        dragFraction.current = frac;
        setDisplayProgress(frac);
        setDisplayTime(frac * duration);
    };

    const handleVolumeMouseDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!volumeSliderRef.current) return;
        volumeSliderRef.current.setPointerCapture(e.pointerId);
        const rect = volumeSliderRef.current.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        isVolumeDragging.current = true;
        volumeDragFrac.current = frac;
        setDisplayVolume(frac);
        player.setVolume(frac);
    };

    const handleVolumeIconClick = () => {
        if (displayVolume > 0) {
            prevVolume.current = displayVolume;
            player.setVolume(0);
            setDisplayVolume(0);
        } else {
            player.setVolume(prevVolume.current);
            setDisplayVolume(prevVolume.current);
        }
    };

    const baseColor = accentColor?.startsWith('rgb(')
        ? accentColor.replace('rgb(', 'rgba(').replace(')', ', 0.35)')
        : accentColor;

    const artGradient = baseColor
        ? `linear-gradient(to right, ${baseColor} 0px, ${baseColor} 72px, transparent 260px)`
        : undefined;

    const artGradient2 = baseColor
        ? {
            backgroundImage: `linear-gradient(to right, ${baseColor} 0px, ${baseColor} 72px, transparent 260px)`,
            WebkitMaskImage: `linear-gradient(to top, black 0px, black 70%, transparent 100%)`
        }
        : undefined;

    if (isMobile) {
        if (!player.hasTrack) return null;

        const miniAccent = accentColor
            ? accentColor.replace('rgb(', 'rgba(').replace(')', ', 0.45)')
            : null;

        const miniStyle = miniAccent
            ? { background: `linear-gradient(to right, ${miniAccent} 0px, var(--clr-popup-a0) 220px)` }
            : undefined;

        const fullscreenBg = accentColor
            ? `linear-gradient(to bottom, ${accentColor} 0%, var(--clr-surface-a0) 65%)`
            : 'var(--clr-surface-a0)';

        return (
            <>
                <div
                    className="player-mini"
                    style={miniStyle}
                    onClick={() => setIsFullscreen(true)}
                    data-component="Player"
                    data-playing-id={player.currentSongId}
                    data-source-type={player.currentSourceType}
                >
                    <AlbumArt metadata={metadata} onColorChange={setAccentColor} analyserRef={analyserRef} />
                    <div className="player-mini-info">
                        {metadata?.title ? (
                            <span className="player-mini-title">{metadata.title}</span>
                        ) : (
                            <span className="player-mini-title">{metadata?.filename}</span>
                        )}
                        <span className="player-mini-artist">
                            {[metadata?.artist, metadata?.album].filter(Boolean).join(' · ')}
                        </span>
                    </div>
                    <div
                        className="player-mini-play"
                        onClick={(e) => { e.stopPropagation(); player.togglePlay(); }}
                    >
                        {isLoading
                            ? <Loader className="mini-play-icon mini-play-icon--spin" />
                            : isPlaying
                            ? <Pause className="mini-play-icon" />
                            : <Play className="mini-play-icon" />
                        }
                    </div>
                </div>
                <div
                    className="player-fullscreen"
                    ref={fsRef}
                    style={{ background: fullscreenBg }}
                    data-component="Player-Fullscreen"
                    data-playing-id={player.currentSongId}
                    data-source-type={player.currentSourceType}
                    onPointerDown={handleFsPointerDown}
                    onPointerMove={handleFsPointerMove}
                    onPointerUp={handleFsPointerUp}
                >
                    <div className='player-fullscreen-main'>
                        <div
                            className="player-fullscreen-close"
                            onClick={() => setIsFullscreen(false)}
                        >
                            <ChevronDown size={30} />
                        </div>

                        <div className="player-fullscreen-art-area">
                            <AlbumArt metadata={metadata} onColorChange={setAccentColor} analyserRef={analyserRef} />
                        </div>

                        <div className="player-fullscreen-bottom">
                            <div className="player-fullscreen-info">
                                {metadata?.title && (
                                    <span className="player-fullscreen-title">{metadata.title}</span>
                                ) || (
                                    <span className="player-fullscreen-title">{metadata?.filename}</span>
                                )}
                                <span className="player-fullscreen-artist">
                                    {[metadata?.artist, metadata?.album].filter(Boolean).join(' · ')}
                                </span>
                            </div>

                            <div className="player-fullscreen-empty-slot" />

                            <div className="player-fullscreen-controls">
                                <Shuffle
                                    className={`fs-control-icon${shuffle ? ' fs-control-icon--active' : ''}`}
                                    onClick={() => player.toggleShuffle()}
                                />
                                <SkipBack
                                    className={`fs-control-icon${!hasPrev ? ' fs-control-icon--disabled' : ''}`}
                                    onClick={() => player.prev()}
                                />
                                <div
                                    className="fs-play-btn"
                                    onClick={() => player.togglePlay()}
                                >
                                    {isLoading
                                        ? <Loader className="fs-play-icon fs-play-icon--spin" />
                                        : isPlaying
                                        ? <Pause className="fs-play-icon" />
                                        : <Play className="fs-play-icon" />
                                    }
                                </div>
                                <SkipForward
                                    className={`fs-control-icon${!hasNext && repeat === 'off' ? ' fs-control-icon--disabled' : ''}`}
                                    onClick={() => player.skip()}
                                />
                                <RepeatIcon
                                    mode={repeat}
                                    className={`fs-control-icon${repeat !== 'off' ? ' fs-control-icon--active' : ''}`}
                                    onClick={() => player.cycleRepeat()}
                                />
                            </div>

                            <div className="player-fullscreen-progress">
                                <div
                                    className="fs-progress-bar"
                                    ref={progressBarRef}
                                    onPointerDown={handleProgressPointerDown}
                                >
                                    <div
                                        className="fs-progress-fill"
                                        style={{ width: `${displayProgress * 100}%` }}
                                    />
                                </div>
                                <div className="fs-progress-times">
                                    <span>{formatTime(displayTime)}</span>
                                    <span>{formatTime(duration || currentTime)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </>
        );
    }

    return (
        <div
            className="player"
            data-component="Player"
            data-playing-id={player.currentSongId}
            data-source-type={player.currentSourceType}
            style={artGradient ? { backgroundImage: artGradient } : undefined}
        >
            <div className='player-song-gradient' style={artGradient ? { ...artGradient2 } : undefined}></div>
            <div className="player-song-info">
                <AlbumArt metadata={metadata} onColorChange={setAccentColor} />
                {(metadata?.title || metadata?.artist || metadata?.filename) && (
                    <div className="player-track-info">
                        {metadata?.title && (
                            <span className="player-track-title">{metadata.title}</span>
                        ) || (
                            <span className="player-track-title">{metadata?.filename}</span>
                        )}
                        <span className="player-track-artist">
                            {[metadata?.artist, metadata?.album].filter(Boolean).join(' · ')}
                        </span>
                    </div>
                )}
                <div className='player-empty-slot'></div>
            </div>

            <div className="player-controls">
                <div className="player-control-options">
                    <Shuffle
                        className={`control-option-icon${shuffle ? ' control-option-icon--active' : ''}`}
                        onClick={() => player.toggleShuffle()}
                    />
                    <SkipBack
                        className={`control-option-icon${!hasPrev ? ' control-option-icon--disabled' : ''}`}
                        onClick={() => player.prev()}
                    />
                    <div className="control-option-icon play-option" onClick={() => player.togglePlay()}>
                        {isLoading
                            ? <Loader className="play-icon spinning" />
                            : isPlaying
                            ? <Pause className="play-icon" />
                            : <Play className="play-icon" />
                        }
                    </div>
                    <SkipForward
                        className={`control-option-icon${!hasNext && repeat === 'off' ? ' control-option-icon--disabled' : ''}`}
                        onClick={() => player.skip()}
                    />
                    <RepeatIcon
                        mode={repeat}
                        className={`control-option-icon${repeat !== 'off' ? ' control-option-icon--active' : ''}`}
                        onClick={() => player.cycleRepeat()}
                    />
                </div>
                <div className="player-progress-bar">
                    <span className="progress-time">{formatTime(displayTime)}</span>
                    <div
                        className="progress-bar"
                        ref={progressBarRef}
                        onPointerDown={handleProgressPointerDown}
                    >
                        <div
                            className="progress-bar-fill"
                            style={{ width: `${displayProgress * 100}%` }}
                        />
                    </div>
                    <span className="progress-time">{formatTime(duration || currentTime)}</span>
                </div>
            </div>

            <div className="player-options">
                <div className='plugin-target-before-volume-option'></div>
                <div className="player-option">
                    <VolumeIcon volume={displayVolume} onClick={handleVolumeIconClick} />
                    <div
                        className="volume-slider"
                        ref={volumeSliderRef}
                        style={{ '--fill': displayVolume * 100 } as React.CSSProperties}
                        onPointerDown={handleVolumeMouseDown}
                    >
                        <div
                            className="volume-slider-fill"
                            style={{ width: `${displayVolume * 100}%` }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

export { Player };