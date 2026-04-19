import { useEffect, useRef, useState } from 'react';
import './styles/Player.css';
import {
    Shuffle, SkipBack, SkipForward, Play, Pause, Loader,
    Repeat, Music, Volume, Volume2, VolumeX, Volume1, ChevronDown
} from 'lucide-react';
import { player, type TrackMetadata } from './modules/player';
import { usePlugins } from './modules/usePlugins';

function formatTime(seconds: number): string {
    if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function VolumeIcon({ volume, onClick }: { volume: number; onClick?: () => void }) {
    if (volume === 0) return <VolumeX className="option-icon" onClick={onClick} />;
    if (volume < 0.33) return <Volume className="option-icon" onClick={onClick} />;
    if (volume < 0.66) return <Volume1 className="option-icon" onClick={onClick} />;
    return <Volume2 className="option-icon" onClick={onClick} />;
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

function AlbumArt({
    metadata,
    onColorChange,
}: {
    metadata: TrackMetadata | {} | null;
    onColorChange: (color: string | null) => void;
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
                <Music size={22} />
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

function useIsMobile() {
    const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
    useEffect(() => {
        const mq = window.matchMedia('(max-width: 768px)');
        const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);
    return isMobile;
}

function Player() {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [metadata, setMetadata] = useState<TrackMetadata | null>(null);
    const [accentColor, setAccentColor] = useState<string | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const isMobile = useIsMobile();

    const [displayProgress, setDisplayProgress] = useState(0);
    const [displayTime, setDisplayTime] = useState(0);
    const [displayVolume, setDisplayVolume] = useState(player.volume);

    const progressBarRef = useRef<HTMLDivElement>(null);
    const isDragging = useRef(false);
    const dragFraction = useRef(0);

    const volumeSliderRef = useRef<HTMLDivElement>(null);
    const isVolumeDragging = useRef(false);
    const volumeDragFrac = useRef(player.volume);

    const prevVolume = useRef(player.volume > 0 ? player.volume : 1);

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

            if (!isDragging.current) {
                const frac = player.duration > 0 ? player.currentTime / player.duration : 0;
                setDisplayProgress(frac);
                setDisplayTime(player.currentTime);
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
            setDisplayVolume(0);
            player.setVolume(0);
        } else {
            setDisplayVolume(prevVolume.current);
            player.setVolume(prevVolume.current);
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
            ? `linear-gradient(to bottom, ${accentColor} 0%, #0c0c0c 65%)`
            : '#0c0c0c';

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
                    <AlbumArt metadata={metadata} onColorChange={setAccentColor} />
                    <div className="player-mini-info">
                        {metadata?.title && (
                            <span className="player-mini-title">{metadata.title}</span>
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
                    className={`player-fullscreen${isFullscreen ? ' active' : ''}`}
                    style={{ background: fullscreenBg }}
                    data-component="Player-Fullscreen"
                    data-playing-id={player.currentSongId}
                    data-source-type={player.currentSourceType}
                >
                    <div
                        className="player-fullscreen-close"
                        onClick={() => setIsFullscreen(false)}
                    >
                        <ChevronDown size={30} />
                    </div>

                    <div className="player-fullscreen-art-area">
                        <AlbumArt metadata={metadata} onColorChange={setAccentColor} />
                    </div>

                    <div className="player-fullscreen-bottom">
                        <div className="player-fullscreen-info">
                            {metadata?.title && (
                                <span className="player-fullscreen-title">{metadata.title}</span>
                            )}
                            <span className="player-fullscreen-artist">
                                {[metadata?.artist, metadata?.album].filter(Boolean).join(' · ')}
                            </span>
                        </div>

                        <div className="player-fullscreen-empty-slot" />

                        <div className="player-fullscreen-controls">
                            <Shuffle className="fs-control-icon" />
                            <SkipBack className="fs-control-icon" />
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
                            <SkipForward className="fs-control-icon" />
                            <Repeat className="fs-control-icon" />
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
                {(metadata?.title || metadata?.artist) && (
                    <div className="player-track-info">
                        {metadata?.title && (
                            <span className="player-track-title">{metadata.title}</span>
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
                    <Shuffle className="control-option-icon" />
                    <SkipBack className="control-option-icon" />
                    <div className="control-option-icon play-option" onClick={() => player.togglePlay()}>
                        {isLoading
                            ? <Loader className="play-icon spinning" />
                            : isPlaying
                            ? <Pause className="play-icon" />
                            : <Play className="play-icon" />
                        }
                    </div>
                    <SkipForward className="control-option-icon" />
                    <Repeat className="control-option-icon" />
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

export { useIsMobile, Player };