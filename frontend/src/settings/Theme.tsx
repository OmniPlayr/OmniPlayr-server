import { useState, useEffect } from 'react';
import '../styles/settings/Theme.css';

function getSystemTheme(): string {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: string) {
    document.documentElement.classList.add('no-transitions');
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            document.documentElement.classList.remove('no-transitions');
        });
    });
}

function Theme() {
    const [preferSystemTheme, setPreferSystemTheme] = useState<boolean>(
        localStorage.getItem('prefer_system_theme') === 'true'
    );

    const getInitialTheme = () => {
        if (localStorage.getItem('prefer_system_theme') === 'true') return getSystemTheme();
        return localStorage.getItem('theme') ?? 'light';
    };

    const [activeTheme, setActiveTheme] = useState<string>(getInitialTheme);

    useEffect(() => {
        applyTheme(activeTheme);
    }, []);

    const handleThemeChange = (theme: string) => {
        applyTheme(theme);
        setActiveTheme(theme);
    };

    const handleSystemThemeToggle = (checked: boolean) => {
        setPreferSystemTheme(checked);
        localStorage.setItem('prefer_system_theme', String(checked));
        if (checked) {
            const systemTheme = getSystemTheme();
            applyTheme(systemTheme);
            setActiveTheme(systemTheme);
        }
    };

    return (
        <div className='theme-section'>
            <div className={`theme-options ${preferSystemTheme ? 'disabled' : ''}`}>
                <div className={`theme-option ${activeTheme === 'light' ? 'active' : ''}`} id='light' onClick={() => !preferSystemTheme && handleThemeChange('light')}>
                    <div className='theme-option-preview'></div>
                    <p className='theme-option-name'>Light</p>
                </div>
                <div className={`theme-option ${activeTheme === 'dark' ? 'active' : ''}`} id='dark' onClick={() => !preferSystemTheme && handleThemeChange('dark')}>
                    <div className='theme-option-preview'></div>
                    <p className='theme-option-name'>Dark</p>
                </div>
            </div>
            <div className='settings-toggle-item'>
                <input
                    type='checkbox'
                    className='switch'
                    checked={preferSystemTheme}
                    onChange={(e) => handleSystemThemeToggle(e.target.checked)}
                />
                <div className='settings-toggle-info'>
                    <p className='settings-toggle-item-name'>Prefer system theme</p>
                    <p className='settings-toggle-item-description'>Use the theme applied to your device.</p>
                </div>
            </div>
        </div>
    );
}

export default Theme;