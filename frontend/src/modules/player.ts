import { getConfig } from './config';

type PlayerListener = () => void;

export interface TrackMetadata {
    title: string | null;
    artist: string | null;
    album: string | null;
    album_art: string | null;
    duration: number | null;
    genre: string | null;
    year: string | null;
}

class AudioPlayer {
    private audio = new Audio();
    private listeners = new Set<PlayerListener>();
    private currentBlobUrl: string | null = null;

    isLoading = false;
    currentSongId: string | null = null;
    currentSourceType: string | null = null;
    currentMetadata: TrackMetadata | null = null;

    constructor() {
        for (const event of ['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata', 'waiting', 'playing']) {
            this.audio.addEventListener(event, () => this.notify());
        }
    }

    subscribe(cb: PlayerListener): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    private notify() {
        this.listeners.forEach(cb => cb());
    }

    async playSong(songId: string, sourceType: string) {
        const token = localStorage.getItem('access_token');
        if (!token) throw new Error('No access token');

        this.isLoading = true;
        this.currentSongId = songId;
        this.currentSourceType = sourceType;
        this.currentMetadata = null;
        this.notify();

        try {
            const baseUrl = getConfig<string>('api.apiUrl') ?? '';
            const headers = { Authorization: `Bearer ${token}` };
            const encoded = encodeURIComponent(songId);

            const [metaRes, streamRes] = await Promise.all([
                fetch(`${baseUrl}/api/player/media/${sourceType}:${encoded}`, { headers }),
                fetch(`${baseUrl}/api/player/stream/${sourceType}:${encoded}`, { headers }),
            ]);

            if (!metaRes.ok) throw new Error(`Metadata fetch failed: ${metaRes.status}`);
            if (!streamRes.ok) throw new Error(`Stream fetch failed: ${streamRes.status}`);

            const metaJson = await metaRes.json();
            this.currentMetadata = metaJson.metadata as TrackMetadata;
            this.notify();

            const blob = await streamRes.blob();
            if (this.currentBlobUrl) URL.revokeObjectURL(this.currentBlobUrl);
            this.currentBlobUrl = URL.createObjectURL(blob);
            this.audio.src = this.currentBlobUrl;
            this.isLoading = false;
            this.notify();

            await this.audio.play();
        } catch (e) {
            this.isLoading = false;
            this.notify();
            throw e;
        }
    }

    togglePlay() {
        if (!this.audio.src) return;
        this.audio.paused ? this.audio.play() : this.audio.pause();
    }

    seek(fraction: number) {
        if (!this.audio.duration) return;
        this.audio.currentTime = this.audio.duration * Math.max(0, Math.min(1, fraction));
    }

    setVolume(fraction: number) { this.audio.volume = Math.max(0, Math.min(1, fraction)); }

    get isPlaying() { return !this.audio.paused && !this.audio.ended; }
    get currentTime() { return this.audio.currentTime; }
    get duration() { return this.audio.duration || 0; }
    get hasTrack() { return !!this.currentSongId; }
    get volume() { return this.audio.volume; }
}

export const player = new AudioPlayer();

export function playSong(songId: string, sourceType: string) {
    return player.playSong(songId, sourceType);
}

playSong('BABY BOY (clip).m4a', 'mp3');
player.setVolume(0);