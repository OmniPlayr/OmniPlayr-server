import { useEffect } from 'react';
import { applyDOMHooks } from './plugins';

export function usePlugins() {
    useEffect(() => {
        applyDOMHooks();
    });
}