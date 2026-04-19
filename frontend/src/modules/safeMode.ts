import { getConfig } from './config';

let _status = false;
const _listeners: Array<(v: boolean) => void> = [];

export function getSafeMode(): boolean {
    return _status;
}

export async function initSafeMode(): Promise<boolean> {
    try {
        const baseUrl = getConfig<string>('api.apiUrl') ?? '';
        const res = await fetch(`${baseUrl}/api/info/safe-mode`);
        if (res.ok) {
            const data = await res.json();
            _status = Boolean(data.safe_mode);
        }
    } catch {
        _status = false;
    }
    _listeners.forEach(fn => fn(_status));
    return _status;
}

export function onSafeModeChange(fn: (v: boolean) => void): () => void {
    _listeners.push(fn);
    return () => {
        const idx = _listeners.indexOf(fn);
        if (idx !== -1) _listeners.splice(idx, 1);
    };
}