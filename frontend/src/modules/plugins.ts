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

export interface FrontendPlugin {
    id: string;
    label: string;
    icon: ComponentType;
    view: ComponentType;
    sourceType?: string;
}

type Listener = (payload: any) => void;
type DOMHook = (el: Element) => void;

const pluginRegistry = new Map<string, FrontendPlugin>();
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

export function registerPluginUI(id: string, ui: { icon: ComponentType; view: ComponentType; sourceType?: string }) {
    if (!validatedPlugins.has(id)) {
        console.error(`[plugins] blocked: "${id}" has no valid package.json`);
        return;
    }
    pluginRegistry.set(id, { id, label: configs[`../plugins/${id}/package.json`]?.default.name ?? id, ...ui });
}

export function getPlugins(): FrontendPlugin[] {
    return [...pluginRegistry.values()];
}

export function getPlugin(id: string): FrontendPlugin | undefined {
    return pluginRegistry.get(id);
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

export function applyDOMHooks() {
    for (const [selector, hooks] of domHooks) {
        const dotIndex = selector.indexOf('.');
        const file = selector.slice(0, dotIndex);
        const cls = selector.slice(dotIndex + 1);
        const els = document.querySelectorAll(
            `[data-component="${file}"] .${cls}, [data-component="${file}"].${cls}`
        );
        els.forEach(el => hooks.forEach(fn => fn(el)));
    }
}