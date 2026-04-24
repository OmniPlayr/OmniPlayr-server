import { useState, useEffect } from 'react';
import '../styles/settings/Theme.css';

function getSystemTheme(): 'light' | 'dark' {
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

function splitTheme(theme: string) {
    const isTransparent = theme.startsWith('transparent-');
    const base = theme.replace('transparent-', '');
    return {
        base: base as 'light' | 'dark',
        transparent: isTransparent
    };
}

function buildTheme(base: 'light' | 'dark', transparent: boolean) {
    return transparent ? `transparent-${base}` : base;
}

function Theme() {
    const [preferSystemTheme, setPreferSystemTheme] = useState(
        localStorage.getItem('prefer_system_theme') === 'true'
    );

    const savedTheme = localStorage.getItem('theme') ?? 'dark';
    const initial = splitTheme(savedTheme);

    const [baseTheme, setBaseTheme] = useState<'light' | 'dark'>(initial.base);
    const [transparent, setTransparent] = useState(initial.transparent);

    const activeTheme = buildTheme(baseTheme, transparent);

    useEffect(() => {
        const themeToApply = preferSystemTheme
            ? buildTheme(getSystemTheme(), transparent)
            : activeTheme;

        applyTheme(themeToApply);
    }, [baseTheme, transparent, preferSystemTheme]);

    const handleThemeChange = (theme: 'light' | 'dark') => {
        setBaseTheme(theme);
    };

    const handleSystemThemeToggle = (checked: boolean) => {
        setPreferSystemTheme(checked);
        localStorage.setItem('prefer_system_theme', String(checked));
    };

    const handleTransparentToggle = (checked: boolean) => {
        setTransparent(checked);
    };

    return (
        <div className='theme-section'>

            <div className={`theme-options ${preferSystemTheme ? 'disabled' : ''}`}>
                <div
                    className={`theme-option ${baseTheme === 'light' && !transparent ? 'active' : ''}`}
                    id='light'
                    onClick={() => !preferSystemTheme && handleThemeChange('light')}
                >
                    <div className='theme-option-preview'></div>
                    <p className='theme-option-name'>Light</p>
                </div>

                <div
                    className={`theme-option ${baseTheme === 'dark' && !transparent ? 'active' : ''}`}
                    id='dark'
                    onClick={() => !preferSystemTheme && handleThemeChange('dark')}
                >
                    <div className='theme-option-preview'></div>
                    <p className='theme-option-name'>Dark</p>
                </div>
            </div>

            <div className='settings-toggle-item'>
                <input
                    type='checkbox'
                    className='switch'
                    checked={transparent}
                    disabled={preferSystemTheme}
                    onChange={(e) => handleTransparentToggle(e.target.checked)}
                />
                <div className='settings-toggle-info'>
                    <p className='settings-toggle-item-name'>Use a transparent shell <span className='beta-tag'>Beta</span></p>
                    <p className='settings-toggle-item-description'>
                        Use a transparent shell if you have a browser that has a <a href='https://gist.github.com/levkris/67482961f4027f813bc652c6b3216eb8' target='_blank' className='link'>transparent shell/ui</a>.
                    </p>
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