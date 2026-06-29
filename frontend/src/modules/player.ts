import { getConfig } from './config';
import { getAccount } from './account';

type PlayerListener = () => void;
type TrackChangeListener = (songId: string | null, sourceType: string | null) => void;

export type RepeatMode = 'off' | 'one' | 'all';

export interface SourcePlugin {
    play(
        songId: string,
        extra: Record<string, unknown> | undefined,
        autoplay: boolean,
        callbacks: {
            onMetadata: (meta: TrackMetadata) => void;
            onReady: () => void;
            onEnded: () => void;
            onStateChange: () => void;
        }
    ): Promise<void>;
    pause(): void;
    resume(): void;
    seek(seconds: number): void;
    getCurrentTime(): number;
    getDuration(): number;
    isPlaying(): boolean;
    destroy(): void;
    activate?(): void;
    setVolume?(fraction: number): void;
}

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

interface HistoryItem extends QueueItem {
    fromNextQueue: boolean;
}

interface PrefetchEntry {
    blobUrl: string;
    metadata: TrackMetadata;
}

interface PersistedTrackState {
    songId: string | null;
    sourceType: string | null;
    extra: Record<string, unknown> | null;
    currentTime: number;
    wasPlaying: boolean;
    fromNextQueue: boolean;

    priorityQueue: QueueItem[];
    nextQueueItems: QueueItem[];
    nextQueueOriginal: QueueItem[];

    streamUrl: string | null;
}

const VOLUME_STORAGE_KEY = 'player_volume';
const HISTORY_STORAGE_KEY = 'player_history';
const PLAYBACK_STATE_STORAGE_KEY = 'player_playback_state';
const CURRENT_TRACK_STORAGE_KEY = 'player_current_track';

export function getVolumeStorage(): Storage | null {
    const mode = getConfig<string>('player.volume_persistence') ?? 'localStorage';
    if (mode === 'sessionStorage') return sessionStorage;
    if (mode === 'localStorage') return localStorage;
    return null;
}

function getHistoryStorage(): Storage | null {
    const mode = getConfig<string>('history.history_persistence') ?? 'localStorage';
    if (mode === 'sessionStorage') return sessionStorage;
    if (mode === 'localStorage') return localStorage;
    return null;
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

    private history: HistoryItem[] = [];
    private currentSongFromNextQueue = false;

    private prefetchCache = new Map<string, PrefetchEntry>();
    private prefetchController: AbortController | null = null;
    private _volumeFraction = 1;

    private lastStreamUrl: string | null = null;

    private plugins = new Map<string, SourcePlugin>();
    private activePlugin: SourcePlugin | null = null;

    private pendingAutoplay = false;

    private endCheckInterval: ReturnType<typeof setInterval> | null = null;

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

        this.audio.addEventListener('timeupdate', () => this.saveCurrentTrackState());
        this.audio.addEventListener('pause', () => this.saveCurrentTrackState());
        this.audio.addEventListener('play', () => this.saveCurrentTrackState());

        this.audio.addEventListener('ended', () => {
            this.clearCurrentTrackState();
            this.next();
        });

        for (const event of ['play', 'pause', 'loadedmetadata']) {
            this.audio.addEventListener(event, () => this.syncMediaSessionState());
        }

        this.initAudioGraph();
        this.loadPersistedVolume();
        this.loadPersistedHistory();
        this.loadPersistedPlaybackState();
        this.initMediaControls();
        this.restoreCurrentTrackState();
    }

    private initAudioGraph() {
        this.ctx = new AudioContext();
        this.gainNode = this.ctx.createGain();
        this.sourceNode = this.ctx.createMediaElementSource(this.audio);
        this.sourceNode.connect(this.gainNode);
        this.gainNode.connect(this.ctx.destination);
        this.gainNode.gain.value = 1;
    }

    private loadPersistedVolume() {
        const storage = getVolumeStorage();
        const raw = storage?.getItem(VOLUME_STORAGE_KEY) ?? null;
        const parsed = raw !== null ? parseFloat(raw) : NaN;
        const vol = !isNaN(parsed) ? parsed : (getConfig<number>('player.default_volume') ?? 0.8);

        if (this.gainNode) {
            const clamped = Math.max(0, Math.min(1, vol));
            this._volumeFraction = clamped;

            const minDb = -60;
            const db = minDb + clamped * Math.abs(minDb);

            this.gainNode.gain.value = Math.pow(10, db / 20);
        }
    }

    private loadPersistedHistory() {
        try {
            const storage = getHistoryStorage();
            const raw = storage?.getItem(HISTORY_STORAGE_KEY) ?? null;

            if (!raw) return;

            const parsed = JSON.parse(raw);

            if (Array.isArray(parsed)) {
                this.history = parsed as HistoryItem[];
            }
        } catch {

        }
    }

    private saveHistory() {
        try {
            const storage = getHistoryStorage();

            if (!storage) return;

            storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(this.history));
        } catch {

        }
    }

    private loadPersistedPlaybackState() {
        if (!(getConfig<boolean>('history.persist_playback_state') ?? true)) return;

        try {
            const storage = getHistoryStorage();
            const raw = storage?.getItem(PLAYBACK_STATE_STORAGE_KEY) ?? null;

            if (!raw) return;

            const parsed = JSON.parse(raw);

            if (typeof parsed.shuffle === 'boolean') this.shuffle = parsed.shuffle;
            if (['off', 'one', 'all'].includes(parsed.repeat)) this.repeat = parsed.repeat as RepeatMode;
        } catch {

        }
    }

    private savePlaybackState() {
        if (!(getConfig<boolean>('history.persist_playback_state') ?? true)) return;

        try {
            const storage = getHistoryStorage();

            if (!storage) return;

            storage.setItem(PLAYBACK_STATE_STORAGE_KEY, JSON.stringify({
                shuffle: this.shuffle,
                repeat: this.repeat,
            }));
        } catch {

        }
    }

    private saveCurrentTrackState() {
        if (!(getConfig<boolean>('history.persist_playback_state') ?? true)) return;

        try {
            const storage = getHistoryStorage();
            if (!storage) return;

            const state: PersistedTrackState = {
                songId: this.currentSongId,
                sourceType: this.currentSourceType,
                extra: this.currentExtra,
                currentTime: this.audio.currentTime || 0,
                wasPlaying: this.isPlaying,
                fromNextQueue: this.currentSongFromNextQueue,

                priorityQueue: this.priorityQueue,
                nextQueueItems: this.nextQueueItems,
                nextQueueOriginal: this.nextQueueOriginal,

                streamUrl: this.lastStreamUrl,
            };

            storage.setItem(CURRENT_TRACK_STORAGE_KEY, JSON.stringify(state));
        } catch {

        }
    }

    private clearCurrentTrackState() {
        try {
            const storage = getHistoryStorage();

            if (!storage) return;

            storage.removeItem(CURRENT_TRACK_STORAGE_KEY);
        } catch {

        }
    }

    private async restoreCurrentTrackState() {
        if (!(getConfig<boolean>('history.persist_playback_state') ?? true)) return;

        try {
            const storage = getHistoryStorage();
            const raw = storage?.getItem(CURRENT_TRACK_STORAGE_KEY) ?? null;

            if (!raw) return;

            const parsed = JSON.parse(raw) as PersistedTrackState;

            if (!parsed.songId || !parsed.sourceType) return;

            this.priorityQueue = parsed.priorityQueue ?? [];
            this.nextQueueItems = parsed.nextQueueItems ?? [];
            this.nextQueueOriginal = parsed.nextQueueOriginal ?? [];

            const playAfterLoad = parsed.wasPlaying;

            await this.playSong(
                parsed.songId,
                parsed.sourceType,
                parsed.extra ?? undefined,
                parsed.fromNextQueue,
                false
            );

            const applyTime = () => {
                if (
                    Number.isFinite(parsed.currentTime) &&
                    parsed.currentTime > 0 &&
                    this.audio.duration &&
                    !isNaN(this.audio.duration)
                ) {
                    this.audio.currentTime = Math.min(parsed.currentTime, this.audio.duration);
                }

                if (!playAfterLoad) {
                    this.audio.pause();
                } else {
                    this.pendingAutoplay = true;
                }

                this.notify();
            };

            if (this.audio.readyState >= 1) {
                applyTime();
            } else {
                this.audio.addEventListener('loadedmetadata', applyTime, { once: true });
            }

            this.schedulePrefetch();
            this.notify();
        } catch {

        }
    }

    private initMediaControls() {
        window.addEventListener('keydown', (e) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            switch (e.key) {
                case 'MediaTrackNext':
                    e.preventDefault();
                    this.skip();
                    break;
                case 'MediaTrackPrevious':
                    e.preventDefault();
                    this.prev();
                    break;
                case 'MediaPlayPause':
                    e.preventDefault();
                    this.togglePlay();
                    break;
            }
        });

        if (!('mediaSession' in navigator)) return;

        navigator.mediaSession.setActionHandler('play', () => {
            if (this.isTransitioning) return;
            if (this.activePlugin) this.activePlugin.resume();
            else this.audio.play();
        });

        navigator.mediaSession.setActionHandler('pause', () => {
            if (this.isTransitioning) return;
            if (this.activePlugin) this.activePlugin.pause();
            else this.audio.pause();
        });

        navigator.mediaSession.setActionHandler('nexttrack', () => this.skip());
        navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());

        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime !== undefined) {
                this.audio.currentTime = details.seekTime;
            }
        });
    }

    private updateMediaSessionMetadata() {
        if (!('mediaSession' in navigator) || !this.currentMetadata) return;

        navigator.mediaSession.metadata = new MediaMetadata({
            title: this.currentMetadata.title ?? undefined,
            artist: this.currentMetadata.artist ?? undefined,
            album: this.currentMetadata.album ?? undefined,
            artwork: this.currentMetadata.album_art
                ? [{ src: this.currentMetadata.album_art }]
                : undefined,
        });
    }

    private syncMediaSessionState() {
        if (!('mediaSession' in navigator)) return;

        navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';

        if (this.audio.duration && !isNaN(this.audio.duration)) {
            try {
                navigator.mediaSession.setPositionState({
                    duration: this.audio.duration,
                    playbackRate: this.audio.playbackRate,
                    position: Math.min(this.audio.currentTime, this.audio.duration),
                });
            } catch { }
        }
    }

    private schedulePrefetch() {
        this.prefetchController?.abort();
        this.prefetchController = null;

        if (!(getConfig<boolean>('buffering.prefetch_enabled') ?? true)) return;

        const next = this.priorityQueue[0]
            ?? this.nextQueueItems[0]
            ?? (this.repeat === 'all' ? this.nextQueueOriginal[0] : undefined);

        if (!next) return;

        if (this.plugins.has(next.sourceType)) return;

        const cacheKey = `${next.sourceType}:${next.songId}`;

        if (this.prefetchCache.has(cacheKey)) return;

        const token = localStorage.getItem('access_token');

        if (!token) return;

        const controller = new AbortController();

        this.prefetchController = controller;

        const delayMs = getConfig<number>('buffering.prefetch_delay_ms') ?? 1500;

        (async () => {
            await new Promise<void>(r => setTimeout(r, delayMs));

            if (controller.signal.aborted) return;

            try {
                const baseUrl = getConfig<string>('api.apiUrl') ?? '';
                const accountToken = getAccount();
                const encoded = encodeURIComponent(next.songId);

                const headers = {
                    Authorization: `Bearer ${token}`,
                    'X-Account-Token': String(accountToken),
                };

                const signal = controller.signal;

                const [metaRes, streamRes] = await Promise.all([
                    fetch(`${baseUrl}/api/player/media/${next.sourceType}:${encoded}`, { headers, signal }),
                    fetch(`${baseUrl}/api/player/stream/${next.sourceType}:${encoded}`, { headers, signal }),
                ]);

                if (!metaRes.ok || !streamRes.ok || signal.aborted) return;

                const [metaJson, blob] = await Promise.all([
                    metaRes.json(),
                    streamRes.blob(),
                ]);

                if (signal.aborted) return;

                for (const [k, entry] of this.prefetchCache) {
                    URL.revokeObjectURL(entry.blobUrl);
                    this.prefetchCache.delete(k);
                }

                this.prefetchCache.set(cacheKey, {
                    blobUrl: URL.createObjectURL(blob),
                    metadata: metaJson.metadata as TrackMetadata,
                });
            } catch {

            }
        })();
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

    private startEndWatcher() {
        if (this.endCheckInterval) return;

        this.endCheckInterval = setInterval(() => {
            if (!this.currentSongId) return;

            const duration = this.duration;
            const time = this.currentTime;

            if (duration > 0 && time >= duration - 0.25) {
                this.stopEndWatcher();
                this.next();
            }
        }, 200);
    }

    private stopEndWatcher() {
        if (this.endCheckInterval) {
            clearInterval(this.endCheckInterval);
            this.endCheckInterval = null;
        }
    }

    addToQueue(songId: string, sourceType: string, extra?: Record<string, unknown>) {
        this.priorityQueue.push({ songId, sourceType, extra });

        if (!this.currentSongId && !this.isTransitioning) {
            this.next();
        } else {
            this.schedulePrefetch();
        }

        this.notify();
    }

    setNextQueue(name: string | null, items: QueueItem[]) {
        this.nextQueueName = name;
        const current = this.currentSongFromNextQueue && this.currentSongId && this.currentSourceType
            ? [{
                songId: this.currentSongId,
                sourceType: this.currentSourceType,
                extra: this.currentExtra ?? undefined,
            }]
            : [];

        this.nextQueueOriginal = [...current, ...items];
        this.nextQueueItems = this.shuffle ? this.smartShuffle([...items]) : [...items];

        if (!this.currentSongId && !this.isTransitioning) {
            this.next();
        } else {
            this.schedulePrefetch();
        }

        this.notify();
    }

    appendToNextQueue(items: QueueItem[]) {
        this.nextQueueOriginal.push(...items);

        const toAdd = this.shuffle ? this.smartShuffle([...items]) : [...items];

        this.nextQueueItems.push(...toAdd);

        if (!this.currentSongId && !this.isTransitioning) {
            this.next();
        } else {
            this.schedulePrefetch();
        }

        this.notify();
    }

    clearNextQueue() {
        this.nextQueueName = null;
        this.nextQueueItems = [];
        this.nextQueueOriginal = [];

        this.prefetchController?.abort();
        this.prefetchController = null;

        this.notify();
    }

    clearPriorityQueue() {
        this.priorityQueue = [];
        this.schedulePrefetch();
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

        this.savePlaybackState();
        this.schedulePrefetch();
        this.notify();
    }

    cycleRepeat() {
        if (this.repeat === 'off') this.repeat = 'all';
        else if (this.repeat === 'all') this.repeat = 'one';
        else this.repeat = 'off';

        this.savePlaybackState();
        this.schedulePrefetch();
        this.notify();
    }

    async next() {
        if (this.isTransitioning) return;

        if (this.repeat === 'one' && this.currentSongId) {
            this.skipHistoryPush = true;

            await this.playSong(
                this.currentSongId,
                this.currentSourceType!,
                this.currentExtra ?? undefined,
                this.currentSongFromNextQueue
            );

            return;
        }

        let item: QueueItem | undefined;
        let fromNextQueue = false;

        if (this.priorityQueue.length > 0) {
            item = this.priorityQueue.shift();
        } else {
            item = this.nextQueueItems.shift();
            fromNextQueue = item !== undefined;
        }

        if (!item) {
            if (this.repeat === 'all' && this.nextQueueOriginal.length > 0) {
                this.nextQueueItems = this.shuffle
                    ? this.smartShuffle([...this.nextQueueOriginal])
                    : [...this.nextQueueOriginal];

                const first = this.nextQueueItems.shift();

                if (first) {
                    await this.playSong(first.songId, first.sourceType, first.extra, true);
                }
            }

            return;
        }

        await this.playSong(item.songId, item.sourceType, item.extra, fromNextQueue);
    }

    async prev() {
        if (this.isTransitioning) return;

        const threshold = getConfig<number>('navigation.prev_restart_threshold') ?? 3;
        const hasPrevSong = this.history.length > 0;

        if (this.audio.currentTime > threshold || !hasPrevSong) {
            this.audio.currentTime = 0;
            this.notify();
            return;
        }

        const prevItem = this.history.pop()!;

        this.saveHistory();

        if (this.currentSongId) {
            const current: QueueItem = {
                songId: this.currentSongId,
                sourceType: this.currentSourceType!,
                extra: this.currentExtra ?? undefined,
            };

            if (this.currentSongFromNextQueue) {
                this.nextQueueItems.unshift(current);
            } else {
                this.priorityQueue.unshift(current);
            }
        }

        this.skipHistoryPush = true;

        await this.playSong(
            prevItem.songId,
            prevItem.sourceType,
            prevItem.extra,
            prevItem.fromNextQueue
        );

        this.notify();
    }

    skip() {
        this.audio.pause();
        this.next();
    }

    async playSong(
        songId: string,
        sourceType: string,
        extra?: Record<string, unknown>,
        fromNextQueue = false,
        autoplay = true
    ) {
        const plugin = this.plugins.get(sourceType);
        this.stopEndWatcher();

        if (plugin) {
            this.isTransitioning = true;
            this.isLoading = true;

            if (this.activePlugin && this.activePlugin !== plugin) {
                this.activePlugin.destroy();
            }

            if (!this.plugins.has(this.currentSourceType ?? '')) {
                this.audio.pause();
            }

            this.activePlugin = plugin;
            if (plugin.activate) plugin.activate();

            if (this.currentSongId && !this.skipHistoryPush) {
                const includePriority = getConfig<boolean>('navigation.prev_include_priority_queue') ?? false;
                if (this.currentSongFromNextQueue || includePriority) {
                    this.history.push({
                        songId: this.currentSongId,
                        sourceType: this.currentSourceType!,
                        extra: this.currentExtra ?? undefined,
                        fromNextQueue: this.currentSongFromNextQueue,
                    });
                    const maxSize = getConfig<number>('history.max_history_size') ?? 100;
                    if (maxSize > 0 && this.history.length > maxSize) {
                        this.history.splice(0, this.history.length - maxSize);
                    }
                    this.saveHistory();
                }
            }

            this.skipHistoryPush = false;
            this.currentSongFromNextQueue = fromNextQueue;
            this.currentSongId = songId;
            this.currentSourceType = sourceType;
            this.currentMetadata = null;
            this.currentExtra = extra ?? null;

            this.notify();
            this.notifyTrackChange();

            try {
                await plugin.play(songId, extra, autoplay, {
                    onMetadata: (meta) => {
                        this.currentMetadata = meta;
                        this.updateMediaSessionMetadata();
                        this.notify();
                    },
                    onReady: () => {
                        this.isLoading = false;
                        this.startEndWatcher();
                        this.notify();
                    },

                    onEnded: () => {
                        this.clearCurrentTrackState();
                        this.next();
                    },
                    onStateChange: () => {
                        this.notify();
                    },
                });
                this.schedulePrefetch();
            } finally {
                this.isLoading = false;
                this.isTransitioning = false;
                this.notify();
            }

            return;
        }

        if (this.activePlugin) {
            this.activePlugin.destroy();
            this.activePlugin = null;
        }
        const token = localStorage.getItem('access_token');

        if (!token) throw new Error('No access token');

        this.isTransitioning = true;
        this.isLoading = true;

        if (this.currentSongId && !this.skipHistoryPush) {
            const includePriority = getConfig<boolean>('navigation.prev_include_priority_queue') ?? false;

            if (this.currentSongFromNextQueue || includePriority) {
                this.history.push({
                    songId: this.currentSongId,
                    sourceType: this.currentSourceType!,
                    extra: this.currentExtra ?? undefined,
                    fromNextQueue: this.currentSongFromNextQueue,
                });

                const maxSize = getConfig<number>('history.max_history_size') ?? 100;

                if (maxSize > 0 && this.history.length > maxSize) {
                    this.history.splice(0, this.history.length - maxSize);
                }

                this.saveHistory();
            }
        }

        this.skipHistoryPush = false;
        this.currentSongFromNextQueue = fromNextQueue;

        this.currentSongId = songId;
        this.currentSourceType = sourceType;
        this.currentMetadata = null;
        this.currentExtra = extra ?? null;

        this.notify();
        this.notifyTrackChange();

        try {
            const cacheKey = `${sourceType}:${songId}`;
            const cached = this.prefetchCache.get(cacheKey);

            if (cached) {
                this.prefetchCache.delete(cacheKey);

                this.currentMetadata = cached.metadata;

                if (this.currentBlobUrl) {
                    URL.revokeObjectURL(this.currentBlobUrl);
                }

                this.currentBlobUrl = cached.blobUrl;
                this.audio.src = cached.blobUrl;

                this.isLoading = false;

                this.notify();
            } else {
                const baseUrl = getConfig<string>('api.apiUrl') ?? '';
                const accountToken = getAccount();

                const headers = {
                    Authorization: `Bearer ${token}`,
                    'X-Account-Token': String(accountToken),
                };

                const encoded = encodeURIComponent(songId);

                this.lastStreamUrl = `${baseUrl}/api/player/stream/${sourceType}:${encoded}`;

                const [metaRes, streamRes] = await Promise.all([
                    fetch(`${baseUrl}/api/player/media/${sourceType}:${encoded}`, { headers }),
                    fetch(`${baseUrl}/api/player/stream/${sourceType}:${encoded}`, { headers }),
                ]);

                if (!metaRes.ok) {
                    throw new Error(`Metadata fetch failed: ${metaRes.status}`);
                }

                if (!streamRes.ok) {
                    throw new Error(`Stream fetch failed: ${streamRes.status}`);
                }

                const metaJson = await metaRes.json();

                this.currentMetadata = metaJson.metadata as TrackMetadata;

                this.notify();

                const blob = await streamRes.blob();

                if (this.currentBlobUrl) {
                    URL.revokeObjectURL(this.currentBlobUrl);
                }

                this.currentBlobUrl = URL.createObjectURL(blob);
                this.audio.src = this.currentBlobUrl;

                this.isLoading = false;

                this.notify();
            }

            this.updateMediaSessionMetadata();

            if (this.ctx?.state === 'suspended') {
                await this.ctx.resume();
            }

            if (autoplay) {
                await this.audio.play();
                this.startEndWatcher();
            }

            this.saveCurrentTrackState();
            this.schedulePrefetch();
        } finally {
            this.isLoading = false;
            this.isTransitioning = false;
            this.notify();
        }
    }

    togglePlay() {
        if (this.activePlugin) {
            if (this.activePlugin.activate) this.activePlugin.activate();
            this.activePlugin.isPlaying() ? this.activePlugin.pause() : this.activePlugin.resume();
            this.notify();
            return;
        }
        if (!this.audio.src) return;
        this.audio.paused ? this.audio.play() : this.audio.pause();
    }

    seek(fraction: number) {
        if (this.activePlugin) {
            this.activePlugin.seek(this.activePlugin.getDuration() * Math.max(0, Math.min(1, fraction)));
            return;
        }
        if (!this.audio.duration) return;
        this.audio.currentTime = this.audio.duration * Math.max(0, Math.min(1, fraction));
        this.saveCurrentTrackState();
    }

    setVolume(fraction: number) {
        const f = Math.max(0, Math.min(1, fraction));
        this._volumeFraction = f;

        if (!this.gainNode || !this.ctx) return;

        const minDb = -60;
        const db = minDb + f * Math.abs(minDb);
        const gain = Math.pow(10, db / 20);
        this.gainNode.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.01);

        const storage = getVolumeStorage();
        storage?.setItem(VOLUME_STORAGE_KEY, String(f));

        this.activePlugin?.setVolume?.(f);
        this.notify();
    }

    registerPlugin(sourceType: string, plugin: SourcePlugin | null) {
        if (plugin === null) {
            this.plugins.delete(sourceType);
        } else {
            this.plugins.set(sourceType, plugin);
        }
    }

    get isPlaying() {
        if (this.activePlugin) return this.activePlugin.isPlaying();
        return !this.audio.paused && !this.audio.ended;
    }

    get currentTime() {
        if (this.activePlugin) return this.activePlugin.getCurrentTime();
        return this.audio.currentTime;
    }

    get duration() {
        if (this.activePlugin) return this.activePlugin.getDuration();
        return this.audio.duration || 0;
    }

    get hasTrack() {
        return !!this.currentSongId;
    }

    get volume() {
        if (!this.gainNode) return 1;
        return this.gainNode.gain.value;
    }

    get volumeFraction() {
        return this._volumeFraction;
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
        return this.priorityQueue.length > 0
            || this.nextQueueItems.length > 0
            || (this.repeat === 'all' && this.nextQueueOriginal.length > 0);
    }
}

export const player = new AudioPlayer();

export function playSong(songId: string, sourceType: string, extra?: Record<string, unknown>) {
    return player.playSong(songId, sourceType, extra);
}
