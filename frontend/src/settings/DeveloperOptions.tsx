// Parser Action
// @devonly.all
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import '../styles/settings/DeveloperOptions.css'

const DEV_OPTIONS_EVENT = 'omniplayr-dev-options-change'

type DevOptionKey = 'show_info_tabs' | 'audio_info' | 'network_info' | 'console_info'

function getDevOption(key: DevOptionKey) {
    return localStorage.getItem(`dev_options_${key}`) === 'true'
}

function setDevOption(key: DevOptionKey, value: boolean) {
    try {
        localStorage.setItem(`dev_options_${key}`, String(value))
    } catch (error) {
        console.warn('Could not save developer option.', error)
    }
    window.dispatchEvent(new Event(DEV_OPTIONS_EVENT))
}

function DeveloperToggle({
    optionKey,
    title,
    description,
    disabled = false,
}: {
    optionKey: DevOptionKey
    title: string
    description: string
    disabled?: boolean
}) {
    const [checked, setChecked] = useState(() => getDevOption(optionKey))

    function toggle(value: boolean) {
        setChecked(value)
        setDevOption(optionKey, value)
    }

    return (
        <div className={`settings-toggle-item ${disabled ? 'disabled' : ''}`}>
            <input
                type='checkbox'
                className='switch'
                checked={checked}
                disabled={disabled}
                onChange={(event) => toggle(event.target.checked)}
            />
            <div className='settings-toggle-info'>
                <p className='settings-toggle-item-name'>{title}</p>
                <p className='settings-toggle-item-description'>{description}</p>
            </div>
        </div>
    )
}

function DeveloperOptions() {
    const { t } = useTranslation()
    const [showInfoTabs, setShowInfoTabs] = useState(() => getDevOption('show_info_tabs'))

    function handleShowInfoTabs(value: boolean) {
        setShowInfoTabs(value)
        setDevOption('show_info_tabs', value)
    }

    return (
        <div className='developer-options-settings'>
            <div className='developer-settings-item-group'>
                <div className='developer-settings-item-group-header'>
                    <h2 className='developer-settings-item-group-title'>{t('settings.devoptions.info_tabs.title')}</h2>
                    <p className='developer-settings-item-group-description'>
                        {t('settings.devoptions.info_tabs.desc')}
                    </p>
                </div>
                <div className='settings-toggle-item'>
                    <input
                        type='checkbox'
                        className='switch'
                        checked={showInfoTabs}
                        onChange={(event) => handleShowInfoTabs(event.target.checked)}
                    />
                    <div className='settings-toggle-info'>
                        <p className='settings-toggle-item-name'>{t('settings.devoptions.show_info_tabs')}</p>
                        <p className='settings-toggle-item-description'>{t('settings.devoptions.show_info_tabs.desc')}</p>
                    </div>
                </div>

                <DeveloperToggle
                    optionKey='audio_info'
                    title={t('settings.devoptions.audio_info')}
                    description={t('settings.devoptions.audio_info.desc')}
                    disabled={!showInfoTabs}
                />

                <DeveloperToggle
                    optionKey='network_info'
                    title={t('settings.devoptions.network_info')}
                    description={t('settings.devoptions.network_info.desc')}
                    disabled={!showInfoTabs}
                />

                <DeveloperToggle
                    optionKey='console_info'
                    title={t('settings.devoptions.console_info')}
                    description={t('settings.devoptions.console_info.desc')}
                    disabled={!showInfoTabs}
                />
            </div>
        </div>
    )
}

export default DeveloperOptions
