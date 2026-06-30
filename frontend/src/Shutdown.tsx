import { useTranslation } from 'react-i18next';

export default function Shutdown() {
    const { t } = useTranslation()
    
    return (
        <div style={{ padding: 40, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <style>
                {`
                    #root {
                        height: 100%;
                    }
                `}
            </style>
            <h1>{t('shutdown.title')}</h1>
            <p>{t('shutdown.comment')}</p>
        </div>
    );
}