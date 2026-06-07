import '../styles/settings/Language.css'
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import translations from '../locales/translations.json'
import { ChevronUp } from 'lucide-react'

function getSystemLanguage() {
    return navigator.languages[0] || navigator.language
}

function Language() {
    const { i18n } = useTranslation()
    const { t } = useTranslation()

    const [preferSystemLanguage, setPreferSystemLanguage] = useState(
        localStorage.getItem('prefer_system_language') === 'true'
    )

    const [currentLang, setCurrentLang] = useState(
        localStorage.getItem('language') ?? 'en'
    )

    const [open, setOpen] = useState(false)

    const languages = Object.entries(translations)

    const current =
        (translations as any)[currentLang] ?? (translations as any)['en']

    function changeLanguage(lang: string) {
        const exists = Object.prototype.hasOwnProperty.call(translations, lang)
        const finalLang = exists ? lang : 'en'

        i18n.changeLanguage(finalLang)
        localStorage.setItem('language', finalLang)
        setCurrentLang(finalLang)
        setOpen(false)
    }

    function handleSystemLanguageToggle(value: boolean) {
        setPreferSystemLanguage(value)
        localStorage.setItem('prefer_system_language', String(value))

        if (value) {
            const sysLang = getSystemLanguage().slice(0, 2)

            const exists = Object.prototype.hasOwnProperty.call(translations, sysLang)
            const finalLang = exists ? sysLang : 'en'

            changeLanguage(finalLang)
        }
    }

    useEffect(() => {
        const preload = (src?: string) => {
            if (!src) return
            const img = new Image()
            img.src = src
        }

        preload(current.flag)
        preload(current.author?.avatar)
    }, [currentLang])

    useEffect(() => {
        const preload = (src?: string) => {
            if (!src) return
            const img = new Image()
            img.src = src
        }

        Object.values(translations).forEach((lang: any) => {
            preload(lang.flag)
            preload(lang.author?.avatar)
        })
    }, [])

    return (
        <div className='settings-language'>
            <div className='settings-toggle-item'>
                <input
                    type='checkbox'
                    className='switch'
                    checked={preferSystemLanguage}
                    onChange={(e) =>
                        handleSystemLanguageToggle(e.target.checked)
                    }
                />

                <div className='settings-toggle-info'>
                    <p className='settings-toggle-item-name'>
                        {t('settings.language.system')}
                    </p>
                    <p className='settings-toggle-item-description'>
                        {t('settings.language.system.desc')}
                    </p>
                </div>
            </div>

            <div className='settings-dropdown'>
                <div
                    className='settings-dropdown-button'
                    onClick={() => setOpen(!open)}
                >
                    <img
                        src={current.flag}
                        className='settings-flag'
                        alt=''
                    />

                    <div className='settings-dropdown-button-text'>
                        <div>{current.language}</div>
                        <div className='settings-dropdown-subtext'>
                            @{current.author.name}
                        </div>
                    </div>

                    <ChevronUp
                        className={`settings-dropdown-button-icon ${open ? 'open' : ''}`}
                    />
                </div>
                <div className={`settings-dropdown-list ${open ? 'open' : ''}`}>
                    {languages.map(([code, data]: any) => (
                        <div
                            key={code}
                            className='settings-dropdown-item'
                            onClick={() => changeLanguage(code)}
                        >
                            <img
                                src={data.flag}
                                className='settings-flag'
                                alt=''
                            />

                            <div className='settings-dropdown-item-text'>
                                <div>{data.language}</div>

                                <a
                                    href={data.author.url}
                                    target='_blank'
                                    rel='noreferrer'
                                    className='settings-author-link'
                                    onClick={(e) => e.stopPropagation()}
                                >

                                    <img
                                        src={data.author.avatar}
                                        className={'settings-author-avatar' + (data.author.org ? ' org' : '')}
                                        alt=''
                                    />
                                    <span className='settings-author-name'>@{data.author.name}</span>
                                </a>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

export default Language