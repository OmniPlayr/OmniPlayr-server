import { useState, useEffect } from 'react';
import api from '../modules/api';
import '../styles/settings/PowerOptions.css';
import { Power, RotateCcw, Shield, ShieldOff } from 'lucide-react';
import { navigate } from '../modules/navigate';

async function waitForShutdown() {
    let alive = true;

    while (alive) {
        try {
            await api('/system/status');
            await new Promise(r => setTimeout(r, 1500));
        } catch {
            alive = false;
        }
    }

    navigate('/shutdown');
}

function PowerOptions() {
    const [safeMode, setSafeMode] = useState(false);
    const [loading, setLoading] = useState(true);
    const [confirming, setConfirming] = useState<string | null>(null);
    const [actionDone, setActionDone] = useState<string | null>(null);
    const [safeModeWorking, setSafeModeWorking] = useState(false);

    useEffect(() => {
        api('/system/status')
            .then((data: any) => {
                setSafeMode(data.safe_mode ?? false);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    async function handleAction(action: string) {
        if (confirming !== action) {
            setConfirming(action);
            return;
        }

        setConfirming(null);
        setActionDone(action);

        if (action === 'shutdown') {
            waitForShutdown();

            try {
                await api('/system/shutdown', {});
            } catch {
                
            }

            return;
        }

        if (action === 'reboot') {
            try {
                await api('/system/reboot', {});
            } catch {}

            setTimeout(() => window.location.reload(), 6000);
            return;
        }
    }

    async function toggleSafeMode() {
        setSafeModeWorking(true);
        const endpoint = safeMode ? '/system/safe-mode/disable' : '/system/safe-mode/enable';
        try {
            await api(endpoint, {});
            setSafeMode(prev => !prev);
        } catch {
        }
        setSafeModeWorking(false);
    }

    if (loading) {
        return <div className='power-options-loading'>Loading...</div>;
    }

    return (
        <div className='power-options-section'>
            <div className='power-option-card'>
                <div className='power-option-info'>
                    {safeMode
                        ? <ShieldOff className='power-option-icon power-option-icon--warning' />
                        : <Shield className='power-option-icon power-option-icon--success' />
                    }
                    <div>
                        <p className='power-option-title'>Safe Mode</p>
                        <p className='power-option-desc'>
                            {safeMode
                                ? 'Safe mode is active. All plugins are disabled on startup.'
                                : 'Safe mode is off. Plugins load normally on startup.'
                            }
                        </p>
                        {safeMode && <p className='power-option-note'>Restart required to take effect after disabling.</p>}
                        {!safeMode && <p className='power-option-note'>Restart required to take effect after enabling.</p>}
                    </div>
                </div>
                <button
                    onClick={toggleSafeMode}
                    disabled={safeModeWorking}
                    data-type={safeMode ? 'secondary' : 'primary'}
                >
                    {safeMode ? 'Disable Safe Mode' : 'Enable Safe Mode'}
                </button>
            </div>

            <div className='power-option-card'>
                <div className='power-option-info'>
                    <RotateCcw className='power-option-icon power-option-icon--info' />
                    <div>
                        <p className='power-option-title'>Reboot</p>
                        <p className='power-option-desc'>
                            Restart the server. The page will reload automatically after a few seconds.
                        </p>
                    </div>
                </div>
                {actionDone === 'reboot' ? (
                    <p className='power-option-done'>Rebooting, page will reload shortly…</p>
                ) : confirming === 'reboot' ? (
                    <div className='power-option-confirm'>
                        <span>Are you sure?</span>
                        <button onClick={() => handleAction('reboot')} data-type='primary'>Reboot</button>
                        <button onClick={() => setConfirming(null)} data-type='secondary'>Cancel</button>
                    </div>
                ) : (
                    <button onClick={() => handleAction('reboot')} data-type='secondary'>Reboot</button>
                )}
            </div>

            <div className='power-option-card'>
                <div className='power-option-info'>
                    <Power className='power-option-icon power-option-icon--danger' />
                    <div>
                        <p className='power-option-title'>Shutdown</p>
                        <p className='power-option-desc'>
                            Shut down the server completely. Manual restart will be required.
                        </p>
                    </div>
                </div>
                {actionDone === 'shutdown' ? (
                    <p className='power-option-done'>Shutting down…</p>
                ) : confirming === 'shutdown' ? (
                    <div className='power-option-confirm'>
                        <span>Are you sure?</span>
                        <button onClick={() => handleAction('shutdown')} data-type='primary'>Shutdown</button>
                        <button onClick={() => setConfirming(null)} data-type='secondary'>Cancel</button>
                    </div>
                ) : (
                    <button onClick={() => handleAction('shutdown')} data-type='secondary'>Shutdown</button>
                )}
            </div>
        </div>
    );
}

export default PowerOptions;