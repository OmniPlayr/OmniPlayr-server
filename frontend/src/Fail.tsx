import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { getConfig } from './modules/config';

type BackendFatalState = {
    active?: boolean;
    code?: string;
    message?: string;
    stage?: string | null;
    details?: string;
    created_at?: string;
};

const FAILURE_STATE_STORAGE_KEY = 'omniplayr_backend_failure_state';

async function fetchFatalState(): Promise<BackendFatalState | null> {
    try {
        const res = await fetch(`/omniplayr-fatal-state.json?ts=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return null;
        return await res.json() as BackendFatalState;
    } catch {
        return null;
    }
}

async function isBackendReachable(): Promise<boolean> {
    try {
        const baseUrl = getConfig<string>("api.apiUrl") ?? "";
        const res = await fetch(`${baseUrl}/api/info/safe-mode?ts=${Date.now()}`, { cache: 'no-store' });
        return res.ok;
    } catch {
        return false;
    }
}

export default function Failure() {
    const { t } = useTranslation()
    const [searchParams] = useSearchParams();
    const [fatalState, setFatalState] = useState<BackendFatalState | null>(null);
    const code = searchParams.get('code');
    const message = searchParams.get('message');

    useEffect(() => {
        const saved = sessionStorage.getItem(FAILURE_STATE_STORAGE_KEY);
        if (saved) {
            try {
                setFatalState(JSON.parse(saved) as BackendFatalState);
            } catch {}
        }

        let stopped = false;

        const retryBackend = async () => {
            const reachable = await isBackendReachable();
            if (stopped) return;

            if (reachable) {
                sessionStorage.removeItem(FAILURE_STATE_STORAGE_KEY);
                window.location.replace('/');
                return;
            }

            const state = await fetchFatalState();
            if (stopped) return;

            if (state?.active) {
                sessionStorage.setItem(FAILURE_STATE_STORAGE_KEY, JSON.stringify(state));
                setFatalState(state);
            }
        };

        void retryBackend();
        const intervalId = window.setInterval(retryBackend, 3000);

        return () => {
            stopped = true;
            window.clearInterval(intervalId);
        };
    }, []);

    const resolvedCode = fatalState?.code || code;
    const resolvedMessage = fatalState?.message || message;

    return (
        <div style={{ padding: 40, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <style>
                {`
                    #root {
                        height: 100%;
                    }

                    .failure-code {
                        margin-top: 16px;
                        padding: 8px 12px;
                        border-radius: 8px;
                        background: var(--clr-popup-a10);
                        border: 1px solid var(--clr-popup-a30);
                        font-family: monospace;
                    }

                    .failure-details {
                        width: min(900px, 100%);
                        max-height: 320px;
                        overflow: auto;
                        margin-top: 16px;
                        padding: 16px;
                        text-align: left;
                        border-radius: 8px;
                        background: var(--clr-popup-a10);
                        border: 1px solid var(--clr-popup-a30);
                        white-space: pre-wrap;
                    }

                    .failure-meta {
                        opacity: 0.8;
                        margin: 4px 0;
                    }
                `}
            </style>
            <h1>{resolvedMessage || t('fail.title')}</h1>
            <p>{resolvedMessage ? t('fail.backend_start_failed') : t('fail.subtitle')}</p>
            <p>{t('fail.subtitle2')}</p>
            <p>{t('fail.subtitle3')}</p>
            {resolvedCode && <p className="failure-code">{t('fail.error_code', { code: resolvedCode })}</p>}
            {fatalState?.stage && <p className="failure-meta">{t('fail.stage', { stage: fatalState.stage })}</p>}
            {fatalState?.created_at && <p className="failure-meta">{t('fail.created_at', { time: fatalState.created_at })}</p>}
            {fatalState?.details && <pre className="failure-details">{fatalState.details}</pre>}
        </div>
    );
}
