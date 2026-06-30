import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
    const { t } = useTranslation();
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
                    <option value={1}>{t('settings.logs.hours.1')}</option>
                    <option value={6}>{t('settings.logs.hours.6')}</option>
                    <option value={24}>{t('settings.logs.hours.24')}</option>
                    <option value={48}>{t('settings.logs.hours.48')}</option>
                    <option value={168}>{t('settings.logs.hours.168')}</option>
                    <option value={720}>{t('settings.logs.hours.720')}</option>
                </select>
                <select
                    className='logs-select'
                    value={levelFilter}
                    onChange={e => setLevelFilter(e.target.value)}
                >
                    <option value='ALL'>{t('settings.logs.level.all')}</option>
                    <option value='INF'>{t('settings.logs.level.inf')}</option>
                    <option value='SUC'>{t('settings.logs.level.suc')}</option>
                    <option value='WRN'>{t('settings.logs.level.wrn')}</option>
                    <option value='ERR'>{t('settings.logs.level.err')}</option>
                    <option value='CRT'>{t('settings.logs.level.crt')}</option>
                    <option value='DBG'>{t('settings.logs.level.dbg')}</option>
                    <option value='DIAG'>{t('settings.logs.level.diag_all')}</option>
                    <option value='DIG'>{t('settings.logs.level.dig')}</option>
                    <option value='WDG'>{t('settings.logs.level.wdg')}</option>
                    <option value='EDG'>{t('settings.logs.level.edg')}</option>
                    <option value='CDG'>{t('settings.logs.level.cdg')}</option>
                </select>
                <select
                    className='logs-select'
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value as 'time' | 'file')}
                >
                    <option value='time'>{t('settings.logs.sort.time')}</option>
                    <option value='file'>{t('settings.logs.sort.file')}</option>
                </select>
                <label className='logs-toggle'>
                    <input
                        type='checkbox'
                        className='switch'
                        checked={autoRefresh}
                        onChange={e => setAutoRefresh(e.target.checked)}
                    />
                    {t('settings.logs.auto_refresh')}
                </label>
                <button
                    className='logs-refresh-btn'
                    onClick={fetchInitial}
                    disabled={loadingInitial}
                    data-type='secondary'
                >
                    <RefreshCw size={13} className={loadingInitial ? 'logs-spinning' : ''} />
                    {t('settings.logs.refresh')}
                </button>
            </div>
            <div className='logs-wrapper'>
                <div className='logs-container' ref={containerRef} onScroll={handleScroll}>
                    {loadingOlder && (
                        <div className='logs-loading-older'>
                            <RefreshCw size={11} className='logs-spinning' />
                            {t('settings.logs.loading_older')}
                        </div>
                    )}
                    {!hasMore && !loadingInitial && logs.length > 0 && (
                        <div className='logs-top-marker'>{t('settings.logs.beginning')}</div>
                    )}
                    {filtered.length === 0 && !loadingInitial && (
                        <div className='logs-empty'>{t('settings.logs.empty')}</div>
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
                            <span className='logs-new-badge'>{t('settings.logs.new_count', { count: newEntryCount })}</span>
                        )}
                        <ArrowDown size={13} />
                    </button>
                )}
            </div>
            <div className='logs-footer'>
                {t('settings.logs.footer.entries', { count: filtered.length })}
                {levelFilter !== 'ALL' && ` ${t('settings.logs.footer.filtered', { total: logs.length })}`}
            </div>
        </div>
    );
}

export default Logs;