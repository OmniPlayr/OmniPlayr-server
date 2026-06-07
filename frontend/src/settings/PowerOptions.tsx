import { useState, useEffect } from 'react';
import api from '../modules/api';
import '../styles/settings/PowerOptions.css';
import { Power, RotateCcw, Shield, ShieldOff } from 'lucide-react';
import { navigate } from '../modules/navigate';
import { useTranslation } from 'react-i18next';

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

    const { t } = useTranslation();

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
        return <div className='power-options-loading'>{t('common.loading')}</div>;
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
                        <p className='power-option-title'>{t('settings.power.safe_mode')}</p>
                        <p className='power-option-desc'>
                            {safeMode
                                ? t('settings.power.safe_mode.desc.active')
                                : t('settings.power.safe_mode.desc.inactive')
                            }
                        </p>
                        {safeMode && <p className='power-option-note'>{t('settings.power.safe_mode.restart.disabled')}</p>}
                        {!safeMode && <p className='power-option-note'>{t('settings.power.safe_mode.restart.enabled')}</p>}
                    </div>
                </div>
                <button
                    onClick={toggleSafeMode}
                    disabled={safeModeWorking}
                    data-type={safeMode ? 'secondary' : 'primary'}
                >
                    {safeMode ? t('settings.power.safe_mode.disable') : t('settings.power.safe_mode.enable')}
                </button>
            </div>

            <div className='power-option-card'>
                <div className='power-option-info'>
                    <RotateCcw className='power-option-icon power-option-icon--info' />
                    <div>
                        <p className='power-option-title'>{t('settings.power.reboot')}</p>
                        <p className='power-option-desc'>
                            {t('settings.power.reboot.desc')}
                        </p>
                    </div>
                </div>
                {actionDone === 'reboot' ? (
                    <p className='power-option-done'>{t('settings.power.reboot.done')}</p>
                ) : confirming === 'reboot' ? (
                    <div className='power-option-confirm'>
                        <span>{t('settings.power.reboot.confirm')}</span>
                        <button onClick={() => handleAction('reboot')} data-type='primary'>{t('settings.power.reboot.confirm.yes')}</button>
                        <button onClick={() => setConfirming(null)} data-type='secondary'>{t('settings.power.reboot.confirm.no')}</button>
                    </div>
                ) : (
                    <button onClick={() => handleAction('reboot')} data-type='secondary'>{t('settings.power.reboot.button')}</button>
                )}
            </div>

            <div className='power-option-card'>
                <div className='power-option-info'>
                    <Power className='power-option-icon power-option-icon--danger' />
                    <div>
                        <p className='power-option-title'>{t('settings.power.shutdown')}</p>
                        <p className='power-option-desc'>
                            {t('settings.power.shutdown.desc')}
                        </p>
                    </div>
                </div>
                {actionDone === 'shutdown' ? (
                    <p className='power-option-done'>{t('settings.power.shutdown.done')}</p>
                ) : confirming === 'shutdown' ? (
                    <div className='power-option-confirm'>
                        <span>{t('settings.power.shutdown.confirm')}</span>
                        <button onClick={() => handleAction('shutdown')} data-type='primary'>{t('settings.power.shutdown.confirm.yes')}</button>
                        <button onClick={() => setConfirming(null)} data-type='secondary'>{t('settings.power.shutdown.confirm.no')}</button>
                    </div>
                ) : (
                    <button onClick={() => handleAction('shutdown')} data-type='secondary'>{t('settings.power.shutdown.button')}</button>
                )}
            </div>
        </div>
    );
}

export default PowerOptions;