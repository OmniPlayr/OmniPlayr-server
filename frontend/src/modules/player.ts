import { getConfig } from './config';
import { getAccount } from './account';
import { createToast } from './ToastContext';
import i18n from '../i18n';
import api from './api';

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
    destroy(options?: { transferred?: boolean }): void;
    activate?(): void;
    setVolume?(fraction: number): void;
    setTransientVolume?(fraction: number): void;
}

export interface AudioOutputDevice {
    device_identifier: string;
    device_type: string;
    device_ip?: string | null;
    label?: string;
}

export interface AudioOutputPlaybackRequest {
    songId: string;
    sourceType: string;
    streamUrl: string;
    contentType?: string | null;
    metadata: TrackMetadata | null;
    extra?: Record<string, unknown>;
    device: AudioOutputDevice;
}

export interface AudioOutputPluginCallbacks {
    onReady: () => void;
    onEnded: () => void;
    onStateChange: () => void;
    onError: (error: unknown) => void;
}

export interface AudioOutputPlugin {
    supportsSourcePlayback?: boolean;
    listDevices(): AudioOutputDevice[];
    canPlay?(request: AudioOutputPlaybackRequest): boolean | string;
    play(request: AudioOutputPlaybackRequest, callbacks: AudioOutputPluginCallbacks): Promise<void>;
    pause?(): void;
    resume?(): void;
    seek?(seconds: number): void;
    stop?(): void;
    setVolume?(fraction: number): void;
    getCurrentTime?(): number;
    getDuration?(): number;
    isPlaying?(): boolean;
}

export interface RegisteredAudioOutputDevice {
    pluginId: string;
    device: AudioOutputDevice;
}

export interface SyncedPlaybackInfo {
    deviceLabel: string;
    deviceType: string | null;
    isPlaying: boolean;
}

interface PlaybackTransferInfo {
    device: AudioOutputDevice;
    transferred_at: string;
}

interface PlaybackEmitResponse {
    status?: string;
    id?: number;
}

interface AccountPlaybackRow {
    id?: number;
    song_id?: string;
    source_type?: string;
    device_identifier?: string | null;
    device_type?: string | null;
    device_label?: string | null;
    playback_status?: string | null;
    playback_metadata?: {
        started_on_device?: Partial<AudioOutputDevice>;
        client_instance_id?: string;
        current_time?: number;
        shuffle?: boolean;
        repeat?: boolean;
        repeat_one?: boolean;
        volume?: number;
    } | null;
    song_metadata?: {
        title?: string | null;
        artist?: string | null;
        album?: string | null;
        length?: number | null;
        album_art?: string | null;
        extra_data?: string | null;
    } | null;
}

interface AccountDeviceRow {
    id?: number | string | null;
    identifier?: string | null;
    type?: string | null;
    status?: string | null;
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
    streamUrl: string;
    metadata: TrackMetadata;
    contentType: string | null;
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
const OUTPUT_DEVICE_STORAGE_KEY = 'player_output_device';
const CLIENT_INSTANCE_STORAGE_KEY = 'player_client_instance_id';
const MIN_GAIN = 0.0001;
const PLAYBACK_FAILURE_GRACE_MS = 0;
const LOCAL_OUTPUT_PLUGIN_ID = 'core';

function getHostProvidedDeviceInfo(): Partial<AudioOutputDevice> | null {
    const host = globalThis as typeof globalThis & {
        __OMNIPLAYR_DEVICE_INFO__?: Partial<AudioOutputDevice>;
    };

    return host.__OMNIPLAYR_DEVICE_INFO__ ?? null;
}

function isPhoneBrowser() {
    const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
    if (nav.userAgentData?.mobile) return true;

    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function isDesktopApp() {
    const host = globalThis as typeof globalThis & {
        __TAURI_INTERNALS__?: unknown;
        process?: { versions?: { electron?: string } };
    };

    return Boolean(host.__TAURI_INTERNALS__ || host.process?.versions?.electron || /Electron|Tauri/i.test(navigator.userAgent));
}

function getLocalOutputDevice(): AudioOutputDevice {
    const provided = getHostProvidedDeviceInfo();
    const userAgent = navigator.userAgent || 'unknown-user-agent';
    const browserType = isPhoneBrowser() ? 'phone' : 'browser';
    const deviceType = provided?.device_type ?? (isDesktopApp() ? 'desktop' : browserType);

    return {
        device_identifier: provided?.device_identifier || userAgent,
        device_type: deviceType,
        device_ip: provided?.device_ip ?? null,
        label: provided?.label || 'OmniPlayr Web',
    };
}

function buildAuthenticatedStreamUrl(baseUrl: string, sourceType: string, songId: string, token: string, accountToken: string | null): string {
    const encoded = encodeURIComponent(songId);
    const params = new URLSearchParams({
        token,
        account_token: accountToken ?? '',
    });

    return `${baseUrl}/api/player/stream/${sourceType}:${encoded}?${params.toString()}`;
}

function isAbortError(error: unknown) {
    return error instanceof DOMException && error.name === 'AbortError';
}

function getClientInstanceId() {
    let id = sessionStorage.getItem(CLIENT_INSTANCE_STORAGE_KEY);
    if (id) return id;

    id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(CLIENT_INSTANCE_STORAGE_KEY, id);
    return id;
}

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
    private outputPlugins = new Map<string, AudioOutputPlugin>();
    private selectedOutput = { pluginId: LOCAL_OUTPUT_PLUGIN_ID, device: getLocalOutputDevice() };
    private activeOutputPlugin: AudioOutputPlugin | null = null;
    private playbackEmitId: number | null = null;
    private lastPlaybackEmitAt = 0;
    private playbackEmitInFlight = false;
    private playbackEmitPending = false;
    private playbackStartedDevice: AudioOutputDevice = getLocalOutputDevice();
    private playbackTransfers: PlaybackTransferInfo[] = [];
    private accountSyncInFlight = false;
    private accountSyncApplying = false;
    private accountSyncLastTrackKey: string | null = null;
    private accountRemotePlayback: {
        row: AccountPlaybackRow;
        receivedAt: number;
        targetDeviceId: number | null;
    } | null = null;

    private pendingAutoplay = false;
    private endAdvanceInProgress = false;
    private playbackFailureAdvancePending = false;
    private playbackFailureTimer: ReturnType<typeof setTimeout> | null = null;
    private persistedTrackRestoreStarted = false;
    private playbackTickInterval: ReturnType<typeof setInterval> | null = null;

    private endCheckInterval: ReturnType<typeof setInterval> | null = null;
    private fadeFrame: number | null = null;
    private fadeNonce = 0;
    private isPauseFadePending = false;
    private isPauseRequested = false;

    private analyserNode: AnalyserNode | null = null;
    private analyserData: Uint8Array<ArrayBuffer> | null = null;

    isLoading = false;
    currentSongId: string | null = null;
    currentSourceType: string | null = null;
    currentMetadata: TrackMetadata | null = null;
    currentExtra: Record<string, unknown> | null = null;

    shuffle = false;
    repeat: RepeatMode = 'off';

    constructor() {
        this.audio.crossOrigin = 'anonymous';

        for (const event of ['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata', 'waiting', 'playing']) {
            this.audio.addEventListener(event, () => this.notify());
        }

        this.audio.addEventListener('timeupdate', () => this.saveCurrentTrackState());
        this.audio.addEventListener('pause', () => this.saveCurrentTrackState());
        this.audio.addEventListener('play', () => this.saveCurrentTrackState());
        this.audio.addEventListener('play', () => {
            this.isPauseRequested = false;
            this.cancelPendingPlaybackFailure();
            this.notify();
        });

        this.audio.addEventListener('playing', () => this.cancelPendingPlaybackFailure());

        this.audio.addEventListener('ended', () => {
            this.clearCurrentTrackState();
            this.next().catch(error => {
                this.reportPluginError('advance native audio to next track', error);
            });
        });

        this.audio.addEventListener('error', () => {
            if (!this.activePlugin && this.currentMetadata) {
                this.advanceAfterPlaybackFailure();
            }
        });

        for (const event of ['play', 'pause', 'loadedmetadata']) {
            this.audio.addEventListener(event, () => this.syncMediaSessionState());
        }

        this.initAudioGraph();
        this.loadPersistedVolume();
        this.loadPersistedOutputDevice();
        this.loadPersistedHistory();
        this.loadPersistedPlaybackState();
        this.initMediaControls();
        this.initAccountPlaybackEvents();
        window.setInterval(() => {
            this.maybeEmitPlaybackStatus();
        }, 1000);
        window.setInterval(() => {
            void this.syncAccountPlayback();
        }, Math.max(1, getConfig<number>('playback.account_sync_interval_seconds') ?? 2) * 1000);
        this.startPlaybackTicker();
    }

    private startPlaybackTicker() {
        if (this.playbackTickInterval) return;

        this.playbackTickInterval = window.setInterval(() => {
            if (!this.currentSongId || !this.isPlaying) return;
            this.notify();
        }, 500);
    }

    private initAudioGraph() {
        this.ctx = new AudioContext();
        this.gainNode = this.ctx.createGain();
        this.analyserNode = this.ctx.createAnalyser();
        this.sourceNode = this.ctx.createMediaElementSource(this.audio);

        this.analyserNode.fftSize = 2048;
        this.analyserData = new Uint8Array(this.analyserNode.fftSize);

        this.sourceNode.connect(this.gainNode);
        this.gainNode.connect(this.analyserNode);
        this.analyserNode.connect(this.ctx.destination);

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

    private loadPersistedOutputDevice() {
        try {
            const raw = localStorage.getItem(OUTPUT_DEVICE_STORAGE_KEY);
            if (!raw) return;

            const parsed = JSON.parse(raw) as { pluginId?: unknown; device?: unknown };
            const device = parsed.device as Partial<AudioOutputDevice> | undefined;

            if (
                typeof parsed.pluginId === 'string' &&
                device &&
                typeof device.device_identifier === 'string' &&
                typeof device.device_type === 'string'
            ) {
                this.selectedOutput = {
                    pluginId: parsed.pluginId,
                    device: {
                        device_identifier: device.device_identifier,
                        device_type: device.device_type,
                        device_ip: typeof device.device_ip === 'string' ? device.device_ip : null,
                        label: typeof device.label === 'string' ? device.label : undefined,
                    },
                };
            }
        } catch {

        }
    }

    private saveSelectedOutputDevice() {
        try {
            localStorage.setItem(OUTPUT_DEVICE_STORAGE_KEY, JSON.stringify(this.selectedOutput));
        } catch {

        }
    }

    private normaliseDeviceInfo(device: AudioOutputDevice): AudioOutputDevice {
        return {
            device_identifier: device.device_identifier,
            device_type: device.device_type,
            device_ip: device.device_ip ?? null,
            label: device.label,
        };
    }

    private getIntendedPlaybackDevice(): AudioOutputDevice {
        if (this.getSelectedOutputPlugin()) {
            return this.normaliseDeviceInfo(this.selectedOutput.device);
        }

        return this.normaliseDeviceInfo(getLocalOutputDevice());
    }

    private getActivePlaybackDevice(): AudioOutputDevice {
        if (this.activeOutputPlugin) {
            return this.normaliseDeviceInfo(this.selectedOutput.device);
        }

        return this.normaliseDeviceInfo(getLocalOutputDevice());
    }

    private resetPlaybackEmitState(startedDevice = this.getIntendedPlaybackDevice()) {
        this.playbackEmitId = null;
        this.lastPlaybackEmitAt = 0;
        this.playbackStartedDevice = this.normaliseDeviceInfo(startedDevice);
        this.playbackTransfers = [];
    }

    private buildPlaybackStatus() {
        if (this.isLoading) return 'loading';
        return this.isPlaying ? 'playing' : 'paused';
    }

    private buildSongMetadata() {
        const metadata = this.currentMetadata;

        if (!metadata) return {};

        return {
            title: metadata.title ?? undefined,
            artist: metadata.artist ?? undefined,
            album: metadata.album ?? undefined,
            length: metadata.duration ?? undefined,
            album_art: metadata.album_art ?? undefined,
            extra_data: this.currentExtra ? JSON.stringify(this.currentExtra) : undefined,
        };
    }

    private requestPlaybackStatusEmit() {
        if (this.accountSyncApplying) return;
        void this.maybeEmitPlaybackStatus(true);
    }

    private async maybeEmitPlaybackStatus(force = false) {
        if (this.accountSyncApplying) return;
        if (this.isObservingRemotePlayback()) return;
        if (!this.currentSongId || !this.currentSourceType) return;

        if (this.playbackEmitInFlight) {
            if (force) this.playbackEmitPending = true;
            return;
        }

        const intervalSeconds = Math.max(1, getConfig<number>('playback.emit_interval_seconds') ?? 15);
        const now = Date.now();

        if (!force && this.lastPlaybackEmitAt > 0 && now - this.lastPlaybackEmitAt < intervalSeconds * 1000) return;

        this.playbackEmitInFlight = true;
        this.lastPlaybackEmitAt = now;

        const expectedExpiry = intervalSeconds + 5;
        const deviceInfo = this.getActivePlaybackDevice();

        try {
            const response = await api(
                '/player/playback/emit',
                {
                    id: this.playbackEmitId,
                    song_id: this.currentSongId,
                    source_type: this.currentSourceType,
                    device_info: deviceInfo,
                    playback_status: this.buildPlaybackStatus(),
                    playback_metadata: {
                        client_instance_id: getClientInstanceId(),
                        started_on_device: this.playbackStartedDevice,
                        expected_expiry: expectedExpiry,
                        volume: Math.round(this._volumeFraction * 100),
                        transfers: this.playbackTransfers,
                        shuffle: this.shuffle,
                        repeat: this.repeat === 'all',
                        repeat_one: this.repeat === 'one',
                        current_time: Math.round(this.currentTime || 0),
                    },
                    song_metadata: this.buildSongMetadata(),
                },
                undefined,
                false,
                false,
                'POST'
            ) as PlaybackEmitResponse;

            if (response?.status === 'success' && typeof response.id === 'number') {
                this.playbackEmitId = response.id;
            }
        } catch (error) {
            this.reportPluginError('emit playback status', error);
        } finally {
            this.playbackEmitInFlight = false;
            if (this.playbackEmitPending) {
                this.playbackEmitPending = false;
                void this.maybeEmitPlaybackStatus(true);
            }
        }
    }

    private isAccountSyncEnabled() {
        return getConfig<boolean>('playback.account_sync_enabled') ?? true;
    }

    private isObservingRemotePlayback() {
        return Boolean(this.accountRemotePlayback && !this.activePlugin && !this.activeOutputPlugin && !this.audio.src);
    }

    private isOwnPlaybackRow(row: AccountPlaybackRow) {
        if (row.playback_metadata?.client_instance_id) {
            return row.playback_metadata.client_instance_id === getClientInstanceId();
        }

        const localDevice = getLocalOutputDevice();

        return (
            row.device_identifier === localDevice.device_identifier &&
            row.device_type === localDevice.device_type
        );
    }

    private initAccountPlaybackEvents() {
        window.addEventListener('omniplayr:frontend-event', event => {
            const customEvent = event as CustomEvent<{ event?: string; data?: { playback?: AccountPlaybackRow } }>;
            if (customEvent.detail?.event !== 'player.playback_updated') return;

            const playback = customEvent.detail.data?.playback;
            if (!playback?.song_id || !playback.source_type || this.isOwnPlaybackRow(playback)) return;

            void this.applyAccountPlayback(playback);
        });
    }

    private parsePlaybackExtra(row: AccountPlaybackRow): Record<string, unknown> | undefined {
        const raw = row.song_metadata?.extra_data;
        if (!raw) return undefined;

        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed as Record<string, unknown>
                : undefined;
        } catch {
            return undefined;
        }
    }

    private metadataFromPlaybackRow(row: AccountPlaybackRow): TrackMetadata | null {
        const metadata = row.song_metadata;
        if (!metadata) return null;

        return {
            title: metadata.title ?? null,
            artist: metadata.artist ?? null,
            album: metadata.album ?? null,
            album_art: metadata.album_art ?? null,
            duration: metadata.length ?? null,
            genre: null,
            year: null,
            filename: null,
        };
    }

    private async resolvePlaybackDeviceId(row: AccountPlaybackRow): Promise<number | null> {
        if (!row.device_identifier || !row.device_type) return null;

        try {
            const response = await api('/plugin/devices/list') as { devices?: AccountDeviceRow[] };
            const match = (response.devices ?? []).find(device => (
                typeof device.id === 'number' &&
                device.status !== 'unconnectable' &&
                device.identifier === row.device_identifier &&
                device.type === row.device_type
            ));

            return typeof match?.id === 'number' ? match.id : null;
        } catch (error) {
            this.reportPluginError('resolve playback device', error);
            return null;
        }
    }

    private async sendPlaybackCommandToDevice(targetDeviceId: number | null | undefined, type: string, payload: Record<string, unknown> = {}) {
        if (targetDeviceId === null || targetDeviceId === undefined) return false;

        await api(
            `/plugin/device/${targetDeviceId}/command`,
            { type, payload },
            undefined,
            true,
            false,
            'POST',
        );
        return true;
    }

    private sendRemotePlaybackCommand(type: string, payload: Record<string, unknown> = {}) {
        return this.sendPlaybackCommandToDevice(this.accountRemotePlayback?.targetDeviceId, type, payload);
    }

    private getRemotePlaybackDeviceLabel(row: AccountPlaybackRow) {
        return row.device_label
            || row.playback_metadata?.started_on_device?.label
            || row.device_type
            || i18n.t('player.sync.device');
    }

    private seekToSeconds(seconds: number) {
        if (!Number.isFinite(seconds) || seconds < 0) return;

        const duration = this.duration;
        if (duration > 0) {
            this.seek(Math.max(0, Math.min(1, seconds / duration)));
            return;
        }

        if (!this.activePlugin && !this.activeOutputPlugin) {
            this.audio.currentTime = seconds;
        }
    }

    private async applyAccountPlayback(row: AccountPlaybackRow) {
        if (!row.song_id || !row.source_type) return;

        const metadata = row.playback_metadata ?? {};
        const targetTime = typeof metadata.current_time === 'number' ? metadata.current_time : 0;
        const trackKey = `${row.source_type}:${row.song_id}`;
        const currentKey = this.currentSongId && this.currentSourceType
            ? `${this.currentSourceType}:${this.currentSongId}`
            : null;
        const driftThreshold = Math.max(1, getConfig<number>('playback.account_sync_drift_seconds') ?? 3);
        const previousRemoteTime = this.accountRemotePlayback?.row.playback_metadata?.current_time;
        const remoteTimeChanged = typeof previousRemoteTime === 'number'
            ? Math.abs(targetTime - previousRemoteTime) >= driftThreshold
            : false;
        const drift = this.isObservingRemotePlayback()
            ? 0
            : Math.abs((this.currentTime || 0) - targetTime);
        const statusMismatch = row.playback_status !== this.accountRemotePlayback?.row.playback_status;
        const trackChanged = currentKey !== trackKey;
        const previousVolume = this.accountRemotePlayback?.row.playback_metadata?.volume;
        const volumeChanged = typeof metadata.volume === 'number'
            && metadata.volume !== previousVolume
            && Math.abs((metadata.volume / 100) - this._volumeFraction) > 0.001;

        if (!trackChanged && !statusMismatch && !remoteTimeChanged && !volumeChanged && drift < driftThreshold) return;

        this.accountSyncApplying = true;

        try {
            if (this.activePlugin) {
                this.safelyDestroyPlugin(this.activePlugin);
                this.activePlugin = null;
            }
            if (this.activeOutputPlugin) {
                this.safelyStopOutputPlugin(this.activeOutputPlugin);
                this.activeOutputPlugin = null;
            }
            this.audio.pause();
            this.audio.removeAttribute('src');
            this.audio.load();

            if (typeof metadata.shuffle === 'boolean') this.shuffle = metadata.shuffle;
            if (metadata.repeat_one) this.repeat = 'one';
            else if (metadata.repeat) this.repeat = 'all';
            else this.repeat = 'off';
            if (typeof metadata.volume === 'number' && Number.isFinite(metadata.volume)) {
                this._volumeFraction = Math.max(0, Math.min(1, metadata.volume / 100));
            }

            this.currentSongId = row.song_id;
            this.currentSourceType = row.source_type;
            this.currentExtra = this.parsePlaybackExtra(row) ?? null;
            this.currentMetadata = this.metadataFromPlaybackRow(row);
            this.currentSongFromNextQueue = false;
            this.isLoading = row.playback_status === 'loading';
            this.accountSyncLastTrackKey = trackKey;
            this.accountRemotePlayback = {
                row,
                receivedAt: Date.now(),
                targetDeviceId: await this.resolvePlaybackDeviceId(row),
            };
            this.updateMediaSessionMetadata();
            this.notify();
        } finally {
            window.setTimeout(() => {
                this.accountSyncApplying = false;
            }, 100);
        }
    }

    private async syncAccountPlayback() {
        if (!this.isAccountSyncEnabled() || this.accountSyncInFlight || this.accountSyncApplying) return;
        if (!localStorage.getItem('access_token') || !getAccount()) return;

        this.accountSyncInFlight = true;

        try {
            const response = await api('/player/playback/list?all_info=true&limit=10') as {
                playbacks?: AccountPlaybackRow[];
            };
            const playback = (response.playbacks ?? [])
                .find(row => row.song_id && row.source_type && !this.isOwnPlaybackRow(row));

            if (playback) {
                await this.applyAccountPlayback(playback);
            } else if (this.isObservingRemotePlayback()) {
                this.accountRemotePlayback = null;
                this.currentSongId = null;
                this.currentSourceType = null;
                this.currentExtra = null;
                this.currentMetadata = null;
                this.isLoading = false;
                this.accountSyncLastTrackKey = null;
                this.notify();
            } else if (!this.currentSongId) {
                this.accountSyncLastTrackKey = null;
            }
        } catch (error) {
            this.reportPluginError('sync account playback', error);
        } finally {
            this.accountSyncInFlight = false;
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

                streamUrl: null,
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

    async restoreCurrentTrackState() {
        if (this.persistedTrackRestoreStarted) return;
        this.persistedTrackRestoreStarted = true;

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
            this.resumePlayback();
        });

        navigator.mediaSession.setActionHandler('pause', () => {
            if (this.isTransitioning) return;
            this.pauseWithOptionalFade();
        });

        navigator.mediaSession.setActionHandler('nexttrack', () => this.skip());
        navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());

        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime !== undefined) {
                this.seekToSeconds(details.seekTime);
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

                if (!accountToken) return;

                const headers = {
                    Authorization: `Bearer ${token}`,
                    'X-Account-Token': String(accountToken),
                };

                const signal = controller.signal;
                const streamUrl = buildAuthenticatedStreamUrl(baseUrl, next.sourceType, next.songId, token, accountToken);

                const metaRes = await fetch(`${baseUrl}/api/player/media/${next.sourceType}:${encoded}`, { headers, signal });

                if (!metaRes.ok || signal.aborted) return;

                const metaJson = await metaRes.json();

                if (signal.aborted) return;

                for (const [k] of this.prefetchCache) {
                    this.prefetchCache.delete(k);
                }

                this.prefetchCache.set(cacheKey, {
                    streamUrl,
                    metadata: metaJson.metadata as TrackMetadata,
                    contentType: typeof metaJson.content_type === 'string' ? metaJson.content_type : null,
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

    private reportPluginError(context: string, error: unknown) {
        console.error(`[player] Plugin ${context} failed:`, error);
    }

    private safelyDestroyPlugin(plugin: SourcePlugin, options?: { transferred?: boolean }) {
        try {
            Promise.resolve(plugin.destroy(options)).catch(error => {
                this.reportPluginError('destroy', error);
            });
        } catch (error) {
            this.reportPluginError('destroy', error);
        }
    }

    private safelyActivatePlugin(plugin: SourcePlugin) {
        try {
            Promise.resolve(plugin.activate?.()).catch(error => {
                this.reportPluginError('activate', error);
            });
        } catch (error) {
            this.reportPluginError('activate', error);
        }
    }

    private safelySetPluginVolume(plugin: SourcePlugin, fraction: number) {
        try {
            Promise.resolve(plugin.setVolume?.(fraction)).catch(error => {
                this.reportPluginError('set volume', error);
            });
        } catch (error) {
            this.reportPluginError('set volume', error);
        }
    }

    private safelySetPluginTransientVolume(plugin: SourcePlugin | null, fraction: number) {
        try {
            Promise.resolve(plugin?.setTransientVolume?.(fraction)).catch(error => {
                this.reportPluginError('set transient volume', error);
            });
        } catch (error) {
            this.reportPluginError('set transient volume', error);
        }
    }

    private safelyStopOutputPlugin(plugin: AudioOutputPlugin | null) {
        try {
            Promise.resolve(plugin?.stop?.()).catch(error => {
                this.reportPluginError('stop output', error);
            });
        } catch (error) {
            this.reportPluginError('stop output', error);
        }
    }

    private safelyPauseOutputPlugin(plugin: AudioOutputPlugin) {
        try {
            Promise.resolve(plugin.pause?.()).catch(error => {
                this.reportPluginError('pause output', error);
            });
        } catch (error) {
            this.reportPluginError('pause output', error);
        }
    }

    private safelyResumeOutputPlugin(plugin: AudioOutputPlugin) {
        try {
            Promise.resolve(plugin.resume?.()).catch(error => {
                this.reportPluginError('resume output', error);
            });
        } catch (error) {
            this.reportPluginError('resume output', error);
        }
    }

    private safelySeekOutputPlugin(plugin: AudioOutputPlugin, seconds: number) {
        try {
            Promise.resolve(plugin.seek?.(seconds)).catch(error => {
                this.reportPluginError('seek output', error);
            });
        } catch (error) {
            this.reportPluginError('seek output', error);
        }
    }

    private safelySetOutputPluginVolume(plugin: AudioOutputPlugin | null, fraction: number) {
        try {
            Promise.resolve(plugin?.setVolume?.(fraction)).catch(error => {
                this.reportPluginError('set output volume', error);
            });
        } catch (error) {
            this.reportPluginError('set output volume', error);
        }
    }

    private safelyPausePlugin(plugin: SourcePlugin) {
        try {
            Promise.resolve(plugin.pause()).catch(error => {
                this.reportPluginError('pause', error);
            });
        } catch (error) {
            this.reportPluginError('pause', error);
        }
    }

    private safelyResumePlugin(plugin: SourcePlugin) {
        try {
            Promise.resolve(plugin.resume()).catch(error => {
                this.reportPluginError('resume', error);
            });
        } catch (error) {
            this.reportPluginError('resume', error);
        }
    }

    private safelySeekPlugin(plugin: SourcePlugin, seconds: number) {
        try {
            Promise.resolve(plugin.seek(seconds)).catch(error => {
                this.reportPluginError('seek', error);
            });
        } catch (error) {
            this.reportPluginError('seek', error);
        }
    }

    private advanceAfterEnd() {
        if (this.endAdvanceInProgress) return;
        this.endAdvanceInProgress = true;
        this.clearCurrentTrackState();
        this.next().catch(error => {
            this.reportPluginError('advance to next track', error);
        }).finally(() => {
            this.endAdvanceInProgress = false;
        });
    }

    private advanceAfterPlaybackFailure() {
        if (this.playbackFailureAdvancePending) return;

        this.playbackFailureAdvancePending = true;
        this.playbackFailureTimer = setTimeout(
            () => this.finishPendingPlaybackFailureAdvance(),
            PLAYBACK_FAILURE_GRACE_MS
        );
    }

    private cancelPendingPlaybackFailure() {
        if (this.playbackFailureTimer) {
            clearTimeout(this.playbackFailureTimer);
            this.playbackFailureTimer = null;
        }
        this.playbackFailureAdvancePending = false;
    }

    private finishPendingPlaybackFailureAdvance() {
        this.playbackFailureTimer = null;
        if (!this.playbackFailureAdvancePending) return;

        if (this.isTransitioning) {
            this.playbackFailureTimer = setTimeout(
                () => this.finishPendingPlaybackFailureAdvance(),
                250
            );
            return;
        }

        this.playbackFailureAdvancePending = false;
        createToast({
            id: `playback-failure-${Date.now()}`,
            message: i18n.t('player.toast.playback_failed'),
            type: 'info',
            duration: 5000,
            dismissable: true,
        });
        this.clearCurrentTrackState();
        this.next(true).catch(error => {
            this.reportPluginError('advance after playback failure', error);
        });
    }

    private startNext(context: string) {
        this.next().catch(error => {
            this.reportPluginError(context, error);
        });
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
                this.advanceAfterEnd();
            }
        }, 200);
    }

    private stopEndWatcher() {
        if (this.endCheckInterval) {
            clearInterval(this.endCheckInterval);
            this.endCheckInterval = null;
        }
    }

    private getSelectedOutputPlugin(): AudioOutputPlugin | null {
        if (this.selectedOutput.pluginId === LOCAL_OUTPUT_PLUGIN_ID) return null;
        return this.outputPlugins.get(this.selectedOutput.pluginId) ?? null;
    }

    private getOutputDeviceKey(pluginId: string, device: AudioOutputDevice) {
        return `${pluginId}:${device.device_type}:${device.device_identifier}`;
    }

    private isLocalOutputSelected() {
        return this.selectedOutput.pluginId === LOCAL_OUTPUT_PLUGIN_ID;
    }

    private async playOnSelectedOutput(request: Omit<AudioOutputPlaybackRequest, 'device'>): Promise<boolean> {
        const outputPlugin = this.getSelectedOutputPlugin();
        if (!outputPlugin) return false;
        const playbackRequest = {
            ...request,
            device: this.selectedOutput.device,
        };
        const canPlay = outputPlugin.canPlay?.(playbackRequest);

        if (canPlay === false) {
            throw new Error('The selected output device cannot play this track.');
        }

        if (typeof canPlay === 'string') {
            throw new Error(canPlay);
        }

        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load();

        if (this.activeOutputPlugin && this.activeOutputPlugin !== outputPlugin) {
            this.safelyStopOutputPlugin(this.activeOutputPlugin);
        }

        this.activeOutputPlugin = outputPlugin;
        await outputPlugin.play(
            playbackRequest,
            {
                onReady: () => {
                    this.cancelPendingPlaybackFailure();
                    this.isLoading = false;
                    this.startEndWatcher();
                    this.notify();
                },
                onEnded: () => this.advanceAfterEnd(),
                onStateChange: () => this.notify(),
                onError: (error) => {
                    this.reportPluginError('output playback', error);
                    this.advanceAfterPlaybackFailure();
                },
            }
        );
        this.safelySetOutputPluginVolume(outputPlugin, this._volumeFraction);
        return true;
    }

    private getOutputGain(fraction = this._volumeFraction) {
        const f = Math.max(0, Math.min(1, fraction));
        const minDb = -60;
        const db = minDb + f * Math.abs(minDb);

        return Math.max(MIN_GAIN, Math.pow(10, db / 20));
    }

    private applyOutputVolume(fraction = this._volumeFraction) {
        if (!this.gainNode || !this.ctx) return;

        this.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
        this.gainNode.gain.setTargetAtTime(this.getOutputGain(fraction), this.ctx.currentTime, 0.01);
    }

    private cancelPauseFade() {
        this.fadeNonce += 1;
        this.isPauseFadePending = false;
        this.isPauseRequested = false;

        if (this.fadeFrame !== null) {
            cancelAnimationFrame(this.fadeFrame);
            this.fadeFrame = null;
        }

        this.applyOutputVolume();
        this.safelySetPluginTransientVolume(this.activePlugin, this._volumeFraction);
        this.syncMediaSessionState();
    }

    private shouldFadeOnPause() {
        return Boolean(getConfig<boolean>('volume.fade_on_pause')) && (getConfig<number>('volume.pause_fade_ms') ?? 350) > 0;
    }

    private pauseImmediately() {
        this.isPauseRequested = true;
        this.syncMediaSessionState();
        this.notify();

        if (this.activePlugin) this.safelyPausePlugin(this.activePlugin);
        else if (this.activeOutputPlugin) this.safelyPauseOutputPlugin(this.activeOutputPlugin);
        else this.audio.pause();
        this.requestPlaybackStatusEmit();
    }

    private resumePlayback() {
        this.cancelPauseFade();

        if (this.activePlugin) this.safelyResumePlugin(this.activePlugin);
        else if (this.activeOutputPlugin) this.safelyResumeOutputPlugin(this.activeOutputPlugin);
        else this.audio.play();

        this.syncMediaSessionState();
        this.notify();
        this.requestPlaybackStatusEmit();
    }

    private pauseWithOptionalFade() {
        if (!this.shouldFadeOnPause()) {
            this.cancelPauseFade();
            this.pauseImmediately();
            return;
        }

        const durationMs = Math.max(0, getConfig<number>('volume.pause_fade_ms') ?? 350);
        const nonce = ++this.fadeNonce;
        this.isPauseFadePending = true;
        this.isPauseRequested = true;
        this.syncMediaSessionState();
        this.notify();
        this.requestPlaybackStatusEmit();

        if (this.fadeFrame !== null) {
            cancelAnimationFrame(this.fadeFrame);
            this.fadeFrame = null;
        }

        if (this.activePlugin) {
            if (!this.activePlugin.setTransientVolume) {
                this.isPauseFadePending = false;
                this.pauseImmediately();
                return;
            }

            const startedAt = performance.now();
            const from = this._volumeFraction;

            const step = (now: number) => {
                if (nonce !== this.fadeNonce) return;

                const progress = Math.min(1, (now - startedAt) / durationMs);
                this.safelySetPluginTransientVolume(this.activePlugin, from * (1 - progress));

                if (progress < 1) {
                    this.fadeFrame = requestAnimationFrame(step);
                    return;
                }

                this.fadeFrame = null;
                if (this.activePlugin) this.safelyPausePlugin(this.activePlugin);
                this.safelySetPluginTransientVolume(this.activePlugin, this._volumeFraction);
                this.isPauseFadePending = false;
                this.notify();
            };

            this.fadeFrame = requestAnimationFrame(step);
            return;
        }

        if (this.activeOutputPlugin) {
            this.pauseImmediately();
            return;
        }

        if (!this.gainNode || !this.ctx) {
            this.audio.pause();
            this.isPauseFadePending = false;
            return;
        }

        const now = this.ctx.currentTime;

        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(Math.max(this.gainNode.gain.value, MIN_GAIN), now);
        this.gainNode.gain.linearRampToValueAtTime(MIN_GAIN, now + durationMs / 1000);

        window.setTimeout(() => {
            if (nonce !== this.fadeNonce) return;

            this.audio.pause();
            this.isPauseFadePending = false;
            this.applyOutputVolume();
            this.notify();
        }, durationMs);
    }

    addToQueue(songId: string, sourceType: string, extra?: Record<string, unknown>) {
        this.priorityQueue.push({ songId, sourceType, extra });

        if (!this.currentSongId && !this.isTransitioning) {
            this.startNext('start queued track');
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
            this.startNext('start next queue');
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
            this.startNext('start appended queue');
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
        if (this.isObservingRemotePlayback()) {
            const nextShuffle = !this.shuffle;
            void this.sendRemotePlaybackCommand('shuffle', { enabled: nextShuffle })
                .then(sent => {
                    if (!sent) return;
                    this.shuffle = nextShuffle;
                    if (this.accountRemotePlayback?.row.playback_metadata) {
                        this.accountRemotePlayback.row.playback_metadata.shuffle = nextShuffle;
                    }
                    this.notify();
                })
                .catch(error => this.reportPluginError('remote shuffle', error));
            return;
        }

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
        this.requestPlaybackStatusEmit();
    }

    cycleRepeat() {
        if (this.isObservingRemotePlayback()) {
            const nextRepeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
            void this.sendRemotePlaybackCommand('repeat', { mode: nextRepeat })
                .then(sent => {
                    if (!sent) return;
                    this.repeat = nextRepeat;
                    if (this.accountRemotePlayback?.row.playback_metadata) {
                        this.accountRemotePlayback.row.playback_metadata.repeat = nextRepeat === 'all';
                        this.accountRemotePlayback.row.playback_metadata.repeat_one = nextRepeat === 'one';
                    }
                    this.notify();
                })
                .catch(error => this.reportPluginError('remote repeat', error));
            return;
        }

        if (this.repeat === 'off') this.repeat = 'all';
        else if (this.repeat === 'all') this.repeat = 'one';
        else this.repeat = 'off';

        this.savePlaybackState();
        this.schedulePrefetch();
        this.notify();
        this.requestPlaybackStatusEmit();
    }

    async next(ignoreRepeatOne = false) {
        if (this.isObservingRemotePlayback()) {
            void this.sendRemotePlaybackCommand('next').catch(error => this.reportPluginError('remote next', error));
            return;
        }

        if (this.isTransitioning) return;

        if (!ignoreRepeatOne && this.repeat === 'one' && this.currentSongId) {
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
        if (this.isObservingRemotePlayback()) {
            void this.sendRemotePlaybackCommand('prev').catch(error => this.reportPluginError('remote previous', error));
            return;
        }

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
        if (this.isObservingRemotePlayback()) {
            void this.sendRemotePlaybackCommand('next').catch(error => this.reportPluginError('remote skip', error));
            return;
        }

        this.cancelPauseFade();
        this.audio.pause();
        this.next().catch(error => {
            this.reportPluginError('skip to next track', error);
        });
    }

    async playSong(
        songId: string,
        sourceType: string,
        extra?: Record<string, unknown>,
        fromNextQueue = false,
        autoplay = true
    ) {
        this.cancelPendingPlaybackFailure();
        this.accountRemotePlayback = null;
        const plugin = this.plugins.get(sourceType);
        this.stopEndWatcher();

        if (plugin) {
            if (autoplay && this.getSelectedOutputPlugin()) {
                const outputPlugin = this.getSelectedOutputPlugin();

                if (this.activePlugin) {
                    this.cancelPauseFade();
                    this.safelyDestroyPlugin(this.activePlugin, { transferred: true });
                    this.activePlugin = null;
                }

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
                this.resetPlaybackEmitState(this.getIntendedPlaybackDevice());

                this.notify();
                this.notifyTrackChange();
                this.requestPlaybackStatusEmit();

                try {
                    const canPlay = outputPlugin?.canPlay?.({
                        songId,
                        sourceType,
                        streamUrl: '',
                        contentType: null,
                        metadata: null,
                        extra,
                        device: this.selectedOutput.device,
                    });

                    if (canPlay === false) throw new Error('The selected output device cannot play this track.');
                    if (typeof canPlay === 'string') throw new Error(canPlay);

                    const encoded = encodeURIComponent(songId);
                    const media = await api(`/player/media/${sourceType}:${encoded}`) as {
                        metadata?: TrackMetadata;
                        stream_url?: string;
                        content_type?: string | null;
                    };

                    this.currentMetadata = media.metadata ?? null;
                    this.lastStreamUrl = media.stream_url ?? '';
                    this.updateMediaSessionMetadata();
                    this.isLoading = false;
                    this.notify();

                    await this.playOnSelectedOutput({
                        songId,
                        sourceType,
                        streamUrl: this.lastStreamUrl,
                        contentType: media.content_type ?? null,
                        metadata: this.currentMetadata,
                        extra,
                    });

                    this.saveCurrentTrackState();
                    this.schedulePrefetch();
                    this.requestPlaybackStatusEmit();
                } catch (error) {
                    if (outputPlugin?.canPlay) {
                        console.warn('Selected output cannot play this track; falling back to this device.', error);
                        this.selectedOutput = { pluginId: LOCAL_OUTPUT_PLUGIN_ID, device: getLocalOutputDevice() };
                        this.saveSelectedOutputDevice();
                        this.safelyStopOutputPlugin(this.activeOutputPlugin);
                        this.activeOutputPlugin = null;
                        this.skipHistoryPush = true;
                        await this.playSong(songId, sourceType, extra, fromNextQueue, autoplay);
                        return;
                    }

                    this.reportPluginError(`output playback for ${sourceType}:${songId}`, error);
                    this.advanceAfterPlaybackFailure();
                } finally {
                    this.isLoading = false;
                    this.isTransitioning = false;
                    this.notify();
                }

                return;
            }

            this.isTransitioning = true;
            this.isLoading = true;

            if (this.activeOutputPlugin) {
                this.safelyStopOutputPlugin(this.activeOutputPlugin);
                this.activeOutputPlugin = null;
            }

            if (this.activePlugin && this.activePlugin !== plugin) {
                this.cancelPauseFade();
                this.safelyDestroyPlugin(this.activePlugin);
            }

            if (!this.plugins.has(this.currentSourceType ?? '')) {
                this.audio.pause();
            }

            this.activePlugin = plugin;
            this.safelyActivatePlugin(plugin);

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
            this.resetPlaybackEmitState(this.getActivePlaybackDevice());

            this.notify();
            this.notifyTrackChange();
            this.requestPlaybackStatusEmit();

            try {
                await plugin.play(songId, extra, autoplay, {
                    onMetadata: (meta) => {
                        this.currentMetadata = meta;
                        this.updateMediaSessionMetadata();
                        this.notify();
                        this.requestPlaybackStatusEmit();
                    },
                    onReady: () => {
                        this.cancelPendingPlaybackFailure();
                        this.isLoading = false;
                        this.startEndWatcher();
                        this.notify();
                        this.requestPlaybackStatusEmit();
                    },

                    onEnded: () => {
                        this.advanceAfterEnd();
                    },
                    onStateChange: () => {
                        this.notify();
                    },
                });
                this.schedulePrefetch();
            } catch (error) {
                this.reportPluginError(`playback for ${sourceType}:${songId}`, error);
                this.advanceAfterPlaybackFailure();
            } finally {
                this.isLoading = false;
                this.isTransitioning = false;
                this.notify();
            }

            return;
        }

        if (this.activePlugin) {
            this.cancelPauseFade();
            this.safelyDestroyPlugin(this.activePlugin);
            this.activePlugin = null;
        }
        if (this.activeOutputPlugin && this.isLocalOutputSelected()) {
            this.safelyStopOutputPlugin(this.activeOutputPlugin);
            this.activeOutputPlugin = null;
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
        this.resetPlaybackEmitState(this.getIntendedPlaybackDevice());

        this.notify();
        this.notifyTrackChange();
        this.requestPlaybackStatusEmit();

        try {
            const cacheKey = `${sourceType}:${songId}`;
            const cached = this.prefetchCache.get(cacheKey);
            let contentType: string | null = null;

            if (cached) {
                this.prefetchCache.delete(cacheKey);

                this.currentMetadata = cached.metadata;
                this.lastStreamUrl = cached.streamUrl;
                contentType = cached.contentType;
                if (this.isLocalOutputSelected() || !this.getSelectedOutputPlugin()) {
                    this.audio.src = cached.streamUrl;
                }

                this.isLoading = false;

                this.notify();
                this.requestPlaybackStatusEmit();
            } else {
                const baseUrl = getConfig<string>('api.apiUrl') ?? '';
                const accountToken = getAccount();

                const headers = {
                    Authorization: `Bearer ${token}`,
                    'X-Account-Token': String(accountToken),
                };

                const encoded = encodeURIComponent(songId);

                this.lastStreamUrl = buildAuthenticatedStreamUrl(baseUrl, sourceType, songId, token, accountToken);

                const metaRes = await fetch(`${baseUrl}/api/player/media/${sourceType}:${encoded}`, { headers });

                if (!metaRes.ok) {
                    throw new Error(`Metadata fetch failed: ${metaRes.status}`);
                }

                const metaJson = await metaRes.json();

                this.currentMetadata = metaJson.metadata as TrackMetadata;
                contentType = typeof metaJson.content_type === 'string' ? metaJson.content_type : null;

                this.notify();
                this.requestPlaybackStatusEmit();

                if (this.isLocalOutputSelected() || !this.getSelectedOutputPlugin()) {
                    this.audio.src = this.lastStreamUrl;
                }

                this.isLoading = false;

                this.notify();
                this.requestPlaybackStatusEmit();
            }

            this.updateMediaSessionMetadata();

            const playedOnExternalOutput = autoplay && this.lastStreamUrl
                ? await this.playOnSelectedOutput({
                    songId,
                    sourceType,
                    streamUrl: this.lastStreamUrl,
                    contentType,
                    metadata: this.currentMetadata,
                    extra,
                })
                : false;

            if (autoplay && this.ctx?.state === 'suspended' && !playedOnExternalOutput) {
                await this.ctx.resume();
            }

            if (autoplay && !playedOnExternalOutput) {
                try {
                    await this.audio.play();
                } catch (error) {
                    if (isAbortError(error)) return;
                    this.advanceAfterPlaybackFailure();
                    throw error;
                }
                this.startEndWatcher();
            }

            this.saveCurrentTrackState();
            this.schedulePrefetch();
            this.requestPlaybackStatusEmit();
        } catch (error) {
            if (isAbortError(error)) return;
            this.reportPluginError(`playback for ${sourceType}:${songId}`, error);
            this.advanceAfterPlaybackFailure();
        } finally {
            this.isLoading = false;
            this.isTransitioning = false;
            this.notify();
        }
    }

    togglePlay() {
        if (this.isObservingRemotePlayback()) {
            const nextType = this.isPlaying ? 'pause' : 'resume';
            void this.sendRemotePlaybackCommand(nextType)
                .then(sent => {
                    if (!sent || !this.accountRemotePlayback) return;
                    this.accountRemotePlayback.row.playback_status = nextType === 'pause' ? 'paused' : 'playing';
                    this.accountRemotePlayback.receivedAt = Date.now();
                    this.notify();
                })
                .catch(error => this.reportPluginError(`remote ${nextType}`, error));
            return;
        }

        if (this.activePlugin) {
            this.safelyActivatePlugin(this.activePlugin);
            if (this.isPlaying) {
                this.pauseWithOptionalFade();
            } else {
                this.resumePlayback();
            }
            this.notify();
            return;
        }
        if (this.activeOutputPlugin) {
            if (this.isPlaying) {
                this.pauseWithOptionalFade();
            } else {
                this.resumePlayback();
            }
            this.notify();
            return;
        }
        if (!this.audio.src) return;
        if (!this.isPlaying) {
            this.resumePlayback();
        } else {
            this.pauseWithOptionalFade();
        }
    }

    seek(fraction: number) {
        if (this.isObservingRemotePlayback()) {
            const duration = this.duration;
            const seconds = duration * Math.max(0, Math.min(1, fraction));
            void this.sendRemotePlaybackCommand('seek', { seconds })
                .then(sent => {
                    if (!sent || !this.accountRemotePlayback) return;
                    this.accountRemotePlayback.row.playback_metadata = {
                        ...(this.accountRemotePlayback.row.playback_metadata ?? {}),
                        current_time: seconds,
                    };
                    this.accountRemotePlayback.receivedAt = Date.now();
                    this.notify();
                })
                .catch(error => this.reportPluginError('remote seek', error));
            return;
        }

        if (this.activePlugin) {
            this.safelySeekPlugin(this.activePlugin, this.activePlugin.getDuration() * Math.max(0, Math.min(1, fraction)));
            return;
        }
        if (this.activeOutputPlugin) {
            const duration = this.duration;
            if (!duration) return;
            this.safelySeekOutputPlugin(this.activeOutputPlugin, duration * Math.max(0, Math.min(1, fraction)));
            return;
        }
        if (!this.audio.duration) return;
        this.audio.currentTime = this.audio.duration * Math.max(0, Math.min(1, fraction));
        this.saveCurrentTrackState();
    }

    setVolume(fraction: number) {
        const f = Math.max(0, Math.min(1, fraction));
        this._volumeFraction = f;

        if (this.isObservingRemotePlayback()) {
            void this.sendRemotePlaybackCommand('volume', { fraction: f })
                .then(sent => {
                    if (!sent || !this.accountRemotePlayback) return;
                    this.accountRemotePlayback.row.playback_metadata = {
                        ...(this.accountRemotePlayback.row.playback_metadata ?? {}),
                        volume: Math.round(f * 100),
                    };
                    this.notify();
                })
                .catch(error => this.reportPluginError('remote volume', error));
            return;
        }

        if (!this.gainNode || !this.ctx) return;

        this.applyOutputVolume(f);

        const storage = getVolumeStorage();
        storage?.setItem(VOLUME_STORAGE_KEY, String(f));

        if (this.activePlugin) this.safelySetPluginVolume(this.activePlugin, f);
        this.safelySetOutputPluginVolume(this.activeOutputPlugin, f);
        this.notify();
        this.requestPlaybackStatusEmit();
    }

    selectLocalOutputDevice() {
        const previousPlugin = this.activeOutputPlugin;
        this.selectedOutput = { pluginId: LOCAL_OUTPUT_PLUGIN_ID, device: getLocalOutputDevice() };
        this.saveSelectedOutputDevice();
        this.safelyStopOutputPlugin(previousPlugin);
        this.activeOutputPlugin = null;
        this.notify();
    }

    async playSyncedPlaybackHere(stopRemote = false) {
        const remote = this.accountRemotePlayback;
        if (!remote?.row.song_id || !remote.row.source_type) return;

        const songId = remote.row.song_id;
        const sourceType = remote.row.source_type;
        const extra = this.parsePlaybackExtra(remote.row);
        const currentTime = this.currentTime;
        const shouldAutoplay = remote.row.playback_status === 'playing';
        const targetDeviceId = remote.targetDeviceId;

        this.selectLocalOutputDevice();

        await this.playSong(songId, sourceType, extra, false, shouldAutoplay);

        if (currentTime > 0 && this.duration > 0) {
            this.seek(Math.max(0, Math.min(1, currentTime / this.duration)));
        }

        if (stopRemote) {
            void this.sendPlaybackCommandToDevice(targetDeviceId, 'stop')
                .catch(error => this.reportPluginError('remote stop after switch', error));
        }
    }

    registerPlugin(sourceType: string, plugin: SourcePlugin | null) {
        if (plugin === null) {
            this.plugins.delete(sourceType);
        } else {
            this.plugins.set(sourceType, plugin);
        }
    }

    registerOutputPlugin(pluginId: string, plugin: AudioOutputPlugin | null) {
        if (plugin === null) {
            const existing = this.outputPlugins.get(pluginId);
            if (existing && existing === this.activeOutputPlugin) {
                this.safelyStopOutputPlugin(existing);
                this.activeOutputPlugin = null;
            }
            this.outputPlugins.delete(pluginId);
            if (this.selectedOutput.pluginId === pluginId) {
                this.selectedOutput = { pluginId: LOCAL_OUTPUT_PLUGIN_ID, device: getLocalOutputDevice() };
                this.saveSelectedOutputDevice();
            }
        } else {
            this.outputPlugins.set(pluginId, plugin);
        }
        this.notify();
    }

    getOutputDevices() {
        const devices = [{ pluginId: LOCAL_OUTPUT_PLUGIN_ID, device: getLocalOutputDevice() }];

        for (const [pluginId, plugin] of this.outputPlugins) {
            try {
                for (const device of plugin.listDevices()) {
                    if (!device.device_identifier || !device.device_type) continue;
                    devices.push({
                        pluginId,
                        device: {
                            device_identifier: device.device_identifier,
                            device_type: device.device_type,
                            device_ip: device.device_ip ?? null,
                            label: device.label,
                        },
                    });
                }
            } catch (error) {
                this.reportPluginError('list output devices', error);
            }
        }

        return devices;
    }

    selectOutputDevice(pluginId: string, device: AudioOutputDevice) {
        if (!device.device_identifier || !device.device_type) {
            throw new Error('Output devices require device_identifier and device_type');
        }

        const previousPlugin = this.activeOutputPlugin;
        const nextDevice = pluginId === LOCAL_OUTPUT_PLUGIN_ID ? getLocalOutputDevice() : device;
        this.selectedOutput = {
            pluginId,
            device: {
                device_identifier: nextDevice.device_identifier,
                device_type: nextDevice.device_type,
                device_ip: nextDevice.device_ip ?? null,
                label: nextDevice.label,
            },
        };
        this.saveSelectedOutputDevice();
        this.playbackTransfers.push({
            device: this.normaliseDeviceInfo(this.selectedOutput.device),
            transferred_at: new Date().toISOString(),
        });
        this.lastPlaybackEmitAt = 0;
        this.requestPlaybackStatusEmit();

        if (pluginId === LOCAL_OUTPUT_PLUGIN_ID) {
            this.safelyStopOutputPlugin(previousPlugin);
            this.activeOutputPlugin = null;
            if (this.lastStreamUrl && this.currentSongId && !this.audio.src) {
                this.audio.src = this.lastStreamUrl;
            }
        } else if (
            this.currentSongId &&
            this.currentSourceType &&
            (this.lastStreamUrl || (this.activePlugin && this.getSelectedOutputPlugin()?.supportsSourcePlayback))
        ) {
            if (this.activePlugin && this.getSelectedOutputPlugin()?.supportsSourcePlayback) {
                this.cancelPauseFade();
                this.safelyDestroyPlugin(this.activePlugin, { transferred: true });
                this.activePlugin = null;
            }

            this.playOnSelectedOutput({
                songId: this.currentSongId,
                sourceType: this.currentSourceType,
                streamUrl: this.lastStreamUrl || '',
                contentType: null,
                metadata: this.currentMetadata,
                extra: this.currentExtra ?? undefined,
            }).catch(error => {
                this.reportPluginError('switch output device', error);
            });
        }

        this.notify();
    }

    get selectedOutputDevice() {
        return this.selectedOutput;
    }

    get selectedOutputDeviceKey() {
        return this.getOutputDeviceKey(this.selectedOutput.pluginId, this.selectedOutput.device);
    }

    get syncedPlaybackInfo(): SyncedPlaybackInfo | null {
        if (!this.isObservingRemotePlayback() || !this.accountRemotePlayback) return null;

        return {
            deviceLabel: this.getRemotePlaybackDeviceLabel(this.accountRemotePlayback.row),
            deviceType: this.accountRemotePlayback.row.device_type ?? null,
            isPlaying: this.accountRemotePlayback.row.playback_status === 'playing',
        };
    }

    get isPlaying() {
        if (this.isPauseRequested) return false;
        if (this.isPauseFadePending) return false;
        if (this.isObservingRemotePlayback()) return this.accountRemotePlayback?.row.playback_status === 'playing';
        if (this.activePlugin) return this.activePlugin.isPlaying();
        if (this.activeOutputPlugin?.isPlaying) return this.activeOutputPlugin.isPlaying();
        return !this.audio.paused && !this.audio.ended;
    }

    get currentTime() {
        if (this.isObservingRemotePlayback()) {
            const metadata = this.accountRemotePlayback?.row.playback_metadata;
            const base = typeof metadata?.current_time === 'number' ? metadata.current_time : 0;
            const elapsed = this.accountRemotePlayback?.row.playback_status === 'playing'
                ? (Date.now() - (this.accountRemotePlayback?.receivedAt ?? Date.now())) / 1000
                : 0;
            const duration = this.duration;
            const current = Math.max(0, base + elapsed);
            return duration > 0 ? Math.min(current, duration) : current;
        }
        if (this.activePlugin) return this.activePlugin.getCurrentTime();
        if (this.activeOutputPlugin?.getCurrentTime) return this.activeOutputPlugin.getCurrentTime();
        return this.audio.currentTime;
    }

    get duration() {
        if (this.isObservingRemotePlayback()) {
            return this.currentMetadata?.duration
                ?? this.accountRemotePlayback?.row.song_metadata?.length
                ?? 0;
        }
        if (this.activePlugin) return this.activePlugin.getDuration();
        if (this.activeOutputPlugin?.getDuration) return this.activeOutputPlugin.getDuration();
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

    get currentOutputVolume() {
        if (!this.analyserNode || !this.analyserData) return 0;

        this.analyserNode.getByteTimeDomainData(this.analyserData);

        let sum = 0;

        for (const value of this.analyserData) {
            const sample = (value - 128) / 128;
            sum += sample * sample;
        }

        return Math.sqrt(sum / this.analyserData.length);
    }
}

export const player = new AudioPlayer();

export function playSong(songId: string, sourceType: string, extra?: Record<string, unknown>) {
    return player.playSong(songId, sourceType, extra);
}
