import { useRef, useEffect, useCallback, useState } from 'react';
import '../styles/ColorPicker.css';

function hexToHsv(hex: string): [number, number, number] {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h = Math.round(h * 60);
        if (h < 0) h += 360;
    }
    return [h, max === 0 ? 0 : d / max, max];
}

function hsvToHex(h: number, s: number, v: number): string {
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const DEFAULT_SWATCHES = [
    '#32a852',
    '#fcba03',
    '#4287f5',
    '#e84040',
    '#9b59b6',
    '#1abc9c',
    '#e67e22',
    '#f06292',
    '#e74c3c',
    '#2980b9',
    '#27ae60',
    '#d35400',
];

interface Props {
    value: string;
    onChange: (hex: string) => void;
}

const SIZE = 200;

export function ColorPicker({ value, onChange }: Props) {
    const svCanvas = useRef<HTMLCanvasElement>(null);
    const dragging = useRef<'sv' | 'hue' | null>(null);
    const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(value));
    const [hexInput, setHexInput] = useState(value);

    const [h, s, v] = hsv;

    useEffect(() => {
        const canvas = svCanvas.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d')!;
        const gradH = ctx.createLinearGradient(0, 0, SIZE, 0);
        gradH.addColorStop(0, 'white');
        gradH.addColorStop(1, `hsl(${h}, 100%, 50%)`);
        ctx.fillStyle = gradH;
        ctx.fillRect(0, 0, SIZE, SIZE);
        const gradV = ctx.createLinearGradient(0, 0, 0, SIZE);
        gradV.addColorStop(0, 'transparent');
        gradV.addColorStop(1, 'black');
        ctx.fillStyle = gradV;
        ctx.fillRect(0, 0, SIZE, SIZE);
    }, [h]);

    const handleSvPointer = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
        if (e.type === 'pointerdown') {
            e.currentTarget.setPointerCapture(e.pointerId);
            dragging.current = 'sv';
        }
        if (dragging.current !== 'sv') return;
        if (e.type === 'pointerup') { dragging.current = null; return; }
        const rect = e.currentTarget.getBoundingClientRect();
        const newS = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const newV = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        const newHsv: [number, number, number] = [h, newS, newV];
        setHsv(newHsv);
        const hex = hsvToHex(...newHsv);
        setHexInput(hex);
        onChange(hex);
    }, [h, onChange]);

    const handleHuePointer = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (e.type === 'pointerdown') {
            e.currentTarget.setPointerCapture(e.pointerId);
            dragging.current = 'hue';
        }
        if (dragging.current !== 'hue') return;
        if (e.type === 'pointerup') { dragging.current = null; return; }
        const rect = e.currentTarget.getBoundingClientRect();
        const newH = Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * 360);
        const newHsv: [number, number, number] = [newH, s, v];
        setHsv(newHsv);
        const hex = hsvToHex(...newHsv);
        setHexInput(hex);
        onChange(hex);
    }, [s, v, onChange]);

    function handleHexInput(e: React.ChangeEvent<HTMLInputElement>) {
        const val = e.target.value;
        setHexInput(val);
        if (/^#[0-9a-fA-F]{6}$/.test(val)) {
            setHsv(hexToHsv(val));
            onChange(val);
        }
    }

    function handleSwatchClick(hex: string) {
        setHsv(hexToHsv(hex));
        setHexInput(hex);
        onChange(hex);
    }

    return (
        <div className='color-picker-popup'>
            <div className='color-picker-sv-wrapper'>
                <canvas
                    ref={svCanvas}
                    width={SIZE}
                    height={SIZE}
                    className='color-picker-sv'
                    onPointerDown={handleSvPointer}
                    onPointerMove={handleSvPointer}
                    onPointerUp={handleSvPointer}
                />
                <div
                    className='color-picker-cursor'
                    style={{ left: s * SIZE - 6, top: (1 - v) * SIZE - 6 }}
                />
            </div>
            <div
                className='color-picker-hue'
                onPointerDown={handleHuePointer}
                onPointerMove={handleHuePointer}
                onPointerUp={handleHuePointer}
            >
                <div
                    className='color-picker-hue-thumb'
                    style={{
                        left: `${(h / 360) * 100}%`,
                        backgroundColor: `hsl(${h}, 100%, 50%)`
                    }}
                />
            </div>
            <input
                className='color-picker-hex-input'
                type='text'
                value={hexInput}
                onChange={handleHexInput}
                maxLength={7}
                spellCheck={false}
            />
            <div className='color-picker-swatches'>
                {DEFAULT_SWATCHES.map(swatch => (
                    <button
                        key={swatch}
                        className='color-picker-swatch'
                        style={{ backgroundColor: swatch }}
                        onClick={() => handleSwatchClick(swatch)}
                        title={swatch}
                    />
                ))}
            </div>
        </div>
    );
}