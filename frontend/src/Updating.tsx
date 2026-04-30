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

        const interval = setInterval(async () => {
            try {
                const res = await loadServerInfo();

                if (res && !stopped) {
                    clearInterval(interval);
                    navigate('/dashboard');
                }
            } catch (e) {}
        }, 1000);

        return () => {
            stopped = true;
            clearInterval(interval);
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