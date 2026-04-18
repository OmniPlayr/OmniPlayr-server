import { useEffect, useRef, useState } from 'react';
import './styles/Player.css';
import { Shuffle, SkipBack, SkipForward, Play, Pause, Loader, Repeat, Music, Volume, Volume2, VolumeX, Volume1 } from 'lucide-react';
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
                ref={(el) => {
                    if (el) onColorChange(null);
                }}
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

function Player() {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [metadata, setMetadata] = useState<TrackMetadata | null>(null);
    const [accentColor, setAccentColor] = useState<string | null>(null);

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
        const onMouseMove = (e: MouseEvent) => {
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

        const onMouseUp = () => {
            if (isDragging.current) {
                isDragging.current = false;
                player.seek(dragFraction.current);
            }
            isVolumeDragging.current = false;
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        return () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
    }, [duration]);

    const handleProgressMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!progressBarRef.current) return;
        const rect = progressBarRef.current.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        isDragging.current = true;
        dragFraction.current = frac;
        setDisplayProgress(frac);
        setDisplayTime(frac * duration);
    };

    const handleVolumeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!volumeSliderRef.current) return;
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
                        onMouseDown={handleProgressMouseDown}
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
                        onMouseDown={handleVolumeMouseDown}
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

export default Player;