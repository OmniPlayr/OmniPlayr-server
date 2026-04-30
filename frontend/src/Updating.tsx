import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from './modules/api';

export default function Updating() {
    const navigate = useNavigate();
    const location = useLocation();

    const force = new URLSearchParams(location.search).get('force') === 'true';

    async function loadServerInfo() {
        return await api('/info/server') as any[];
    }

    useEffect(() => {
        if (force) return;

        let stopped = false;
        let intervalId: number | undefined;

        const timeoutId = window.setTimeout(() => {
            if (stopped) return;

            intervalId = window.setInterval(async () => {
                try {
                    const res = await loadServerInfo();

                    if (res && !stopped) {
                        if (intervalId) window.clearInterval(intervalId);
                        navigate('/dashboard');
                    }
                } catch (e) {}
            }, 1000);
        }, 10000);

        return () => {
            stopped = true;
            window.clearTimeout(timeoutId);
            if (intervalId) window.clearInterval(intervalId);
        };
    }, [navigate, force]);

    return (
        <div style={{ padding: 40, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <style>
                {`
                    #root {
                        height: 100%;
                    }
                `}
            </style>
            <h1>Server is updating</h1>
            <p>The system is currently updating, you will be redirected back when the update is complete.</p>
        </div>
    );
}