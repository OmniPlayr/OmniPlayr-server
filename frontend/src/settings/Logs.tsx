import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../modules/api';
import '../styles/settings/Logs.css';
import { RefreshCw } from 'lucide-react';

interface LogEntry {
    timestamp: string;
    level: string;
    source: string;
    message: string;
}

const LEVEL_CLASS: Record<string, string> = {
    INF: 'info',
    SUC: 'success',
    WRN: 'warning',
    ERR: 'error',
    CRT: 'critical',
    DBG: 'debug',
};

function Logs() {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [hours, setHours] = useState(24);
    const [levelFilter, setLevelFilter] = useState('ALL');
    const [autoRefresh, setAutoRefresh] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api(`/logs/?hours=${hours}`) as LogEntry[];
            setLogs(Array.isArray(data) ? data : []);
        } catch {
            setLogs([]);
        }
        setLoading(false);
    }, [hours]);

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [logs, levelFilter]);

    useEffect(() => {
        if (!autoRefresh) return;
        const id = setInterval(fetchLogs, 15000);
        return () => clearInterval(id);
    }, [autoRefresh, fetchLogs]);

    const filtered = levelFilter === 'ALL'
        ? logs
        : logs.filter(l => l.level === levelFilter);

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
                    onClick={fetchLogs}
                    disabled={loading}
                    data-type='secondary'
                >
                    <RefreshCw size={13} className={loading ? 'logs-spinning' : ''} />
                    Refresh
                </button>
            </div>
            <div className='logs-container' ref={containerRef}>
                {filtered.length === 0 && !loading && (
                    <div className='logs-empty'>No logs found</div>
                )}
                {filtered.map((log, i) => {
                    const cls = LEVEL_CLASS[log.level] ?? 'info';
                    return (
                        <div key={i} className={`log-row log-row--${cls}`}>
                            <span className='log-time'>{log.timestamp.split(' ')[1]}</span>
                            <span className={`log-level-badge log-level-badge--${cls}`}>{log.level}</span>
                            <span className='log-source'>{log.source}</span>
                            <span className='log-message'>{log.message}</span>
                        </div>
                    );
                })}
            </div>
            <div className='logs-footer'>
                {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
                {levelFilter !== 'ALL' && ` (filtered from ${logs.length})`}
            </div>
        </div>
    );
}

export default Logs;