import { getConfig } from './config';
import { getAccount } from './account';

type PlayerListener = () => void;

type TrackChangeListener = (songId: string | null, sourceType: string | null) => void;

export interface TrackMetadata {
    title: string | null;
    artist: string | null;
    album: string | null;
    album_art: string | null;
    duration: number | null;
    genre: string | null;
    year: string | null;
    filename: string | null;
}

class AudioPlayer {
    
    private audio = new Audio();
    private listeners = new Set<PlayerListener>();

    private ctx: AudioContext | null = null;
    private gainNode: GainNode | null = null;
    private sourceNode: MediaElementAudioSourceNode | null = null;

    private queue: { songId: string; sourceType: string }[] = [];
    private isTransitioning = false;

    private currentBlobUrl: string | null = null;
    
    private trackListeners = new Set<TrackChangeListener>();

    isLoading = false;
    currentSongId: string | null = null;
    currentSourceType: string | null = null;
    currentMetadata: TrackMetadata | null = null;

    constructor() {
        for (const event of ['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata', 'waiting', 'playing']) {
            this.audio.addEventListener(event, () => this.notify());
        }

        this.audio.addEventListener('ended', () => {
            this.nextInQueue();
        });

        this.initAudioGraph();
    }

    private initAudioGraph() {
        this.ctx = new AudioContext();
        this.gainNode = this.ctx.createGain();
        this.sourceNode = this.ctx.createMediaElementSource(this.audio);

        this.sourceNode.connect(this.gainNode);
        this.gainNode.connect(this.ctx.destination);

        this.gainNode.gain.value = 1;
    }

    subscribe(cb: PlayerListener): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    private notify() {
        this.listeners.forEach(cb => cb());
    }

    private async nextInQueue() {
        if (this.isTransitioning) return;
        const next = this.queue.shift();
        if (!next) return;
        await this.playSong(next.songId, next.sourceType);
    }

    addToQueue(songId: string, sourceType: string) {
        this.queue.push({ songId, sourceType });

        if (!this.currentSongId && !this.isTransitioning) {
            const next = this.queue.shift();
            if (next) {
                this.playSong(next.songId, next.sourceType);
            }
        }
    }

    async playSong(songId: string, sourceType: string) {
        const token = localStorage.getItem('access_token');
        if (!token) throw new Error('No access token');

        this.isTransitioning = true;

        this.isLoading = true;
        this.currentSongId = songId;
        this.currentSourceType = sourceType;
        this.currentMetadata = null;

        this.notify();
        this.notifyTrackChange();

        try {
            const baseUrl = getConfig<string>('api.apiUrl') ?? '';
            const accountToken = getAccount();

            const headers = {
                Authorization: `Bearer ${token}`,
                "X-Account-Token": String(accountToken),
            };
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

            if (this.ctx && this.ctx.state === 'suspended') {
                await this.ctx.resume();
            }

            await this.audio.play();
        } finally {
            this.isLoading = false;
            this.isTransitioning = false;
            this.notify();
        }
    }

    skip() {
        this.audio.pause();
        this.nextInQueue();
    }

    clearQueue() {
        this.queue = [];
    }

    togglePlay() {
        if (!this.audio.src) return;
        this.audio.paused ? this.audio.play() : this.audio.pause();
    }

    seek(fraction: number) {
        if (!this.audio.duration) return;
        this.audio.currentTime = this.audio.duration * Math.max(0, Math.min(1, fraction));
    }

    setVolume(fraction: number) {
        const f = Math.max(0, Math.min(1, fraction));

        if (!this.gainNode || !this.ctx) return;

        const minDb = -60;

        const db = minDb + f * Math.abs(minDb);
        const gain = Math.pow(10, db / 20);

        this.gainNode.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.01);
    }

    subscribeToTrackChange(cb: TrackChangeListener): () => void {
        this.trackListeners.add(cb);
        return () => this.trackListeners.delete(cb);
    }

    private notifyTrackChange() {
        this.trackListeners.forEach(cb => cb(this.currentSongId, this.currentSourceType));
    }

    get isPlaying() {
        return !this.audio.paused && !this.audio.ended;
    }

    get currentTime() {
        return this.audio.currentTime;
    }

    get duration() {
        return this.audio.duration || 0;
    }

    get hasTrack() {
        return !!this.currentSongId;
    }

    get volume() {
        if (!this.gainNode) return 1;
        return this.gainNode.gain.value;
    }
}

export const player = new AudioPlayer();

export function playSong(songId: string, sourceType: string) {
    return player.playSong(songId, sourceType);
}