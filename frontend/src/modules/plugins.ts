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
}

type Listener = (payload: any) => void;
type DOMHook = (el: Element) => void;

const tabRegistry: PluginTab[] = [];
const eventBus = new Map<string, Set<Listener>>();
const domHooks = new Map<string, DOMHook[]>();
const routeRegistry: PluginRoute[] = [];
const validatedPlugins = new Set<string>();

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

export function registerTab(
    id: string,
    tab: { icon: ComponentType; view: ComponentType; sourceType?: string; label?: string }
) {
    if (!validatedPlugins.has(id)) {
        console.error(`[plugins] blocked: "${id}" has no valid package.json`);
        return;
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
    domHooks.get(selector)!.push(fn);
}

function applyDOMHooks() {
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

            const wrapper = document.createElement('span');
            wrapper.className = '__plugin-hook-wrapper';
            wrapper.textContent = el.textContent;

            const reactContent = document.createElement('span');
            (reactContent as HTMLElement).style.display = 'none';
            (el as HTMLElement).style.display = 'contents';

            while (el.childNodes.length > 0) {
                reactContent.appendChild(el.childNodes[0]);
            }
            el.appendChild(reactContent);
            el.appendChild(wrapper);

            hooks.forEach(fn => fn(wrapper));
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
                });
                if (node.hasAttribute('data-hooks-applied')) {
                    node.removeAttribute('data-hooks-applied');
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