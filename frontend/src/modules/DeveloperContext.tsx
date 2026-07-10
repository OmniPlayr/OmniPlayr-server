// Parser Action
// @devonly.all
import { useEffect, useRef, useState } from 'react';
import type { ComponentType, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import '../styles/DeveloperContext.css';

const FLOOR_DB = -60;
const CEIL_DB = 0;
const DEV_OPTIONS_EVENT = 'omniplayr-dev-options-change';
const WINDOW_POSITION_KEY_PREFIX = 'omniplayr-dev-window-position';
const WINDOW_SIZE = { width: 320, height: 520 };
const WINDOW_GAP = 10;

type BandKey = 'overall' | 'bass' | 'mid' | 'treble';
type PanelPosition = { x: number; y: number };
type DevWindowKey = 'audio_info' | 'network_info' | 'console_info';
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

function clampPosition(position: PanelPosition, size = WINDOW_SIZE): PanelPosition {
    const maxX = Math.max(0, window.innerWidth - size.width - WINDOW_GAP);
    const maxY = Math.max(0, window.innerHeight - 40);

    return {
        x: Math.max(WINDOW_GAP, Math.min(maxX, position.x)),
        y: Math.max(WINDOW_GAP, Math.min(maxY, position.y)),
    };
}

function getSavedPosition(key: DevWindowKey, fallback: PanelPosition): PanelPosition {
    try {
        const saved = localStorage.getItem(getWindowPositionKey(key));
        if (!saved) return fallback;
        const parsed = JSON.parse(saved) as PanelPosition;
        if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return fallback;
        return clampPosition(parsed);
    } catch {
        return fallback;
    }
}

function rectsOverlap(a: PanelPosition, b: PanelPosition, size = WINDOW_SIZE) {
    return (
        a.x < b.x + size.width &&
        a.x + size.width > b.x &&
        a.y < b.y + size.height &&
        a.y + size.height > b.y
    );
}

function resolveWindowOverlap(
    key: DevWindowKey,
    position: PanelPosition,
    windows: DevWindowDefinition[],
    positions: Record<DevWindowKey, PanelPosition>,
) {
    const occupied = windows
        .filter((windowDef) => windowDef.key !== key)
        .map((windowDef) => positions[windowDef.key])
        .filter(Boolean);

    let next = clampPosition(position);
    if (!occupied.some((other) => rectsOverlap(next, other))) return next;

    const candidates: PanelPosition[] = [];
    for (const other of occupied) {
        candidates.push(
            { x: other.x + WINDOW_SIZE.width + WINDOW_GAP, y: other.y },
            { x: other.x - WINDOW_SIZE.width - WINDOW_GAP, y: other.y },
            { x: other.x, y: other.y + WINDOW_SIZE.height + WINDOW_GAP },
            { x: other.x, y: other.y - WINDOW_SIZE.height - WINDOW_GAP },
        );
    }

    for (const candidate of candidates.map((candidate) => clampPosition(candidate))) {
        if (!occupied.some((other) => rectsOverlap(candidate, other))) return candidate;
    }

    for (let y = WINDOW_GAP + 30; y < window.innerHeight; y += WINDOW_SIZE.height + WINDOW_GAP) {
        for (let x = WINDOW_GAP; x < window.innerWidth; x += WINDOW_SIZE.width + WINDOW_GAP) {
            next = clampPosition({ x, y });
            if (!occupied.some((other) => rectsOverlap(next, other))) return next;
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

const DEV_WINDOWS: DevWindowDefinition[] = [
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
            }),
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

            {enabledWindows
                .filter((windowDef) => openWindows[windowDef.key])
                .map((windowDef) => {
                    const position = positions[windowDef.key] ?? windowDef.defaultPosition;
                    const WindowContent = windowDef.Component;

                    return (
                        <div
                            className="audio-info"
                            key={windowDef.key}
                            style={{ left: `${position.x}px`, top: `${position.y}px` }}
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
