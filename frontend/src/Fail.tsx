import { useTranslation } from 'react-i18next';
export default function Failure() {
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
            <h1>{t('fail.title')}</h1>
            <p>{t('fail.subtitle')}</p>
            <p>{t('fail.subtitle2')}</p>
            <p>{t('fail.subtitle3')}</p>
        </div>
    );
}