import { useState, useEffect } from 'react';
import '../styles/settings/Fonts.css';
import fontsCSS from '../styles/fonts/default-fonts.css?raw';

const CATEGORIES: Record<string, string[]> = {
    'Sans-serif': ['inter', 'dm-sans', 'helvetica', 'neue-haas-grotesk', 'cabinet-grotesk', 'lato', 'source-sans-pro'],
    'Serif': ['garamond', 'georgia', 'playfair-display', 'canela', 'fraunces'],
    'Monospace': ['jetbrains-mono', 'fira-code', 'commit-mono'],
    'System': ['system-ui'],
};

function parseFonts(css: string) {
    const regex = /--font-([\w-]+)-family:\s*([^;]+);/g;
    const map: Record<string, string> = {};
    let match;
    while ((match = regex.exec(css)) !== null) {
        map[match[1]] = match[2].trim();
    }
    return map;
}

const FONT_MAP = parseFonts(fontsCSS);

const DISPLAY_NAMES: Record<string, string> = {
    'inter': 'Inter',
    'garamond': 'Garamond',
    'georgia': 'Georgia',
    'playfair-display': 'Playfair Display',
    'helvetica': 'Helvetica',
    'neue-haas-grotesk': 'Neue Haas Grotesk',
    'dm-sans': 'DM Sans',
    'jetbrains-mono': 'JetBrains Mono',
    'fira-code': 'Fira Code',
    'commit-mono': 'Commit Mono',
    'canela': 'Canela',
    'fraunces': 'Fraunces',
    'cabinet-grotesk': 'Cabinet Grotesk',
    'system-ui': 'System UI',
    'lato': 'Lato',
    'source-sans-pro': 'Source Sans',
};

function applyFont(key: string) {
    document.documentElement.setAttribute('data-font', key);
    localStorage.setItem('font', key);
}

function Fonts() {
    const [activeFont, setActiveFont] = useState(() => localStorage.getItem('font') ?? 'inter');
    const [search, setSearch] = useState('');

    useEffect(() => {
        applyFont(activeFont);
    }, []);

    function handleSelect(key: string) {
        setActiveFont(key);
        applyFont(key);
    }

    const query = search.toLowerCase();

    const filteredCategories = Object.entries(CATEGORIES).reduce<Record<string, string[]>>((acc, [category, keys]) => {
        const filtered = keys.filter(key =>
            DISPLAY_NAMES[key]?.toLowerCase().includes(query)
        );
        if (filtered.length > 0) acc[category] = filtered;
        return acc;
    }, {});

    return (
        <div className='font-section'>
            <input
                className='font-search'
                type='text'
                placeholder='Search fonts...'
                value={search}
                onChange={e => setSearch(e.target.value)}
            />
            {Object.entries(filteredCategories).map(([category, keys]) => (
                <div key={category} className='font-category'>
                    <p className='font-category-name'>{category}</p>
                    <div className='font-options'>
                        {keys.map(key => (
                            <div
                                key={key}
                                className={`font-option${activeFont === key ? ' active' : ''}`}
                                onClick={() => handleSelect(key)}
                            >
                                <div
                                    className='font-option-preview'
                                    style={{ fontFamily: FONT_MAP[key] }}
                                >
                                    Aa
                                </div>
                                <p className='font-option-name'>{DISPLAY_NAMES[key]}</p>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

export default Fonts;