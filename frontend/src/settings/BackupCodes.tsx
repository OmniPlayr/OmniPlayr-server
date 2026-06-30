import { useEffect, useMemo, useState } from 'react';
import { Download, Printer, ShieldCheck, PenLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../modules/api';
import '../styles/settings/BackupCodes.css';

type BackupCodeState = 'loading' | 'ready' | 'exists' | 'unavailable' | 'error';

function BackupCodes() {
    const { t } = useTranslation();
    const [state, setState] = useState<BackupCodeState>('loading');
    const [codes, setCodes] = useState<string[]>([]);

    const backupText = useMemo(() => {
        return [
            t('settings.backup_codes.file.title'),
            '',
            t('settings.backup_codes.file.warning'),
            '',
            ...codes.map((code, index) => `${index + 1}. ${code}`),
        ].join('\n');
    }, [codes, t]);

    useEffect(() => {
        let cancelled = false;

        api('/accounts/me/backup_codes', {}, undefined, true, false, 'POST')
            .then((res: unknown) => {
                if (cancelled) return;
                const data = res as { backup_codes?: unknown };
                const generated = Array.isArray(data.backup_codes) ? data.backup_codes.filter((code): code is string => typeof code === 'string') : [];
                setCodes(generated);
                setState(generated.length > 0 ? 'ready' : 'unavailable');
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                const error = err as { status?: number; response?: { status?: number } };
                const status = error?.status ?? error?.response?.status;
                if (status === 409) {
                    setState('exists');
                    return;
                }
                if (status === 400) {
                    setState('unavailable');
                    return;
                }
                setState('error');
            });

        return () => {
            cancelled = true;
        };
    }, []);

    function downloadCodes() {
        const blob = new Blob([backupText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'omniplayr-backup-codes.txt';
        link.click();
        URL.revokeObjectURL(url);
    }

    function printCodes() {
        const printWindow = window.open('', '_blank', 'noopener,noreferrer');
        if (!printWindow) {
            window.print();
            return;
        }

        printWindow.document.write(`
            <html>
                <head>
                    <title>${t('settings.backup_codes.title')}</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 32px; color: #111; }
                        h1 { font-size: 24px; margin-bottom: 8px; }
                        p { line-height: 1.5; max-width: 640px; }
                        ol { columns: 2; margin-top: 24px; font-family: monospace; font-size: 16px; }
                        li { break-inside: avoid; margin-bottom: 10px; }
                    </style>
                </head>
                <body>
                    <h1>${t('settings.backup_codes.title')}</h1>
                    <p>${t('settings.backup_codes.print_warning')}</p>
                    <ol>${codes.map(code => `<li>${code}</li>`).join('')}</ol>
                </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
    }

    return (
        <div className="backup-codes-page">
            <section className="backup-codes-hero">
                <ShieldCheck className="backup-codes-hero-icon" />
                <div>
                    <h2 className="backup-codes-title">{t('settings.backup_codes.title')}</h2>
                    <p className="backup-codes-text">{t('settings.backup_codes.text')}</p>
                </div>
            </section>

            {state === 'loading' && (
                <div className="backup-codes-status">{t('settings.backup_codes.loading')}</div>
            )}

            {state === 'ready' && (
                <>
                    <div className="backup-codes-warning">
                        <PenLine className="backup-codes-warning-icon" />
                        <p>{t('settings.backup_codes.save_warning')}</p>
                    </div>
                    <div className="backup-codes-grid">
                        {codes.map((code, index) => (
                            <code key={code} className="backup-code-item">
                                <span>{index + 1}</span>
                                {code}
                            </code>
                        ))}
                    </div>
                    <div className="backup-codes-actions">
                        <button className="backup-codes-action" onClick={downloadCodes}>
                            <Download size={18} />
                            {t('settings.backup_codes.download')}
                        </button>
                        <button className="backup-codes-action" onClick={printCodes}>
                            <Printer size={18} />
                            {t('settings.backup_codes.print')}
                        </button>
                    </div>
                </>
            )}

            {state === 'exists' && (
                <div className="backup-codes-status">
                    <h3>{t('settings.backup_codes.exists.title')}</h3>
                    <p>{t('settings.backup_codes.exists.text')}</p>
                </div>
            )}

            {state === 'unavailable' && (
                <div className="backup-codes-status">
                    <h3>{t('settings.backup_codes.unavailable.title')}</h3>
                    <p>{t('settings.backup_codes.unavailable.text')}</p>
                </div>
            )}

            {state === 'error' && (
                <div className="backup-codes-status backup-codes-status-error">
                    <h3>{t('settings.backup_codes.error.title')}</h3>
                    <p>{t('settings.backup_codes.error.text')}</p>
                </div>
            )}
        </div>
    );
}

export default BackupCodes;
