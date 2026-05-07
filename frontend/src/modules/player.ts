import { getConfig } from './config';
import { getAccount } from './account';

type PlayerListener = () => void;
type TrackChangeListener = (songId: string | null, sourceType: string | null) => void;

export type RepeatMode = 'off' | 'one' | 'all';

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

export interface QueueItem {
    songId: string;
    sourceType: string;
    extra?: Record<string, unknown>;
}

class AudioPlayer {
    private audio = new Audio();
    private listeners = new Set<PlayerListener>();
    private ctx: AudioContext | null = null;
    private gainNode: GainNode | null = null;
    private sourceNode: MediaElementAudioSourceNode | null = null;
    private isTransitioning = false;
    private currentBlobUrl: string | null = null;
    private trackListeners = new Set<TrackChangeListener>();
    private skipHistoryPush = false;

    private priorityQueue: QueueItem[] = [];

    private nextQueueItems: QueueItem[] = [];
    private nextQueueOriginal: QueueItem[] = [];
    private nextQueueName: string | null = null;

    private history: QueueItem[] = [];

    isLoading = false;
    currentSongId: string | null = null;
    currentSourceType: string | null = null;
    currentMetadata: TrackMetadata | null = null;
    currentExtra: Record<string, unknown> | null = null;

    shuffle = false;
    repeat: RepeatMode = 'off';

    constructor() {
        for (const event of ['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata', 'waiting', 'playing']) {
            this.audio.addEventListener(event, () => this.notify());
        }
        this.audio.addEventListener('ended', () => this.next());
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

    private notifyTrackChange() {
        this.trackListeners.forEach(cb => cb(this.currentSongId, this.currentSourceType));
    }

    subscribeToTrackChange(cb: TrackChangeListener): () => void {
        this.trackListeners.add(cb);
        return () => this.trackListeners.delete(cb);
    }

    private smartShuffle(items: QueueItem[]): QueueItem[] {
        const arr = [...items];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }

        if (arr.length > 1 && arr[0].songId === this.currentSongId) {
            const j = Math.floor(Math.random() * (arr.length - 1)) + 1;
            [arr[0], arr[j]] = [arr[j], arr[0]];
        }

        for (let i = 0; i < arr.length - 1; i++) {
            const curArtist = arr[i].extra?.artist;
            const nextArtist = arr[i + 1].extra?.artist;
            if (curArtist && nextArtist && curArtist === nextArtist) {
                for (let j = i + 2; j < arr.length; j++) {
                    if (arr[j].extra?.artist !== curArtist) {
                        [arr[i + 1], arr[j]] = [arr[j], arr[i + 1]];
                        break;
                    }
                }
            }
        }

        return arr;
    }

    addToQueue(songId: string, sourceType: string, extra?: Record<string, unknown>) {
        this.priorityQueue.push({ songId, sourceType, extra });
        if (!this.currentSongId && !this.isTransitioning) {
            this.next();
        }
        this.notify();
    }

    setNextQueue(name: string | null, items: QueueItem[]) {
        this.nextQueueName = name;
        this.nextQueueOriginal = [...items];
        this.nextQueueItems = this.shuffle ? this.smartShuffle([...items]) : [...items];
        if (!this.currentSongId && !this.isTransitioning) {
            this.next();
        }
        this.notify();
    }

    appendToNextQueue(items: QueueItem[]) {
        this.nextQueueOriginal.push(...items);
        const toAdd = this.shuffle ? this.smartShuffle([...items]) : [...items];
        this.nextQueueItems.push(...toAdd);
        if (!this.currentSongId && !this.isTransitioning) {
            this.next();
        }
        this.notify();
    }

    clearNextQueue() {
        this.nextQueueName = null;
        this.nextQueueItems = [];
        this.nextQueueOriginal = [];
        this.notify();
    }

    clearPriorityQueue() {
        this.priorityQueue = [];
        this.notify();
    }

    toggleShuffle() {
        this.shuffle = !this.shuffle;
        if (this.shuffle) {
            this.nextQueueItems = this.smartShuffle([...this.nextQueueItems]);
        } else {
            const remaining = new Set(this.nextQueueItems.map(i => i.songId));
            this.nextQueueItems = this.nextQueueOriginal.filter(i => remaining.has(i.songId));
        }
        this.notify();
    }

    cycleRepeat() {
        if (this.repeat === 'off') this.repeat = 'all';
        else if (this.repeat === 'all') this.repeat = 'one';
        else this.repeat = 'off';
        this.notify();
    }

    async next() {
        if (this.isTransitioning) return;

        if (this.repeat === 'one' && this.currentSongId) {
            await this.playSong(this.currentSongId, this.currentSourceType!, this.currentExtra ?? undefined);
            return;
        }

        const item = this.priorityQueue.shift() ?? this.nextQueueItems.shift();

        if (!item) {
            if (this.repeat === 'all' && this.nextQueueOriginal.length > 0) {
                this.nextQueueItems = this.shuffle
                    ? this.smartShuffle([...this.nextQueueOriginal])
                    : [...this.nextQueueOriginal];
                const first = this.nextQueueItems.shift();
                if (first) await this.playSong(first.songId, first.sourceType, first.extra);
            }
            return;
        }

        await this.playSong(item.songId, item.sourceType, item.extra);
    }

    async prev() {
        if (this.isTransitioning) return;

        const prevItem = this.history.pop();
        if (!prevItem) return;

        if (this.currentSongId) {
            this.priorityQueue.unshift({
                songId: this.currentSongId,
                sourceType: this.currentSourceType!,
                extra: this.currentExtra ?? undefined,
            });
        }

        this.skipHistoryPush = true;
        await this.playSong(prevItem.songId, prevItem.sourceType, prevItem.extra);
        this.notify();
    }

    skip() {
        this.audio.pause();
        this.next();
    }

    async playSong(songId: string, sourceType: string, extra?: Record<string, unknown>) {
        const token = localStorage.getItem('access_token');
        if (!token) throw new Error('No access token');

        this.isTransitioning = true;
        this.isLoading = true;

        if (this.currentSongId && !this.skipHistoryPush) {
            this.history.push({
                songId: this.currentSongId,
                sourceType: this.currentSourceType!,
                extra: this.currentExtra ?? undefined,
            });
        }
        this.skipHistoryPush = false;

        this.currentSongId = songId;
        this.currentSourceType = sourceType;
        this.currentMetadata = null;
        this.currentExtra = extra ?? null;

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

            if (this.ctx?.state === 'suspended') await this.ctx.resume();
            await this.audio.play();
        } finally {
            this.isLoading = false;
            this.isTransitioning = false;
            this.notify();
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

    setVolume(fraction: number) {
        const f = Math.max(0, Math.min(1, fraction));
        if (!this.gainNode || !this.ctx) return;
        const minDb = -60;
        const db = minDb + f * Math.abs(minDb);
        const gain = Math.pow(10, db / 20);
        this.gainNode.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.01);
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

    get queueName() {
        return this.nextQueueName;
    }

    get getPriorityQueue() {
        return [...this.priorityQueue];
    }

    get getNextQueue() {
        return [...this.nextQueueItems];
    }

    get getHistory() {
        return [...this.history];
    }

    get hasPrev() {
        return this.history.length > 0;
    }

    get hasNext() {
        return this.priorityQueue.length > 0 || this.nextQueueItems.length > 0;
    }
}

export const player = new AudioPlayer();

export function playSong(songId: string, sourceType: string, extra?: Record<string, unknown>) {
    return player.playSong(songId, sourceType, extra);
}