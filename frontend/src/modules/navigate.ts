import type { NavigateFunction } from 'react-router-dom';

let _navigate: NavigateFunction;

export function setNavigate(fn: NavigateFunction) {
    _navigate = fn;
}

export function navigate(to: string) {
    _navigate?.(to);
}