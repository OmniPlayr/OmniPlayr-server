// Parser Action
// @devonly.all
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ComponentType, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import '../styles/DeveloperContext.css';
import '../styles/DeveloperPlaybackData.css';

const FLOOR_DB = -60;
const CEIL_DB = 0;
const DEV_OPTIONS_EVENT = 'omniplayr-dev-options-change';
const WINDOW_POSITION_KEY_PREFIX = 'omniplayr-dev-window-position';
const WINDOW_SIZE = { width: 320, height: 520 };
const PLAYBACK_WINDOW_SIZE = { width: 460, height: 440 };
const WINDOW_GAP = 10;

type BandKey = 'overall' | 'bass' | 'mid' | 'treble';
type PanelPosition = { x: number; y: number };
type DevWindowKey = 'audio_info' | 'network_info' | 'console_info' | "playback_data";
type NetworkEntry = {
    id: number;
    method: string;
    url: string;
    status: number | null;
    type: 'fetch' | 'xhr';
    startedAt: number;
    duration: number;
    requestBytes: number;
    responseBytes: number;
    ok: boolean;
};
type NetworkSnapshot = {
    entries: NetworkEntry[];
    totalRequests: number;
    failedRequests: number;
    sentBytes: number;
    receivedBytes: number;
    sessionStartedAt: number;
};
type ConsoleEntry = {
    id: number;
    level: 'log' | 'info' | 'warn' | 'error' | 'debug';
    message: string;
    timestamp: number;
};
type AudioStats = {
    averageHz: number;
    averageDb: number;
    dominantHz: number;
    dominantDb: number;
    rmsDb: number;
    sampleRate: number;
    fftSize: number;
    binResolution: number;
};
type DevWindowDefinition = {
    key: DevWindowKey;
    titleKey: string;
    enabledKey: string;
    defaultPosition: PanelPosition;
    Component: ComponentType;
};

type NetworkSubscriber = (snapshot: NetworkSnapshot) => void;
type ConsoleSubscriber = (entries: ConsoleEntry[]) => void;

type InstrumentedXMLHttpRequest = XMLHttpRequest & {
    __opDevMethod?: string;
    __opDevUrl?: string;
};

const BANDS: { key: BandKey; labelKey: string; low: number; high: number; peakBlend?: number; topRatio?: number }[] = [
    { key: 'overall', labelKey: 'developer.info.audio.band.overall', low: 0, high: 0 },
    { key: 'bass', labelKey: 'developer.info.audio.band.bass', low: 20, high: 250 },
    { key: 'mid', labelKey: 'developer.info.audio.band.mid', low: 250, high: 4000, peakBlend: 0.45, topRatio: 0.12 },
    { key: 'treble', labelKey: 'developer.info.audio.band.treble', low: 2800, high: 12000, peakBlend: 0.92, topRatio: 0.05 },
];

const networkState: NetworkSnapshot = {
    entries: [],
    totalRequests: 0,
    failedRequests: 0,
    sentBytes: 0,
    receivedBytes: 0,
    sessionStartedAt: Date.now(),
};
const networkSubscribers = new Set<NetworkSubscriber>();
const consoleEntries: ConsoleEntry[] = [];
const consoleSubscribers = new Set<ConsoleSubscriber>();
let nextNetworkId = 1;
let nextConsoleId = 1;
let instrumentationInstalled = false;

function formatUrl(url: string) {
    try {
        const parsed = new URL(url, window.location.href);
        return `${parsed.pathname}${parsed.search}`;
    } catch {
        return url;
    }
}

function bytesToText(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function msToText(ms: number) {
    if (ms < 1000) return `${ms.toFixed(0)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
}

function safeStorageSet(key: string, value: string) {
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        console.warn('Could not save developer window state.', error);
    }
}

function estimateBodyBytes(body: unknown) {
    if (!body) return 0;
    if (typeof body === 'string') return new Blob([body]).size;
    if (body instanceof Blob) return body.size;
    if (body instanceof ArrayBuffer) return body.byteLength;
    if (ArrayBuffer.isView(body)) return body.byteLength;
    if (body instanceof URLSearchParams) return new Blob([body.toString()]).size;
    if (body instanceof FormData) {
        let total = 0;
        body.forEach((value, key) => {
            total += new Blob([key]).size;
            total += typeof value === 'string' ? new Blob([value]).size : value.size;
        });
        return total;
    }
    return 0;
}

function getFetchRequestBytes(input: RequestInfo | URL, init?: RequestInit) {
    if (init?.body) return estimateBodyBytes(init.body);
    if (input instanceof Request) return estimateBodyBytes(input.body);
    return 0;
}

function getFetchMethod(input: RequestInfo | URL, init?: RequestInit) {
    return init?.method ?? (input instanceof Request ? input.method : 'GET');
}

function getFetchUrl(input: RequestInfo | URL) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    return input.url;
}

function emitNetworkSnapshot() {
    const snapshot = { ...networkState, entries: [...networkState.entries] };
    networkSubscribers.forEach((subscriber) => subscriber(snapshot));
}

function addNetworkEntry(entry: NetworkEntry) {
    networkState.entries = [entry, ...networkState.entries].slice(0, 60);
    networkState.totalRequests++;
    networkState.sentBytes += entry.requestBytes;
    networkState.receivedBytes += entry.responseBytes;
    if (!entry.ok) networkState.failedRequests++;
    emitNetworkSnapshot();
}

function subscribeNetwork(subscriber: NetworkSubscriber) {
    networkSubscribers.add(subscriber);
    subscriber({ ...networkState, entries: [...networkState.entries] });
    return () => {
        networkSubscribers.delete(subscriber);
    };
}

function serializeConsoleValue(value: unknown) {
    if (value instanceof Error) return value.stack ?? value.message;
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function emitConsoleEntries() {
    const entries = [...consoleEntries];
    consoleSubscribers.forEach((subscriber) => subscriber(entries));
}

function addConsoleEntry(level: ConsoleEntry['level'], args: unknown[]) {
    consoleEntries.unshift({
        id: nextConsoleId++,
        level,
        message: args.map(serializeConsoleValue).join(' '),
        timestamp: Date.now(),
    });
    consoleEntries.splice(100);
    emitConsoleEntries();
}

function subscribeConsole(subscriber: ConsoleSubscriber) {
    consoleSubscribers.add(subscriber);
    subscriber([...consoleEntries]);
    return () => {
        consoleSubscribers.delete(subscriber);
    };
}

function installDeveloperInstrumentation() {
    if (instrumentationInstalled) return;
    instrumentationInstalled = true;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const id = nextNetworkId++;
        const startedAt = Date.now();
        const startedPerf = performance.now();
        const requestBytes = getFetchRequestBytes(input, init);
        const method = getFetchMethod(input, init);
        const url = getFetchUrl(input);

        try {
            const response = await originalFetch(input, init);
            let responseBytes = Number(response.headers.get('content-length')) || 0;
            try {
                if (responseBytes === 0 && response.bodyUsed === false) {
                    const contentType = response.headers.get('content-type') ?? '';
                    if (!contentType.includes('stream')) {
                        responseBytes = (await response.clone().arrayBuffer()).byteLength;
                    }
                }
            } catch {
                responseBytes = Number(response.headers.get('content-length')) || 0;
            }

            addNetworkEntry({
                id,
                method,
                url,
                status: response.status,
                type: 'fetch',
                startedAt,
                duration: performance.now() - startedPerf,
                requestBytes,
                responseBytes,
                ok: response.ok,
            });
            return response;
        } catch (error) {
            addNetworkEntry({
                id,
                method,
                url,
                status: null,
                type: 'fetch',
                startedAt,
                duration: performance.now() - startedPerf,
                requestBytes,
                responseBytes: 0,
                ok: false,
            });
            throw error;
        }
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function open(
        this: InstrumentedXMLHttpRequest,
        method: string,
        url: string | URL,
        async?: boolean,
        username?: string | null,
        password?: string | null,
    ) {
        this.__opDevMethod = method;
        this.__opDevUrl = String(url);
        if (async === undefined) return (originalOpen as any).call(this, method, url);
        return (originalOpen as any).call(this, method, url, async, username, password);
    };
    XMLHttpRequest.prototype.send = function send(body) {
        const request = this as InstrumentedXMLHttpRequest;
        const id = nextNetworkId++;
        const startedAt = Date.now();
        const startedPerf = performance.now();
        const requestBytes = estimateBodyBytes(body);
        request.addEventListener('loadend', () => {
            const response = request.response;
            let responseBytes = 0;
            if (typeof response === 'string') {
                responseBytes = new Blob([response]).size;
            } else if (response instanceof ArrayBuffer) {
                responseBytes = response.byteLength;
            } else {
                try {
                    responseBytes = typeof request.responseText === 'string' ? new Blob([request.responseText]).size : 0;
                } catch {
                    responseBytes = 0;
                }
            }

            addNetworkEntry({
                id,
                method: request.__opDevMethod ?? 'GET',
                url: request.__opDevUrl ?? '',
                status: request.status || null,
                type: 'xhr',
                startedAt,
                duration: performance.now() - startedPerf,
                requestBytes,
                responseBytes,
                ok: request.status >= 200 && request.status < 400,
            });
        });
        return originalSend.call(this, body);
    };

    (['log', 'info', 'warn', 'error', 'debug'] as const).forEach((level) => {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]) => {
            addConsoleEntry(level, args);
            original(...args);
        };
    });
}

installDeveloperInstrumentation();

function isEnabled(key: string) {
    return localStorage.getItem(`dev_options_${key}`) === 'true';
}

function clampDb(db: number) {
    if (!isFinite(db)) return FLOOR_DB;
    return Math.max(FLOOR_DB, Math.min(CEIL_DB, db));
}

function dbToPercent(db: number) {
    return ((clampDb(db) - FLOOR_DB) / (CEIL_DB - FLOOR_DB)) * 100;
}

function getWindowPositionKey(key: DevWindowKey) {
    return `${WINDOW_POSITION_KEY_PREFIX}-${key}`;
}

function getWindowSize(key: DevWindowKey) {
    return key === 'playback_data' ? PLAYBACK_WINDOW_SIZE : WINDOW_SIZE;
}

function clampPosition(position: PanelPosition, size = WINDOW_SIZE): PanelPosition {
    const maxX = Math.max(WINDOW_GAP, window.innerWidth - size.width - WINDOW_GAP);
    const availableHeight = Math.max(1, window.innerHeight - WINDOW_GAP * 2);
    const maxY = Math.max(WINDOW_GAP, window.innerHeight - Math.min(size.height, availableHeight) - WINDOW_GAP);

    return {
        x: Math.max(WINDOW_GAP, Math.min(maxX, position.x)),
        y: Math.max(WINDOW_GAP, Math.min(maxY, position.y)),
    };
}

function getSavedPosition(key: DevWindowKey, fallback: PanelPosition): PanelPosition {
    const size = getWindowSize(key);
    try {
        const saved = localStorage.getItem(getWindowPositionKey(key));
        if (!saved) return clampPosition(fallback, size);
        const parsed = JSON.parse(saved) as PanelPosition;
        if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return clampPosition(fallback, size);
        return clampPosition(parsed, size);
    } catch {
        return clampPosition(fallback, size);
    }
}

function rectsOverlap(a: PanelPosition, b: PanelPosition, aSize = WINDOW_SIZE, bSize = WINDOW_SIZE) {
    return (
        a.x < b.x + bSize.width &&
        a.x + aSize.width > b.x &&
        a.y < b.y + bSize.height &&
        a.y + aSize.height > b.y
    );
}

function resolveWindowOverlap(
    key: DevWindowKey,
    position: PanelPosition,
    windows: DevWindowDefinition[],
    positions: Record<DevWindowKey, PanelPosition>,
) {
    const movingSize = getWindowSize(key);
    const occupied = windows
        .filter((windowDef) => windowDef.key !== key)
        .map((windowDef) => ({
            position: positions[windowDef.key],
            size: getWindowSize(windowDef.key),
        }))
        .filter((item) => Boolean(item.position));

    let next = clampPosition(position, movingSize);
    if (!occupied.some((other) => rectsOverlap(next, other.position, movingSize, other.size))) return next;

    const candidates: PanelPosition[] = [];
    for (const other of occupied) {
        candidates.push(
            { x: other.position.x + other.size.width + WINDOW_GAP, y: other.position.y },
            { x: other.position.x - movingSize.width - WINDOW_GAP, y: other.position.y },
            { x: other.position.x, y: other.position.y + other.size.height + WINDOW_GAP },
            { x: other.position.x, y: other.position.y - movingSize.height - WINDOW_GAP },
        );
    }

    for (const candidate of candidates.map((candidate) => clampPosition(candidate, movingSize))) {
        if (!occupied.some((other) => rectsOverlap(candidate, other.position, movingSize, other.size))) return candidate;
    }

    for (let y = WINDOW_GAP; y < window.innerHeight; y += movingSize.height + WINDOW_GAP) {
        for (let x = WINDOW_GAP; x < window.innerWidth; x += movingSize.width + WINDOW_GAP) {
            next = clampPosition({ x, y }, movingSize);
            if (!occupied.some((other) => rectsOverlap(next, other.position, movingSize, other.size))) return next;
        }
    }

    return next;
}

function AudioInfoWindow() {
    const { t } = useTranslation();
    const [capturing, setCapturing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [levels, setLevels] = useState<Record<BandKey, number>>({
        overall: FLOOR_DB,
        bass: FLOOR_DB,
        mid: FLOOR_DB,
        treble: FLOOR_DB,
    });
    const [peaks, setPeaks] = useState<Record<BandKey, number>>({
        overall: FLOOR_DB,
        bass: FLOOR_DB,
        mid: FLOOR_DB,
        treble: FLOOR_DB,
    });
    const [stats, setStats] = useState<AudioStats>({
        averageHz: 0,
        averageDb: FLOOR_DB,
        dominantHz: 0,
        dominantDb: FLOOR_DB,
        rmsDb: FLOOR_DB,
        sampleRate: 0,
        fftSize: 0,
        binResolution: 0,
    });

    const streamRef = useRef<MediaStream | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const rafRef = useRef<number>(0);
    const peaksRef = useRef(peaks);

    useEffect(() => {
        peaksRef.current = peaks;
    }, [peaks]);

    async function startCapture() {
        setError(null);

        try {
            const stream = await (navigator.mediaDevices.getDisplayMedia as any)({
                video: true,
                audio: true,
                preferCurrentTab: true,
                systemAudio: 'exclude',
            });

            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length === 0) {
                stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
                setError(t('developer.info.audio.error.no_track'));
                return;
            }

            stream.getVideoTracks().forEach((track: MediaStreamTrack) => track.stop());

            const audioOnlyStream = new MediaStream(audioTracks);
            const audioCtx = new AudioContext();
            const source = audioCtx.createMediaStreamSource(audioOnlyStream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 4096;
            analyser.smoothingTimeConstant = 0.55;
            analyser.minDecibels = -100;
            analyser.maxDecibels = 0;
            source.connect(analyser);

            streamRef.current = stream;
            audioCtxRef.current = audioCtx;
            analyserRef.current = analyser;

            audioTracks[0].addEventListener('ended', stopCapture);

            setCapturing(true);
            runLoop();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('developer.info.audio.error.start_failed'));
        }
    }

    function stopCapture() {
        cancelAnimationFrame(rafRef.current);

        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        audioCtxRef.current?.close();
        audioCtxRef.current = null;
        analyserRef.current = null;

        setCapturing(false);
    }

    function runLoop() {
        const analyser = analyserRef.current;
        const audioCtx = audioCtxRef.current;
        if (!analyser || !audioCtx) return;

        const timeData = new Float32Array(analyser.fftSize);
        const freqData = new Float32Array(analyser.frequencyBinCount);
        const sampleRate = audioCtx.sampleRate;
        const binHz = audioCtx.sampleRate / analyser.fftSize;

        function tick() {
            if (!analyser) return;

            analyser.getFloatTimeDomainData(timeData);
            let sumSquares = 0;
            for (let i = 0; i < timeData.length; i++) {
                sumSquares += timeData[i] * timeData[i];
            }
            const rms = Math.sqrt(sumSquares / timeData.length);
            const overallDb = rms > 0 ? 20 * Math.log10(rms) : FLOOR_DB;

            analyser.getFloatFrequencyData(freqData);

            const bandDbs: Record<BandKey, number> = {
                overall: clampDb(overallDb),
                bass: FLOOR_DB,
                mid: FLOOR_DB,
                treble: FLOOR_DB,
            };
            let spectrumPower = 0;
            let weightedHz = 0;
            let dominantPower = 0;
            let dominantHz = 0;
            let dominantDb = FLOOR_DB;
            let validBins = 0;

            for (let i = 1; i < freqData.length; i++) {
                const db = freqData[i];
                if (!isFinite(db)) continue;

                const hz = i * binHz;
                const amplitude = Math.pow(10, db / 20);
                const power = amplitude * amplitude;

                spectrumPower += power;
                weightedHz += hz * power;
                validBins++;

                if (power > dominantPower) {
                    dominantPower = power;
                    dominantHz = hz;
                    dominantDb = db;
                }
            }

            const averagePower = validBins > 0 ? spectrumPower / validBins : 0;

            for (const band of BANDS) {
                if (band.key === 'overall') continue;

                const loBin = Math.max(0, Math.floor(band.low / binHz));
                const hiBin = Math.min(freqData.length - 1, Math.ceil(band.high / binHz));

                let sumPower = 0;
                let count = 0;
                const powers: number[] = [];
                for (let i = loBin; i <= hiBin; i++) {
                    const db = freqData[i];
                    if (!isFinite(db)) continue;
                    const amplitude = Math.pow(10, db / 20);
                    const power = amplitude * amplitude;
                    sumPower += power;
                    powers.push(power);
                    count++;
                }

                const avgPower = count > 0 ? sumPower / count : 0;
                let bandPower = avgPower;

                if (band.peakBlend && powers.length > 0) {
                    powers.sort((a, b) => b - a);
                    const topCount = Math.max(1, Math.ceil(powers.length * (band.topRatio ?? 0.08)));
                    const topPower =
                        powers.slice(0, topCount).reduce((sum, power) => sum + power, 0) / topCount;
                    bandPower = avgPower * (1 - band.peakBlend) + topPower * band.peakBlend;
                }

                const bandDb = bandPower > 0 ? 10 * Math.log10(bandPower) : FLOOR_DB;
                bandDbs[band.key] = clampDb(bandDb);
            }

            setLevels(bandDbs);
            setStats({
                averageHz: spectrumPower > 0 ? weightedHz / spectrumPower : 0,
                averageDb: averagePower > 0 ? clampDb(10 * Math.log10(averagePower)) : FLOOR_DB,
                dominantHz,
                dominantDb: clampDb(dominantDb),
                rmsDb: clampDb(overallDb),
                sampleRate,
                fftSize: analyser.fftSize,
                binResolution: binHz,
            });

            setPeaks((prev) => {
                const next = { ...prev };
                let changed = false;
                for (const band of BANDS) {
                    if (bandDbs[band.key] > next[band.key]) {
                        next[band.key] = bandDbs[band.key];
                        changed = true;
                    }
                }
                return changed ? next : prev;
            });

            rafRef.current = requestAnimationFrame(tick);
        }

        tick();
    }

    useEffect(() => {
        return () => {
            cancelAnimationFrame(rafRef.current);
            streamRef.current?.getTracks().forEach((track) => track.stop());
            audioCtxRef.current?.close();
        };
    }, []);

    function resetAllPeaks() {
        setPeaks(levels);
    }

    return (
        <>
            <div className="audio-info-controls">
                {capturing ? (
                    <button className="audio-info-start" onClick={stopCapture}>
                        {t('developer.info.audio.stop_capture')}
                    </button>
                ) : (
                    <button className="audio-info-start" onClick={startCapture}>
                        {t('developer.info.audio.start_capture')}
                    </button>
                )}
            </div>

            {error && <div className="audio-info-error">{error}</div>}

            <div className="audio-info-meters">
                {BANDS.map((band) => (
                    <div className="audio-info-group" key={band.key}>
                        <div className="audio-info-label">
                            <span>{t(band.labelKey)}</span>
                        </div>

                        <div className="audio-info-meter">
                            <div
                                className="audio-info-meter-fill"
                                style={{
                                    clipPath: `inset(${100 - dbToPercent(levels[band.key])}% 0 0 0)`,
                                }}
                            ></div>

                            <div
                                className="audio-info-meter-peak"
                                style={{ bottom: `${dbToPercent(peaks[band.key])}%` }}
                            ></div>
                        </div>
                    </div>
                ))}
            </div>

            <button className="audio-info-reset audio-info-reset-all" onClick={resetAllPeaks}>
                {t('developer.info.audio.reset_peaks')}
            </button>

            <div className="audio-info-values">
                {BANDS.map((band) => (
                    <span key={`${band.key}-level`}>
                        {t('developer.info.audio.level', {
                            band: t(band.labelKey),
                            value: levels[band.key].toFixed(1),
                        })}
                    </span>
                ))}
                {BANDS.map((band) => (
                    <span key={`${band.key}-peak`}>
                        {t('developer.info.audio.peak', {
                            band: t(band.labelKey),
                            value: peaks[band.key].toFixed(1),
                        })}
                    </span>
                ))}
            </div>

            <div className="audio-info-separator"></div>

            <div className="audio-info-values">
                <span>{t('developer.info.audio.average_frequency', { value: stats.averageHz.toFixed(0) })}</span>
                <span>{t('developer.info.audio.average_level', { value: stats.averageDb.toFixed(1) })}</span>
                <span>{t('developer.info.audio.dominant_frequency', { value: stats.dominantHz.toFixed(0) })}</span>
                <span>{t('developer.info.audio.dominant_level', { value: stats.dominantDb.toFixed(1) })}</span>
                <span>{t('developer.info.audio.rms_level', { value: stats.rmsDb.toFixed(1) })}</span>
                <span>{t('developer.info.audio.sample_rate', { value: stats.sampleRate.toFixed(0) })}</span>
                <span>{t('developer.info.audio.fft_size', { value: stats.fftSize })}</span>
                <span>{t('developer.info.audio.bin_resolution', { value: stats.binResolution.toFixed(1) })}</span>
            </div>
        </>
    );
}

function NetworkInfoWindow() {
    const { t } = useTranslation();
    const [snapshot, setSnapshot] = useState<NetworkSnapshot>(() => ({
        ...networkState,
        entries: [...networkState.entries],
    }));

    useEffect(() => subscribeNetwork(setSnapshot), []);

    const elapsedSeconds = Math.max(1, (Date.now() - snapshot.sessionStartedAt) / 1000);
    const receivedSpeed = snapshot.receivedBytes / elapsedSeconds;
    const sentSpeed = snapshot.sentBytes / elapsedSeconds;
    const newestRequestEnd = snapshot.entries.reduce(
        (latest, entry) => Math.max(latest, entry.startedAt - snapshot.sessionStartedAt + entry.duration),
        0,
    );
    const timelineMs = Math.max(1000, Math.ceil(newestRequestEnd / 500) * 500);
    const timelineTicks = Array.from({ length: 6 }, (_, index) => (timelineMs / 5) * index);

    return (
        <>
            <div className="developer-info-grid">
                <span>{t('developer.info.network.total_requests', { value: snapshot.totalRequests })}</span>
                <span>{t('developer.info.network.failed_requests', { value: snapshot.failedRequests })}</span>
                <span>{t('developer.info.network.received', { value: bytesToText(snapshot.receivedBytes) })}</span>
                <span>{t('developer.info.network.sent', { value: bytesToText(snapshot.sentBytes) })}</span>
                <span>{t('developer.info.network.download_speed', { value: `${bytesToText(receivedSpeed)}/s` })}</span>
                <span>{t('developer.info.network.upload_speed', { value: `${bytesToText(sentSpeed)}/s` })}</span>
            </div>

            <div className="audio-info-separator"></div>

            <div className="developer-network-waterfall">
                <div className="developer-waterfall-ruler">
                    {timelineTicks.map((tick) => (
                        <span
                            className="developer-waterfall-tick"
                            key={tick}
                            style={{ left: `${(tick / timelineMs) * 100}%` }}
                        >
                            {msToText(tick)}
                        </span>
                    ))}
                </div>

                <div className="developer-waterfall-body">
                    {snapshot.entries.length === 0 ? (
                        <div className="developer-info-empty">{t('developer.info.network.empty')}</div>
                    ) : (
                        snapshot.entries.map((entry) => {
                            const relativeStart = Math.max(0, entry.startedAt - snapshot.sessionStartedAt);
                            const left = (relativeStart / timelineMs) * 100;
                            const width = Math.max(1.5, (entry.duration / timelineMs) * 100);

                            return (
                                <div className="developer-waterfall-row" key={`${entry.id}-timeline`}>
                                    <span className="developer-waterfall-label">{formatUrl(entry.url)}</span>
                                    <div className="developer-waterfall-track">
                                        <span
                                            className="developer-waterfall-bar"
                                            data-ok={entry.ok ? 'true' : 'false'}
                                            style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                                            title={`${entry.method} ${formatUrl(entry.url)} | ${msToText(relativeStart)} - ${msToText(relativeStart + entry.duration)} | ${entry.duration.toFixed(0)} ms`}
                                        ></span>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            <div className="audio-info-separator"></div>

            <div className="developer-request-list">
                {snapshot.entries.length === 0 ? (
                    <div className="developer-info-empty">{t('developer.info.network.empty')}</div>
                ) : (
                    snapshot.entries.map((entry) => (
                        <div className="developer-request-row" data-ok={entry.ok ? 'true' : 'false'} key={entry.id}>
                            <div className="developer-request-main">
                                <span className="developer-request-method">{entry.method}</span>
                                <span className="developer-request-url">{formatUrl(entry.url)}</span>
                            </div>
                            <div className="developer-request-meta">
                                <span>{entry.status ?? 'ERR'}</span>
                                <span>
                                    {msToText(entry.startedAt - snapshot.sessionStartedAt)} -{' '}
                                    {msToText(entry.startedAt - snapshot.sessionStartedAt + entry.duration)}
                                </span>
                                <span>{entry.duration.toFixed(0)} ms</span>
                                <span>{bytesToText(entry.responseBytes)}</span>
                                <span>{entry.type}</span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </>
    );
}

function ConsoleInfoWindow() {
    const { t } = useTranslation();
    const [entries, setEntries] = useState<ConsoleEntry[]>(() => [...consoleEntries]);

    useEffect(() => subscribeConsole(setEntries), []);

    function clearConsoleEntries() {
        consoleEntries.splice(0);
        emitConsoleEntries();
    }

    return (
        <>
            <button className="audio-info-reset audio-info-reset-all" onClick={clearConsoleEntries}>
                {t('developer.info.console.clear')}
            </button>

            <div className="developer-console-list">
                {entries.length === 0 ? (
                    <div className="developer-info-empty">{t('developer.info.console.empty')}</div>
                ) : (
                    entries.map((entry) => (
                        <div className="developer-console-row" data-level={entry.level} key={entry.id}>
                            <div className="developer-console-meta">
                                <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                                <span>{entry.level.toUpperCase()}</span>
                            </div>
                            <div className="developer-console-message">{entry.message}</div>
                        </div>
                    ))
                )}
            </div>
        </>
    );
}


type PlaybackDraft = {
    presetId: string;
    title: string;
    artist: string;
    album: string;
    songId: string;
    sourceType: string;
    albumArt: string;
    duration: number;
    currentTime: number;
    genre: string;
    year: string;
    extraJson: string;
};

type PlaybackQueueItem = {
    id: number;
    track: PlaybackDraft;
};

function serializePlaybackQueue(queue: PlaybackQueueItem[]) {
    return queue.map(({ id, track }) => ({
        queue_id: id,
        song_id: track.songId,
        source_type: track.sourceType,
        extra: parsePluginExtra(track.extraJson) ?? {},
        song_metadata: {
            title: track.title || null,
            artist: track.artist || null,
            album: track.album || null,
            length: track.duration,
            album_art: track.albumArt || null,
            genre: track.genre || null,
            year: track.year || null,
        },
    }));
}

const PLAYBACK_PRESETS: PlaybackDraft[] = [
    {
        presetId: 'spotify-plugin-test',
        title: 'Midnight City',
        artist: 'M83',
        album: 'Hurry Up, We Are Dreaming',
        songId: '1eyzqe2QqGZUmfcPZtrIyt',
        sourceType: 'spotify',
        albumArt: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=640&auto=format&fit=crop&q=85',
        duration: 244,
        currentTime: 0,
        genre: 'Electronic',
        year: '2011',
        extraJson: JSON.stringify({
            provider: 'spotify',
            spotify: {
                track_id: '1eyzqe2QqGZUmfcPZtrIyt',
                uri: 'spotify:track:1eyzqe2QqGZUmfcPZtrIyt',
                external_urls: { spotify: 'https://open.spotify.com/track/1eyzqe2QqGZUmfcPZtrIyt' },
                is_local: false,
                explicit: false,
                popularity: 78,
                preview_url: null,
                artists: [{ name: 'M83' }],
                album: { name: 'Hurry Up, We Are Dreaming' },
            },
        }, null, 2),
    },
    {
        presetId: 'midnight-circuit',
        title: 'Midnight Circuit',
        artist: 'Signal Bloom',
        album: 'Electric Dreams',
        songId: 'demo-midnight-circuit-02',
        sourceType: 'youtube',
        albumArt: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=640&auto=format&fit=crop&q=85',
        duration: 224,
        currentTime: 0,
        genre: 'Electronic',
        year: '2025',
        extraJson: JSON.stringify({ provider: 'youtube', video_id: 'demo-midnight-circuit-02' }, null, 2),
    },
    {
        presetId: 'blue-hour',
        title: 'Blue Hour',
        artist: 'Static Echo',
        album: 'Below the Surface',
        songId: 'demo-blue-hour-03',
        sourceType: 'soundcloud',
        albumArt: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=640&auto=format&fit=crop&q=85',
        duration: 183,
        currentTime: 0,
        genre: 'Alternative',
        year: '2024',
        extraJson: JSON.stringify({ provider: 'soundcloud', permalink: 'https://soundcloud.com/demo/blue-hour' }, null, 2),
    },
    {
        presetId: 'neon-skies',
        title: 'Neon Skies',
        artist: 'Parallel Lines',
        album: 'City Lights',
        songId: 'demo-neon-skies-04',
        sourceType: 'local',
        albumArt: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=640&auto=format&fit=crop&q=85',
        duration: 207,
        currentTime: 0,
        genre: 'Synthwave',
        year: '2026',
        extraJson: JSON.stringify({ provider: 'local', filename: 'neon-skies-demo.mp3' }, null, 2),
    },
];

function getNextPlaybackPreset(currentPresetId: string) {
    const currentIndex = PLAYBACK_PRESETS.findIndex((preset) => preset.presetId === currentPresetId);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % PLAYBACK_PRESETS.length;
    return PLAYBACK_PRESETS[nextIndex];
}

function getPreviousPlaybackPreset(currentPresetId: string) {
    const currentIndex = PLAYBACK_PRESETS.findIndex((preset) => preset.presetId === currentPresetId);
    const previousIndex = currentIndex < 0 ? PLAYBACK_PRESETS.length - 1 : (currentIndex - 1 + PLAYBACK_PRESETS.length) % PLAYBACK_PRESETS.length;
    return PLAYBACK_PRESETS[previousIndex];
}

function formatPlaybackTime(seconds: number) {
    const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = safeSeconds % 60;
    return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function parsePluginExtra(value: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(value);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}

function PlaybackDataWindow() {
    const [track, setTrack] = useState<PlaybackDraft>(() => ({ ...PLAYBACK_PRESETS[0] }));
    const [queue, setQueue] = useState<PlaybackQueueItem[]>([]);
    const [queuePresetId, setQueuePresetId] = useState(PLAYBACK_PRESETS[0].presetId);
    const [selectedQueueId, setSelectedQueueId] = useState<number | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [simulationActive, setSimulationActive] = useState(false);
    const [autoChangeTracks, setAutoChangeTracks] = useState(false);
    const [autoChangeSeconds, setAutoChangeSeconds] = useState(15);
    const [showPayload, setShowPayload] = useState(false);

    const queueRef = useRef<PlaybackQueueItem[]>([]);
    const nextQueueIdRef = useRef(1);

    function commitQueue(nextQueue: PlaybackQueueItem[]) {
        queueRef.current = nextQueue;
        setQueue(nextQueue);
    }

    useEffect(() => {
        if (!isPlaying) return;

        const interval = window.setInterval(() => {
            setTrack((current) => ({
                ...current,
                currentTime: Math.min(current.currentTime + 1, Math.max(1, current.duration)),
            }));
        }, 1000);

        return () => window.clearInterval(interval);
    }, [isPlaying]);

    useEffect(() => {
        if (!isPlaying) return;

        const shouldAutoAdvance = autoChangeTracks && (
            track.currentTime >= autoChangeSeconds ||
            track.currentTime >= Math.max(1, track.duration)
        );

        if (shouldAutoAdvance) {
            advanceTrack();
            return;
        }

        if (!autoChangeTracks && track.duration > 0 && track.currentTime >= track.duration) {
            setIsPlaying(false);
        }
    }, [track.currentTime, track.duration, isPlaying, autoChangeTracks, autoChangeSeconds]);

    useEffect(() => {
        const extra = parsePluginExtra(track.extraJson);
        if (simulationActive && !extra) return;

        window.dispatchEvent(new CustomEvent('omniplayr:developer-playback-simulation', {
            detail: {
                active: simulationActive,
                songId: track.songId,
                sourceType: track.sourceType,
                isPlaying,
                currentTime: track.currentTime,
                duration: track.duration,
                metadata: {
                    title: track.title || null,
                    artist: track.artist || null,
                    album: track.album || null,
                    album_art: track.albumArt || null,
                    duration: track.duration,
                    genre: track.genre || null,
                    year: track.year || null,
                    filename: null,
                },
                extra: extra ?? {},
                queue: serializePlaybackQueue(queue),
            },
        }));
    }, [simulationActive, track, isPlaying, queue]);

    useEffect(() => {
        if (!simulationActive) return;

        const items = queue
            .filter(({ track }) => track.songId.trim() && track.sourceType.trim())
            .map(({ track }) => ({
                songId: track.songId,
                sourceType: track.sourceType,
                extra: parsePluginExtra(track.extraJson) ?? undefined,
            }));

        window.dispatchEvent(new CustomEvent('omniplayr:developer-playback-queue', {
            detail: {
                name: 'Developer simulation',
                items,
            },
        }));
    }, [queue, simulationActive]);

    useEffect(() => {
        const handleNext = () => advanceTrack();

        const handlePrevious = () => {
            setSelectedQueueId(null);
            setTrack((current) => ({
                ...getPreviousPlaybackPreset(current.presetId),
                currentTime: 0,
            }));
        };

        const handleToggle = () => setIsPlaying((current) => !current);

        const handleSeek = (event: Event) => {
            const currentTime = (event as CustomEvent<{ currentTime: number }>).detail?.currentTime;
            if (!Number.isFinite(currentTime)) return;

            setTrack((current) => ({
                ...current,
                currentTime: Math.max(0, Math.min(current.duration, currentTime)),
            }));
        };

        window.addEventListener('omniplayr:developer-simulation-next', handleNext);
        window.addEventListener('omniplayr:developer-simulation-prev', handlePrevious);
        window.addEventListener('omniplayr:developer-simulation-toggle', handleToggle);
        window.addEventListener('omniplayr:developer-simulation-seek', handleSeek);

        return () => {
            window.removeEventListener('omniplayr:developer-simulation-next', handleNext);
            window.removeEventListener('omniplayr:developer-simulation-prev', handlePrevious);
            window.removeEventListener('omniplayr:developer-simulation-toggle', handleToggle);
            window.removeEventListener('omniplayr:developer-simulation-seek', handleSeek);
        };
    }, []);

    useEffect(() => {
        return () => {
            window.dispatchEvent(new CustomEvent('omniplayr:developer-playback-simulation', {
                detail: { active: false },
            }));
        };
    }, []);

    const progress = track.duration > 0
        ? Math.min(100, Math.max(0, (track.currentTime / track.duration) * 100))
        : 0;

    function loadPreset(presetId: string) {
        const preset = PLAYBACK_PRESETS.find((item) => item.presetId === presetId);
        if (!preset) return;

        setSelectedQueueId(null);
        setTrack({ ...preset, currentTime: 0 });
    }

    function addCurrentTrackToQueue() {
        const item: PlaybackQueueItem = {
            id: nextQueueIdRef.current++,
            track: { ...track, currentTime: 0 },
        };

        commitQueue([...queueRef.current, item]);
    }

    function addPresetToQueue(presetId: string) {
        const preset = PLAYBACK_PRESETS.find((item) => item.presetId === presetId);
        if (!preset) return;

        const item: PlaybackQueueItem = {
            id: nextQueueIdRef.current++,
            track: { ...preset, currentTime: 0 },
        };

        commitQueue([...queueRef.current, item]);
    }

    function loadQueueItem(item: PlaybackQueueItem) {
        setTrack({ ...item.track, currentTime: 0 });
        setSelectedQueueId(item.id);
    }

    function saveSelectedQueueItem() {
        if (selectedQueueId === null) return;

        const nextQueue = queueRef.current.map((item) =>
            item.id === selectedQueueId
                ? { ...item, track: { ...track, currentTime: 0 } }
                : item,
        );

        commitQueue(nextQueue);
    }

    function removeQueueItem(id: number) {
        commitQueue(queueRef.current.filter((item) => item.id !== id));

        if (selectedQueueId === id) {
            setSelectedQueueId(null);
        }
    }

    function moveQueueItem(id: number, direction: -1 | 1) {
        const nextQueue = [...queueRef.current];
        const index = nextQueue.findIndex((item) => item.id === id);
        const targetIndex = index + direction;

        if (index < 0 || targetIndex < 0 || targetIndex >= nextQueue.length) return;

        [nextQueue[index], nextQueue[targetIndex]] = [
            nextQueue[targetIndex],
            nextQueue[index],
        ];

        commitQueue(nextQueue);
    }

    function clearQueue() {
        commitQueue([]);
        setSelectedQueueId(null);
    }

    function advanceTrack() {
        const nextItem = queueRef.current[0];

        if (nextItem) {
            commitQueue(queueRef.current.slice(1));
            setSelectedQueueId(null);
            setTrack({ ...nextItem.track, currentTime: 0 });
            return;
        }

        setSelectedQueueId(null);
        setTrack((current) => ({
            ...getNextPlaybackPreset(current.presetId),
            currentTime: 0,
        }));
    }

    function startSimulation() {
        if (!parsePluginExtra(track.extraJson)) return;
        setSimulationActive(true);
        setIsPlaying(true);
    }

    function resetSimulation() {
        setTrack({ ...PLAYBACK_PRESETS[0] });
        setIsPlaying(false);
        setSimulationActive(false);
        setAutoChangeTracks(false);
        setAutoChangeSeconds(15);
        setShowPayload(false);
        commitQueue([]);
        setSelectedQueueId(null);
    }

    function updateTextField(
        field: 'title' | 'artist' | 'album' | 'songId' | 'sourceType' | 'albumArt' | 'genre' | 'year',
        value: string,
    ) {
        setTrack((current) => ({ ...current, [field]: value, presetId: 'custom' }));
    }

    function handleArtworkUpload(event: ChangeEvent<HTMLInputElement>) {
        const file = event.currentTarget.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => updateTextField('albumArt', String(reader.result ?? ''));
        reader.readAsDataURL(file);
        event.currentTarget.value = '';
    }

    const pluginExtra = parsePluginExtra(track.extraJson);
    const extraMetadataInvalid = pluginExtra === null;

    const simulatedPayload = {
        song_id: track.songId,
        source_type: track.sourceType,
        playback_status: isPlaying ? 'playing' : 'paused',
        extra: pluginExtra,
        queue: serializePlaybackQueue(queue),
        playback_metadata: {
            current_time: Math.floor(track.currentTime),
            duration: track.duration,
            simulated: true,
        },
        song_metadata: {
            title: track.title,
            artist: track.artist,
            album: track.album,
            length: track.duration,
            album_art: track.albumArt,
            genre: track.genre,
            year: track.year,
        },
    };

    return (
        <div className="playback-sim-content">
            <div className="developer-info-grid">
                <span>{simulationActive ? 'Simulation connected to player' : 'Preview only'}</span>
                <span>{isPlaying ? 'Status: playing' : 'Status: paused'}</span>
                <span>Source plugin: {track.sourceType || 'not set'}</span>
                <span>{autoChangeTracks ? `Auto change: every ${autoChangeSeconds}s` : 'Auto change: off'}</span>
            </div>

            <div className="audio-info-separator"></div>

            <div className="playback-sim-preview">
                <div className="playback-sim-artwork">
                    {track.albumArt ? <img src={track.albumArt} alt="Album artwork" /> : <span>No artwork</span>}
                </div>
                <div className="playback-sim-track-info">
                    <strong title={track.title}>{track.title || 'Untitled track'}</strong>
                    <span title={track.artist}>{track.artist || 'Unknown artist'}</span>
                    <small title={track.album}>{track.album || 'Unknown album'}</small>
                    <small>{simulationActive ? 'Player data is simulated' : 'Not applied to player'}</small>
                </div>
            </div>

            <div className="playback-sim-timeline">
                <div className="playback-sim-progress">
                    <span style={{ width: `${progress}%` }}></span>
                </div>
                <input
                    aria-label="Simulated playback position"
                    className="playback-sim-range"
                    type="range"
                    min="0"
                    max={Math.max(1, track.duration)}
                    value={Math.min(track.currentTime, Math.max(1, track.duration))}
                    onChange={(event) => {
                        const currentTime = Number(event.currentTarget.value);
                        setTrack((current) => ({ ...current, currentTime }));
                    }}
                />
                <div className="playback-sim-time-row">
                    <span>{formatPlaybackTime(track.currentTime)}</span>
                    <span>{formatPlaybackTime(track.duration)}</span>
                </div>
            </div>

            <div className="playback-sim-controls">
                <button type="button" onClick={() => setTrack((current) => ({ ...current, currentTime: 0 }))}>Restart</button>
                <button type="button" className="audio-info-start" onClick={startSimulation} disabled={extraMetadataInvalid}>
                    {isPlaying ? 'Restart simulation' : 'Start simulation'}
                </button>
                <button type="button" onClick={advanceTrack}>Next</button>
            </div>

            <div className="playback-sim-controls">
                <button type="button" onClick={() => setIsPlaying(false)} disabled={!isPlaying}>Pause</button>
                <button type="button" onClick={() => setSimulationActive((active) => !active)} disabled={extraMetadataInvalid}>
                    {simulationActive ? 'Remove from player' : 'Apply to player'}
                </button>
                <button type="button" onClick={() => setIsPlaying(true)}>Resume</button>
            </div>

            <div className="audio-info-separator"></div>

            <label className="playback-sim-field">
                <span>Song preset</span>
                <select
                    className="playback-sim-input"
                    value={track.presetId}
                    onChange={(event) => loadPreset(event.currentTarget.value)}
                >
                    <option value="custom">Custom data</option>
                    {PLAYBACK_PRESETS.map((preset) => (
                        <option value={preset.presetId} key={preset.presetId}>
                            {preset.sourceType}: {preset.title} - {preset.artist}
                        </option>
                    ))}
                </select>
            </label>

            <div className="playback-sim-section">
                <div className="audio-info-label">Automatic song changes</div>
                <label className="playback-sim-toggle">
                    <input
                        type="checkbox"
                        checked={autoChangeTracks}
                        onChange={(event) => {
                            const enabled = event.currentTarget.checked;
                            setAutoChangeTracks(enabled);
                            if (enabled) startSimulation();
                        }}
                    />
                    <span>Auto-play demo playlist silently</span>
                </label>
                <div className="playback-sim-auto-row">
                    <span>Change every</span>
                    <select
                        className="playback-sim-input playback-sim-interval"
                        value={autoChangeSeconds}
                        disabled={!autoChangeTracks}
                        onChange={(event) => setAutoChangeSeconds(Number(event.currentTarget.value))}
                    >
                        <option value="5">5 seconds</option>
                        <option value="10">10 seconds</option>
                        <option value="15">15 seconds</option>
                        <option value="30">30 seconds</option>
                        <option value="60">60 seconds</option>
                    </select>
                </div>
            </div>

            <div className="audio-info-separator"></div>

            <div className="playback-sim-section">
                <div className="playback-sim-queue-header">
                    <div className="audio-info-label">Playback queue ({queue.length})</div>
                    <button
                        type="button"
                        className="playback-sim-queue-small-button"
                        onClick={clearQueue}
                        disabled={queue.length === 0}
                    >
                        Clear queue
                    </button>
                </div>

                <div className="playback-sim-queue-sync" data-active={simulationActive}>
                    {simulationActive
                        ? 'Queue synced with AudioPlayer'
                        : 'Apply the simulation to sync with AudioPlayer'}
                </div>

                <div className="playback-sim-queue-add">
                    <select
                        className="playback-sim-input"
                        value={queuePresetId}
                        onChange={(event) => setQueuePresetId(event.currentTarget.value)}
                    >
                        {PLAYBACK_PRESETS.map((preset) => (
                            <option value={preset.presetId} key={preset.presetId}>
                                {preset.title} - {preset.artist}
                            </option>
                        ))}
                    </select>

                    <button
                        type="button"
                        className="playback-sim-queue-small-button"
                        onClick={() => addPresetToQueue(queuePresetId)}
                    >
                        Add preset
                    </button>
                </div>

                <button
                    type="button"
                    className="playback-sim-queue-add-current"
                    onClick={addCurrentTrackToQueue}
                >
                    + Add current track to queue
                </button>

                <div className="playback-sim-queue-list">
                    {queue.length === 0 ? (
                        <div className="playback-sim-queue-empty">
                            The queue is empty. Add a preset or your current track.
                        </div>
                    ) : (
                        queue.map((item, index) => (
                            <div
                                className="playback-sim-queue-item"
                                data-selected={selectedQueueId === item.id ? 'true' : 'false'}
                                key={item.id}
                            >
                                <div className="playback-sim-queue-number">
                                    {index + 1}
                                </div>

                                <div className="playback-sim-queue-item-info">
                                    <strong>{item.track.title || 'Untitled track'}</strong>
                                    <span>{item.track.artist || 'Unknown artist'}</span>
                                    <small>
                                        {item.track.sourceType || 'Unknown source'} · {formatPlaybackTime(item.track.duration)}
                                    </small>
                                </div>

                                <div className="playback-sim-queue-item-actions">
                                    <button
                                        type="button"
                                        title="Move up"
                                        disabled={index === 0}
                                        onClick={() => moveQueueItem(item.id, -1)}
                                    >
                                        ↑
                                    </button>
                                    <button
                                        type="button"
                                        title="Move down"
                                        disabled={index === queue.length - 1}
                                        onClick={() => moveQueueItem(item.id, 1)}
                                    >
                                        ↓
                                    </button>
                                    <button
                                        type="button"
                                        title="Load and edit this track"
                                        onClick={() => loadQueueItem(item)}
                                    >
                                        Edit
                                    </button>
                                    <button
                                        type="button"
                                        title="Remove from queue"
                                        onClick={() => removeQueueItem(item.id)}
                                    >
                                        ×
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {selectedQueueId !== null && (
                    <div className="playback-sim-queue-edit-hint">
                        This queue item is loaded into Track metadata below. Save your changes after editing.
                    </div>
                )}
            </div>

            <div className="audio-info-separator"></div>

            <div className="audio-info-label">Track metadata</div>
            <div className="playback-sim-field-grid">
                <label className="playback-sim-field">
                    <span>Title</span>
                    <input className="playback-sim-input" value={track.title} onChange={(event) => updateTextField('title', event.currentTarget.value)} />
                </label>
                <label className="playback-sim-field">
                    <span>Artist</span>
                    <input className="playback-sim-input" value={track.artist} onChange={(event) => updateTextField('artist', event.currentTarget.value)} />
                </label>
                <label className="playback-sim-field">
                    <span>Album</span>
                    <input className="playback-sim-input" value={track.album} onChange={(event) => updateTextField('album', event.currentTarget.value)} />
                </label>
                <label className="playback-sim-field">
                    <span>Song ID</span>
                    <input className="playback-sim-input" value={track.songId} onChange={(event) => updateTextField('songId', event.currentTarget.value)} />
                </label>
                <label className="playback-sim-field">
                    <span>Source type</span>
                    <input className="playback-sim-input" value={track.sourceType} onChange={(event) => updateTextField('sourceType', event.currentTarget.value)} />
                </label>
                <label className="playback-sim-field">
                    <span>Genre</span>
                    <input className="playback-sim-input" value={track.genre} onChange={(event) => updateTextField('genre', event.currentTarget.value)} />
                </label>
                <label className="playback-sim-field">
                    <span>Year</span>
                    <input className="playback-sim-input" value={track.year} onChange={(event) => updateTextField('year', event.currentTarget.value)} />
                </label>
                <label className="playback-sim-field">
                    <span>Duration in seconds</span>
                    <input
                        className="playback-sim-input"
                        type="number"
                        min="1"
                        step="1"
                        value={track.duration}
                        onChange={(event) => {
                            const duration = Math.max(1, Number(event.currentTarget.value) || 1);
                            setTrack((current) => ({
                                ...current,
                                duration,
                                currentTime: Math.min(current.currentTime, duration),
                                presetId: 'custom',
                            }));
                        }}
                    />
                </label>
            </div>

            <label className="playback-sim-field">
                <span>Album art URL</span>
                <input className="playback-sim-input" value={track.albumArt} onChange={(event) => updateTextField('albumArt', event.currentTarget.value)} placeholder="https://..." />
            </label>
            <label className="playback-sim-upload">
                <span>Upload album artwork</span>
                <input type="file" accept="image/*" onChange={handleArtworkUpload} />
            </label>

            {selectedQueueId !== null && (
                <button
                    type="button"
                    className="audio-info-reset audio-info-reset-all"
                    onClick={saveSelectedQueueItem}
                >
                    Save changes to selected queue item
                </button>
            )}

            <div className="audio-info-separator"></div>

            <div className="audio-info-label">Plugin metadata</div>
            <label className="playback-sim-field">
                <span>Extra metadata (JSON)</span>
                <textarea
                    className="playback-sim-input playback-sim-json-input"
                    rows={7}
                    spellCheck={false}
                    value={track.extraJson}
                    onChange={(event) => setTrack((current) => ({ ...current, extraJson: event.currentTarget.value, presetId: 'custom' }))}
                />
            </label>
            {extraMetadataInvalid ? (
                <div className="playback-sim-error">Enter a valid JSON object before applying the simulation.</div>
            ) : (
                <small className="playback-sim-hint">Passed to player.currentExtra, the source plugin simulation hook, and the omniplayr:plugin-test-playback event. The normal plugin play method is not called.</small>
            )}

            <button type="button" className="audio-info-reset audio-info-reset-all" onClick={() => setShowPayload((visible) => !visible)}>
                {showPayload ? 'Hide playback data' : 'Show playback data'}
            </button>
            {showPayload && <pre className="playback-sim-json">{JSON.stringify(simulatedPayload, null, 2)}</pre>}

            <button type="button" className="audio-info-reset audio-info-reset-all" onClick={resetSimulation}>Reset simulator</button>
        </div>
    );
}

const DEV_WINDOWS: DevWindowDefinition[] = [
    {
        key: 'playback_data',
        titleKey: 'Playback data',
        enabledKey: 'playback_data',
        defaultPosition: { x: 1010, y: 40 },
        Component: PlaybackDataWindow,
    },
    {
        key: 'audio_info',
        titleKey: 'developer.info.audio.title',
        enabledKey: 'audio_info',
        defaultPosition: { x: 10, y: 40 },
        Component: AudioInfoWindow,
    },
    {
        key: 'network_info',
        titleKey: 'developer.info.network.title',
        enabledKey: 'network_info',
        defaultPosition: { x: 340, y: 40 },
        Component: NetworkInfoWindow,
    },
    {
        key: 'console_info',
        titleKey: 'developer.info.console.title',
        enabledKey: 'console_info',
        defaultPosition: { x: 670, y: 40 },
        Component: ConsoleInfoWindow,
    },
];

function getEnabledDevWindows() {
    if (!isEnabled('show_info_tabs')) return [];
    return DEV_WINDOWS.filter((windowDef) => isEnabled(windowDef.enabledKey));
}

function getInitialOpenWindows(windows: DevWindowDefinition[]) {
    return windows.reduce(
        (openWindows, windowDef) => ({
            ...openWindows,
            [windowDef.key]: true,
        }),
        {} as Record<DevWindowKey, boolean>,
    );
}

function getInitialPositions(windows: DevWindowDefinition[]) {
    return windows.reduce(
        (positions, windowDef) => ({
            ...positions,
            [windowDef.key]: getSavedPosition(windowDef.key, windowDef.defaultPosition),
        }),
        {} as Record<DevWindowKey, PanelPosition>,
    );
}

function DeveloperTabs({
    windows,
    openWindows,
    onOpen,
}: {
    windows: DevWindowDefinition[];
    openWindows: Record<DevWindowKey, boolean>;
    onOpen: (key: DevWindowKey) => void;
}) {
    const { t } = useTranslation();

    if (windows.length === 0) return null;

    return (
        <div className="developer-tabs">
            {windows.map((windowDef) => (
                <button
                    className="developer-tab"
                    data-open={openWindows[windowDef.key] ? 'true' : 'false'}
                    key={windowDef.key}
                    onClick={() => onOpen(windowDef.key)}
                >
                    {t(windowDef.titleKey)}
                </button>
            ))}
        </div>
    );
}

function DeveloperContext() {
    const { t } = useTranslation();
    const [, setOptionsVersion] = useState(0);
    const enabledWindows = getEnabledDevWindows();
    const enabledWindowKeys = enabledWindows.map((windowDef) => windowDef.key).join('|');
    const [openWindows, setOpenWindows] = useState(() => getInitialOpenWindows(enabledWindows));
    const [positions, setPositions] = useState(() => getInitialPositions(enabledWindows));
    const dragRef = useRef<{ key: DevWindowKey; offset: PanelPosition } | null>(null);

    useEffect(() => {
        const refreshOptions = () => setOptionsVersion((version) => version + 1);

        window.addEventListener(DEV_OPTIONS_EVENT, refreshOptions);
        window.addEventListener('storage', refreshOptions);

        return () => {
            window.removeEventListener(DEV_OPTIONS_EVENT, refreshOptions);
            window.removeEventListener('storage', refreshOptions);
        };
    }, []);

    useEffect(() => {
        setOpenWindows((current) => {
            const next = { ...current };
            for (const windowDef of enabledWindows) {
                if (next[windowDef.key] === undefined) next[windowDef.key] = true;
            }
            return next;
        });

        setPositions((current) => {
            const next = { ...current };
            for (const windowDef of enabledWindows) {
                if (!next[windowDef.key]) {
                    next[windowDef.key] = getSavedPosition(windowDef.key, windowDef.defaultPosition);
                }
            }
            return next;
        });
    }, [enabledWindowKeys]);

    function openWindow(key: DevWindowKey) {
        setOpenWindows((current) => ({ ...current, [key]: true }));
    }

    function minimizeWindow(key: DevWindowKey) {
        setOpenWindows((current) => ({ ...current, [key]: false }));
    }

    function startDrag(key: DevWindowKey, event: PointerEvent<HTMLDivElement>) {
        const position = positions[key];
        if (!position) return;

        dragRef.current = {
            key,
            offset: {
                x: event.clientX - position.x,
                y: event.clientY - position.y,
            },
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    }

    function dragWindow(event: PointerEvent<HTMLDivElement>) {
        const drag = dragRef.current;
        if (!drag) return;

        setPositions((current) => ({
            ...current,
            [drag.key]: clampPosition({
                x: event.clientX - drag.offset.x,
                y: event.clientY - drag.offset.y,
            }, getWindowSize(drag.key)),
        }));
    }

    function stopDrag(event: PointerEvent<HTMLDivElement>) {
        const drag = dragRef.current;
        dragRef.current = null;

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (!drag) return;

        const openWindowDefs = enabledWindows.filter((windowDef) => openWindows[windowDef.key]);
        setPositions((current) => {
            const resolved = resolveWindowOverlap(drag.key, current[drag.key], openWindowDefs, current);
            safeStorageSet(getWindowPositionKey(drag.key), JSON.stringify(resolved));
            return {
                ...current,
                [drag.key]: resolved,
            };
        });
    }

    if (enabledWindows.length === 0) return null;

    return (
        <>
            <DeveloperTabs windows={enabledWindows} openWindows={openWindows} onOpen={openWindow} />

            {enabledWindows.map((windowDef) => {
                const position = positions[windowDef.key] ?? windowDef.defaultPosition;
                const WindowContent = windowDef.Component;

                return (
                    <div
                        className={`audio-info${windowDef.key === 'playback_data' ? ' playback-sim-window' : ''}`}
                        key={windowDef.key}
                        style={{
                            left: `${position.x}px`,
                            top: `${position.y}px`,
                            display: openWindows[windowDef.key] ? undefined : 'none',
                        }}
                    >
                            <div
                                className="audio-info-header"
                                onPointerDown={(event) => startDrag(windowDef.key, event)}
                                onPointerMove={dragWindow}
                                onPointerUp={stopDrag}
                                onPointerCancel={stopDrag}
                            >
                                <p className="audio-info-title">{t(windowDef.titleKey)}</p>
                                <button
                                    className="audio-info-minimize"
                                    onClick={() => minimizeWindow(windowDef.key)}
                                    onPointerDown={(event) => event.stopPropagation()}
                                >
                                    {t('developer.info.window.minimize')}
                                </button>
                            </div>

                            <WindowContent />
                    </div>
                );
            })}
        </>
    );
}

export default DeveloperContext;
