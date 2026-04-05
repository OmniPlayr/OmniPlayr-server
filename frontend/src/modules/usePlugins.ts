import { useEffect } from 'react';
import { startDOMHookObserver, stopDOMHookObserver } from './plugins';

export function usePlugins() {
    useEffect(() => {
        startDOMHookObserver();
        return () => stopDOMHookObserver();
    }, []);
}