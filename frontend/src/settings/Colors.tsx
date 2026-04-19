import { useEffect, useRef, useState } from 'react';
import { generateCssVars } from '../modules/customColor';
import { ColorPicker } from './ColorPicker';
import '../styles/settings/Colors.css';
import { RotateCcw } from 'lucide-react';

const STORAGE_KEY = 'custom_color';
const VAR_NAMES = Array.from({ length: 6 }, (_, i) => `--clr-primary-a${i * 10}`);

const DEFAULT_SWATCHES = [
    { name: '--clr-primary-a0', hex: '#6a4bc1' },
    { name: '--clr-primary-a10', hex: '#7c5ec8' },
    { name: '--clr-primary-a20', hex: '#8e71d0' },
    { name: '--clr-primary-a30', hex: '#9f84d7' },
    { name: '--clr-primary-a40', hex: '#af98de' },
    { name: '--clr-primary-a50', hex: '#c0ace5' },
];

function parseCssVars(cssString: string): { name: string; hex: string }[] {
    return cssString.split('\n').map(line => {
        const [namePart, hexPart] = line.split(':');
        return { name: namePart.trim(), hex: hexPart.replace(';', '').trim() };
    });
}

function applyColor(hex: string) {
    const cssVars = generateCssVars(hex, 'clr-primary');
    if (cssVars) document.documentElement.style.cssText += cssVars;
}

function removeColor() {
    VAR_NAMES.forEach(name => document.documentElement.style.removeProperty(name));
}

function Colors() {
    const saved = localStorage.getItem(STORAGE_KEY);
    const [color, setColor] = useState(saved ?? '#6a4bc1');
    const [isCustom, setIsCustom] = useState(!!saved);
    const [pickerOpen, setPickerOpen] = useState(false);
    const pickerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isCustom) applyColor(color);
    }, [color, isCustom]);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (
                pickerRef.current &&
                triggerRef.current &&
                !pickerRef.current.contains(e.target as Node) &&
                !triggerRef.current.contains(e.target as Node)
            ) {
                setPickerOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    function handleChange(hex: string) {
        setColor(hex);
        setIsCustom(true);
        localStorage.setItem(STORAGE_KEY, hex);
    }

    function handleReset() {
        setIsCustom(false);
        setColor('#6a4bc1');
        localStorage.removeItem(STORAGE_KEY);
        removeColor();
        setPickerOpen(false);
    }

    const cssVars = generateCssVars(color, 'clr-primary');
    const swatches = isCustom && cssVars ? parseCssVars(cssVars) : DEFAULT_SWATCHES;

    return (
        <div className='colors-section'>
            <div className='color-swatches'>
                {VAR_NAMES.map((varName, index) => (
                    <div className='color-item' key={varName}>
                        <span className='color-var-name'>{varName}</span>
                        {index === 0 ? (
                            <div className='color-picker-area' ref={triggerRef}>
                                <div
                                    className='color-option color-picker-trigger'
                                    style={{ backgroundColor: swatches[0].hex }}
                                    onClick={() => setPickerOpen(p => !p)}
                                >
                                    <div className='color-picker-icon'>
                                        <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                                            <path d='M12 20h9' />
                                            <path d='M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z' />
                                        </svg>
                                    </div>
                                </div>
                                {pickerOpen && (
                                    <div ref={pickerRef} className='color-picker-popover'>
                                        <ColorPicker value={color} onChange={handleChange} />
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div
                                className='color-option'
                                style={{ backgroundColor: swatches[index].hex }}
                            />
                        )}
                        <span className='color-hex'>{swatches[index].hex}</span>
                    </div>
                ))}
            </div>
            {isCustom && (
                <button className='colors-reset' data-type='primary' onClick={handleReset}>
                    <RotateCcw size={12} />
                    Reset to default
                </button>
            )}
        </div>
    );
}

export default Colors;