import type { ComponentType } from 'react';

export interface PluginConfig {
    id: string;
    name: string;
    author: string;
    version: string;
    description: string;
}

export interface PluginRoute {
    path: string;
    component: ComponentType;
}

export interface PluginTab {
    id: string;
    label: string;
    icon: ComponentType;
    view: ComponentType;
    sourceType?: string;
    url?: string;
}

type Listener = (payload: any) => void;
type DOMHook = (el: Element) => void;
type DOMHookEntry = { fn: DOMHook; pluginId: string };

const tabRegistry: PluginTab[] = [];
const eventBus = new Map<string, Set<Listener>>();
const domHooks = new Map<string, DOMHookEntry[]>();
const routeRegistry: PluginRoute[] = [];
const validatedPlugins = new Set<string>();
const registeredUrls = new Set<string>(['/settings']);

const configs = import.meta.glob('../plugins/*/package.json', { eager: true }) as Record<string, { default: PluginConfig }>;

function getFolderFromPath(path: string): string {
    return path.split('/').at(-2) ?? '';
}

function validateConfig(config: unknown, folder: string): config is PluginConfig {
    if (!config || typeof config !== 'object') {
        console.error(`[plugins] ${folder}: package.json is not a valid object`);
        return false;
    }

    const c = config as Record<string, unknown>;
    const required = ['id', 'name', 'author', 'version', 'description'];

    for (const key of required) {
        if (typeof c[key] !== 'string' || !(c[key] as string).trim()) {
            console.error(`[plugins] ${folder}: package.json missing or empty field "${key}"`);
            return false;
        }
    }

    const [, author] = folder.split('@');
    if (!author) {
        console.error(`[plugins] "${folder}": folder name must follow the pattern name@author`);
        return false;
    }

    if (c['author'] !== author) {
        console.error(`[plugins] ${folder}: package.json "author" ("${c['author']}") does not match folder author ("${author}")`);
        return false;
    }

    if (c['id'] !== folder) {
        console.error(`[plugins] ${folder}: package.json "id" ("${c['id']}") must match folder name ("${folder}")`);
        return false;
    }

    return true;
}

for (const [path, mod] of Object.entries(configs)) {
    const folder = getFolderFromPath(path);
    const config = mod.default;

    if (validateConfig(config, folder)) {
        validatedPlugins.add(folder);
        console.log(`[plugins] loaded: ${config.id} v${config.version} by ${config.author}`);
    }
}

let stylesInjected = false;

function injectPluginStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.id = '__plugin-styles';
    style.textContent = `
        [data-plugin-hooked] > :not(.__plugin-hook-wrapper):not([data-plugin-hooked]) {
            display: none !important;
        }
        #__plugin-error-container {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 99999;
            display: flex;
            flex-direction: column;
            gap: 2px;
            pointer-events: none;
        }
        .__plugin-error-banner {
            background: #c0392b;
            color: #fff;
            padding: 9px 14px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-family: monospace;
            font-size: 12px;
            gap: 12px;
            pointer-events: all;
        }
        .__plugin-error-close {
            background: none;
            border: none;
            color: #fff;
            cursor: pointer;
            font-size: 18px;
            line-height: 1;
            padding: 0;
            flex-shrink: 0;
            opacity: 0.8;
        }
        .__plugin-error-close:hover {
            opacity: 1;
        }
    `;
    document.head.appendChild(style);
}

function getErrorContainer(): HTMLElement {
    let container = document.querySelector<HTMLElement>('#__plugin-error-container');
    if (!container) {
        container = document.createElement('div');
        container.id = '__plugin-error-container';
        document.body.appendChild(container);
    }
    return container;
}

function showPluginError(pluginId: string, context: string, error: unknown) {
    injectPluginStyles();
    const message = error instanceof Error ? error.message : String(error);
    const banner = document.createElement('div');
    banner.className = '__plugin-error-banner';
    const text = document.createElement('span');
    text.textContent = `Plugin error [${pluginId}] — ${context}: ${message}`;
    const close = document.createElement('button');
    close.className = '__plugin-error-close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss');
    close.onclick = () => banner.remove();
    banner.appendChild(text);
    banner.appendChild(close);
    getErrorContainer().appendChild(banner);
    console.error(`[plugins] ${pluginId} — ${context}:`, error);
}

export function registerTab(
    id: string,
    tab: { icon: ComponentType; view: ComponentType; sourceType?: string; label?: string; url?: string }
) {
    if (!validatedPlugins.has(id)) {
        console.error(`[plugins] blocked: "${id}" has no valid package.json`);
        return;
    }

    if (tab.url !== undefined) {
        const normalised = tab.url.startsWith('/') ? tab.url : '/' + tab.url;
        if (registeredUrls.has(normalised)) {
            console.error(`[plugins] blocked: "${id}" tried to register url "${normalised}" which is already taken`);
            return;
        }
        registeredUrls.add(normalised);
        tab = { ...tab, url: normalised };
    }

    const label = tab.label ?? configs[`../plugins/${id}/package.json`]?.default.name ?? id;
    tabRegistry.push({ id, label, ...tab });
}

export function getTabs(): PluginTab[] {
    return [...tabRegistry];
}

export function getTab(id: string): PluginTab | undefined {
    return tabRegistry.find(t => t.id === id);
}

export function getTabByUrl(url: string): PluginTab | undefined {
    return tabRegistry.find(t => t.url === url);
}

export function registerRoute(route: PluginRoute) {
    routeRegistry.push(route);
}

export function getRoutes(): PluginRoute[] {
    return routeRegistry;
}

export function emit(event: string, payload?: any) {
    eventBus.get(event)?.forEach(fn => fn(payload));
}

export function on(event: string, listener: Listener) {
    if (!eventBus.has(event)) eventBus.set(event, new Set());
    eventBus.get(event)!.add(listener);
    return () => eventBus.get(event)?.delete(listener);
}

export function modify(pluginId: string, selector: string, fn: DOMHook) {
    if (!validatedPlugins.has(pluginId)) {
        console.error(`[plugins] modify blocked: "${pluginId}" has no valid package.json`);
        return;
    }
    if (!domHooks.has(selector)) domHooks.set(selector, []);
    domHooks.get(selector)!.push({ fn, pluginId });
}

function applyDOMHooks() {
    injectPluginStyles();
    for (const [selector, hooks] of domHooks) {
        const dotIndex = selector.indexOf('.');
        const file = selector.slice(0, dotIndex);
        const cls = selector.slice(dotIndex + 1);
        const els = document.querySelectorAll(
            `[data-component="${file}"] .${cls}, [data-component="${file}"].${cls}`
        );
        els.forEach(el => {
            if (el.hasAttribute('data-hooks-applied')) return;
            el.setAttribute('data-hooks-applied', '');
            hooks.forEach(({ fn, pluginId }) => {
                try {
                    fn(el);
                } catch (err) {
                    showPluginError(pluginId, `DOM hook on "${selector}"`, err);
                }
            });
        });
    }
}

let observer: MutationObserver | null = null;

export function startDOMHookObserver() {
    if (observer) return;
    applyDOMHooks();
    observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            mutation.removedNodes.forEach(node => {
                if (!(node instanceof Element)) return;
                node.querySelectorAll('[data-hooks-applied]').forEach(el => {
                    el.removeAttribute('data-hooks-applied');
                    el.removeAttribute('data-plugin-hooked');
                });
                if (node.hasAttribute('data-hooks-applied')) {
                    node.removeAttribute('data-hooks-applied');
                    node.removeAttribute('data-plugin-hooked');
                }
            });
        }
        applyDOMHooks();
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

export function stopDOMHookObserver() {
    observer?.disconnect();
    observer = null;
}