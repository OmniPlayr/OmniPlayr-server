import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../modules/api';
import '../styles/settings/Logs.css';
import { RefreshCw, ArrowDown } from 'lucide-react';

interface LogEntry {
    timestamp: string;
    level: string;
    source: string;
    call_chain: string[];
    message: string;
}

interface TaggedEntry extends LogEntry {
    _id: number;
}

interface LogsResponse {
    entries: LogEntry[];
    has_more: boolean;
}

const LEVEL_CLASS: Record<string, string> = {
    INF: 'info',
    SUC: 'success',
    WRN: 'warning',
    ERR: 'error',
    CRT: 'critical',
    DBG: 'debug',
    DIG: 'diag',
    WDG: 'diag-warning',
    EDG: 'diag-error',
    CDG: 'diag-critical',
};

const DIAG_LEVELS = new Set(['DIG', 'WDG', 'EDG', 'CDG']);

const PAGE_SIZE = 100;
let _idGen = 0;

function tagEntries(entries: LogEntry[]): TaggedEntry[] {
    return entries.map(e => ({ ...e, _id: _idGen++ }));
}

function Logs() {
    const [logs, setLogs] = useState<TaggedEntry[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [loadingInitial, setLoadingInitial] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [hours, setHours] = useState(24);
    const [levelFilter, setLevelFilter] = useState('ALL');
    const [sortBy, setSortBy] = useState<'time' | 'file'>('time');
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [newEntryCount, setNewEntryCount] = useState(0);
    const [showScrollBtn, setShowScrollBtn] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const oldestTsRef = useRef<string | null>(null);
    const newestTsRef = useRef<string | null>(null);
    const loadingOlderRef = useRef(false);

    const isNearBottom = useCallback(() => {
        const el = containerRef.current;
        if (!el) return true;
        return el.scrollHeight - el.scrollTop - el.clientHeight < 10;
    }, []);

    const scrollToBottom = useCallback((smooth = false) => {
        const el = containerRef.current;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
        setNewEntryCount(0);
        setShowScrollBtn(false);
    }, []);

    const fetchInitial = useCallback(async () => {
        setLoadingInitial(true);
        setLogs([]);
        setHasMore(false);
        setNewEntryCount(0);
        oldestTsRef.current = null;
        newestTsRef.current = null;

        try {
            const data = await api(`/logs/?hours=${hours}&limit=${PAGE_SIZE}`) as LogsResponse;
            const entries = tagEntries(data.entries ?? []);
            setLogs(entries);
            setHasMore(data.has_more ?? false);
            if (entries.length > 0) {
                oldestTsRef.current = entries[0].timestamp;
                newestTsRef.current = entries[entries.length - 1].timestamp;
            }
            requestAnimationFrame(() => scrollToBottom());
        } catch {
            setLogs([]);
        }

        setLoadingInitial(false);
    }, [hours, scrollToBottom]);

    const loadOlderLogs = useCallback(async () => {
        if (loadingOlderRef.current || !oldestTsRef.current) return;
        loadingOlderRef.current = true;
        setLoadingOlder(true);

        const container = containerRef.current;
        const prevScrollHeight = container?.scrollHeight ?? 0;
        const prevScrollTop = container?.scrollTop ?? 0;

        try {
            const data = await api(
                `/logs/?hours=${hours}&limit=${PAGE_SIZE}&before=${encodeURIComponent(oldestTsRef.current)}`
            ) as LogsResponse;
            const entries = tagEntries(data.entries ?? []);
            if (entries.length > 0) {
                oldestTsRef.current = entries[0].timestamp;
                setHasMore(data.has_more ?? false);
                setLogs(prev => [...entries, ...prev]);
                requestAnimationFrame(() => {
                    if (container) {
                        container.scrollTop = container.scrollHeight - prevScrollHeight + prevScrollTop;
                    }
                });
            } else {
                setHasMore(false);
            }
        } catch {
            // silent
        }

        loadingOlderRef.current = false;
        setLoadingOlder(false);
    }, [hours]);

    const pollNewLogs = useCallback(async () => {
        if (!newestTsRef.current) return;
        try {
            const data = await api(
                `/logs/?hours=${hours}&since=${encodeURIComponent(newestTsRef.current)}`
            ) as LogsResponse;
            const entries = tagEntries(data.entries ?? []);
            if (entries.length === 0) return;
            newestTsRef.current = entries[entries.length - 1].timestamp;
            const near = isNearBottom();
            setLogs(prev => [...prev, ...entries]);
            if (near) {
                requestAnimationFrame(() => scrollToBottom());
            } else {
                setNewEntryCount(c => c + entries.length);
            }
        } catch {
            // silent
        }
    }, [hours, isNearBottom, scrollToBottom]);

    useEffect(() => {
        fetchInitial();
    }, [fetchInitial]);

    useEffect(() => {
        if (!autoRefresh) return;
        const id = setInterval(pollNewLogs, 15000);
        return () => clearInterval(id);
    }, [autoRefresh, pollNewLogs]);

    useEffect(() => {
        if (loadingInitial || loadingOlder || !hasMore) return;
        const el = containerRef.current;
        if (!el) return;
        if (el.scrollHeight <= el.clientHeight + 5) {
            loadOlderLogs();
        }
    }, [logs.length, hasMore, loadingInitial, loadingOlder, loadOlderLogs]);

    const handleScroll = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;

        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        const near = distFromBottom < 10;

        setShowScrollBtn(!near);
        if (near) setNewEntryCount(0);

        if (el.scrollTop < el.clientHeight * 0.5 && !loadingOlderRef.current && hasMore) {
            loadOlderLogs();
        }
    }, [hasMore, loadOlderLogs]);

    const filtered = (() => {
        if (levelFilter === 'ALL') return logs;
        if (levelFilter === 'DIAG') return logs.filter(l => DIAG_LEVELS.has(l.level));
        return logs.filter(l => l.level === levelFilter);
    })();

    const groupedByFile = (() => {
        if (sortBy !== 'file') return null;
        const groups = new Map<string, TaggedEntry[]>();
        for (const entry of filtered) {
            const file = entry.source ?? 'unknown';
            if (!groups.has(file)) groups.set(file, []);
            groups.get(file)!.push(entry);
        }
        return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
    })();

    return (
        <div className='logs-section'>
            <div className='logs-toolbar'>
                <select
                    className='logs-select'
                    value={hours}
                    onChange={e => setHours(Number(e.target.value))}
                >
                    <option value={1}>Last 1 hour</option>
                    <option value={6}>Last 6 hours</option>
                    <option value={24}>Last 24 hours</option>
                    <option value={48}>Last 48 hours</option>
                    <option value={168}>Last 7 days</option>
                    <option value={720}>Last 30 days</option>
                </select>
                <select
                    className='logs-select'
                    value={levelFilter}
                    onChange={e => setLevelFilter(e.target.value)}
                >
                    <option value='ALL'>All levels</option>
                    <option value='INF'>Info</option>
                    <option value='SUC'>Success</option>
                    <option value='WRN'>Warning</option>
                    <option value='ERR'>Error</option>
                    <option value='CRT'>Critical</option>
                    <option value='DBG'>Debug</option>
                    <option value='DIAG'>Diag (all)</option>
                    <option value='DIG'>Diag</option>
                    <option value='WDG'>Diag Warning</option>
                    <option value='EDG'>Diag Error</option>
                    <option value='CDG'>Diag Critical</option>
                </select>
                <select
                    className='logs-select'
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value as 'time' | 'file')}
                >
                    <option value='time'>Sort: time</option>
                    <option value='file'>Sort: file</option>
                </select>
                <label className='logs-toggle'>
                    <input
                        type='checkbox'
                        className='switch'
                        checked={autoRefresh}
                        onChange={e => setAutoRefresh(e.target.checked)}
                    />
                    Auto-refresh
                </label>
                <button
                    className='logs-refresh-btn'
                    onClick={fetchInitial}
                    disabled={loadingInitial}
                    data-type='secondary'
                >
                    <RefreshCw size={13} className={loadingInitial ? 'logs-spinning' : ''} />
                    Refresh
                </button>
            </div>
            <div className='logs-wrapper'>
                <div className='logs-container' ref={containerRef} onScroll={handleScroll}>
                    {loadingOlder && (
                        <div className='logs-loading-older'>
                            <RefreshCw size={11} className='logs-spinning' />
                            Loading older…
                        </div>
                    )}
                    {!hasMore && !loadingInitial && logs.length > 0 && (
                        <div className='logs-top-marker'>— beginning of log —</div>
                    )}
                    {filtered.length === 0 && !loadingInitial && (
                        <div className='logs-empty'>No logs found</div>
                    )}
                    {filtered.map(entry => {
                        const cls = LEVEL_CLASS[entry.level] ?? 'info';
                        const chain = entry.call_chain?.length > 0 ? entry.call_chain : [entry.source];
                        return (
                            <div key={entry._id} className={`log-row log-row--${cls}`}>
                                <span className='log-time'>{entry.timestamp.split(' ')[1]}</span>
                                <span className={`log-level-badge log-level-badge--${cls}`}>{entry.level}</span>
                                <div className='log-source-col'>
                                    {chain.map((frame, fi) => (
                                        <span
                                            key={fi}
                                            className={fi === 0 ? 'log-source' : 'log-chain-frame'}
                                            style={fi > 0 ? { paddingLeft: `${fi * 10}px` } : undefined}
                                        >
                                            {fi > 0 && '↳ '}{frame}
                                        </span>
                                    ))}
                                </div>
                                <span className='log-message'>{entry.message}</span>
                            </div>
                        );
                    })}
                </div>
                {showScrollBtn && (
                    <button className='logs-scroll-btn' onClick={() => scrollToBottom(true)}>
                        {newEntryCount > 0 && (
                            <span className='logs-new-badge'>{newEntryCount} new</span>
                        )}
                        <ArrowDown size={13} />
                    </button>
                )}
            </div>
            <div className='logs-footer'>
                {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
                {levelFilter !== 'ALL' && ` (filtered from ${logs.length})`}
            </div>
        </div>
    );
}

export default Logs;