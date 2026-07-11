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

export interface PluginMenuItem {
    id: string;
    icon: ComponentType;
    view?: ComponentType | null;
    label?: string;
    function?: () => void;
    needsInteraction?: boolean;
    adminOnly?: boolean;
}

type Listener = (payload: any) => void;
type DOMHook = (el: Element) => void;
type DOMHookEntry = { fn: DOMHook; pluginId: string };

interface PluginSdkSharedState {
    tabRegistry: PluginTab[];
    menuRegistry: PluginMenuItem[];
    eventBus: Map<string, Set<Listener>>;
    domHooks: Map<string, DOMHookEntry[]>;
    routeRegistry: PluginRoute[];
    validatedPlugins: Set<string>;
    registeredUrls: Set<string>;
    observer: MutationObserver | null;
    stylesInjected: boolean;
    pluginLoadListeners: Array<() => void>;
    appliedDomHooks: WeakMap<Element, Set<string>>;
}

const PLUGIN_SDK_STATE_KEY = Symbol.for('omniplayr.plugin-sdk.state');

const globalPluginSdk = globalThis as typeof globalThis & {
    [PLUGIN_SDK_STATE_KEY]?: PluginSdkSharedState;
};

const createPluginSdkSharedState = (): PluginSdkSharedState => ({
    tabRegistry: [],
    menuRegistry: [],
    eventBus: new Map<string, Set<Listener>>(),
    domHooks: new Map<string, DOMHookEntry[]>(),
    routeRegistry: [],
    validatedPlugins: new Set<string>(),
    registeredUrls: new Set<string>(['/settings']),
    observer: null,
    stylesInjected: false,
    pluginLoadListeners: [],
    appliedDomHooks: new WeakMap<Element, Set<string>>(),
});

const sharedState: PluginSdkSharedState =
    globalPluginSdk[PLUGIN_SDK_STATE_KEY] ??= createPluginSdkSharedState();

const {
    tabRegistry,
    menuRegistry,
    eventBus,
    domHooks,
    routeRegistry,
    validatedPlugins,
    registeredUrls,
} = sharedState;

const installedConfigs = import.meta.glob('../plugins/*/package.json', { eager: true }) as Record<string, { default: PluginConfig }>;
const localConfigs = import.meta.env.DEV
    ? import.meta.glob([
        '../local-plugins/*/package.json',
        '../local-plugins/package.json',
    ], { eager: true }) as Record<string, { default: PluginConfig }>
    : {};
const installedPluginIds = new Set(
    Object.values(installedConfigs)
        .map(module => module.default?.id)
        .filter((id): id is string => !!id)
);

const filteredLocalConfigs = Object.fromEntries(
    Object.entries(localConfigs).filter(([, module]) =>
        !installedPluginIds.has(module.default?.id)
    )
);

const configs = {
    ...installedConfigs,
    ...filteredLocalConfigs,
};

function getFolderFromPath(path: string): string {
    if (path.endsWith('/local-plugins/package.json')) {
        return '';
    }
    return path.split('/').at(-2) ?? '';
}

function validateConfig(config: unknown, folder: string): config is PluginConfig {
    if (!config || typeof config !== 'object') {
        console.error(`[plugins] ${folder}: package.json is not a valid object`);
        return false;
    }

    const c = config as Record<string, unknown>;
    if (!folder) {
        folder = String(c['id'] ?? '');
    }
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
    const folder = getFolderFromPath(path) || mod.default.id;
    const config = mod.default;

    if (validateConfig(config, folder)) {
        validatedPlugins.add(folder);
        console.log(`[plugins] loaded: ${config.id} v${config.version} by ${config.author}`);
    }
}

function injectPluginStyles() {
    if (sharedState.stylesInjected) return;
    sharedState.stylesInjected = true;
    const style = document.createElement('style');
    style.id = '__plugin-styles';
    style.textContent = `
        @layer plugin {
            [data-plugin-hooked] > :not(.__plugin-hook-wrapper):not([data-plugin-hooked]) {
                display: none !important;
            }
            .dashboard-hor > :not(.__plugin-hook-wrapper):not([data-plugin-hooked]) {
                display: revert-layer !important;
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
    text.textContent = `Plugin error [${pluginId}] - ${context}: ${message}`;
    const close = document.createElement('button');
    close.className = '__plugin-error-close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss');
    close.onclick = () => banner.remove();
    banner.appendChild(text);
    banner.appendChild(close);
    getErrorContainer().appendChild(banner);
    console.error(`[plugins] ${pluginId} - ${context}:`, error);
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
        const existingUrl = tabRegistry.find(existing => existing.id === id && existing.url === normalised);
        if (registeredUrls.has(normalised) && !existingUrl) {
            console.error(`[plugins] blocked: "${id}" tried to register url "${normalised}" which is already taken`);
            return;
        }
        registeredUrls.add(normalised);
        tab = { ...tab, url: normalised };
    }

    const label = tab.label ?? getPluginConfig(id)?.name ?? id;
    const existingIndex = tabRegistry.findIndex(existing =>
        existing.id === id && (tab.url ? existing.url === tab.url : existing.label === label)
    );
    const next = { id, label, ...tab };
    if (existingIndex === -1) {
        tabRegistry.push(next);
    } else {
        tabRegistry[existingIndex] = next;
    }
}

export function registerPluginsMenuItem(
    id: string,
    menuItem: { icon: ComponentType; view?: ComponentType | null; label?: string; function?: () => void; needsInteraction?: boolean; adminOnly?: boolean }
) {
    if (!validatedPlugins.has(id)) {
        console.error(`[plugins] blocked: "${id}" has no valid package.json`);
        return;
    }

    if (!menuItem.view && !menuItem.function) {
        console.error(`[plugins] blocked: "${id}" menu item must have either a view or a function`);
        return;
    }

    const label = menuItem.label ?? getPluginConfig(id)?.name ?? id;

    const next = {
        id,
        label,
        ...menuItem
    };
    const existingIndex = menuRegistry.findIndex(item => item.id === id && item.label === label);
    if (existingIndex === -1) {
        menuRegistry.push(next);
    } else {
        menuRegistry[existingIndex] = next;
    }
}

export function getPluginsMenuItems(): PluginMenuItem[] {
    return [...menuRegistry];
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
    const existingIndex = routeRegistry.findIndex(existing => existing.path === route.path);
    if (existingIndex === -1) {
        routeRegistry.push(route);
    } else {
        routeRegistry[existingIndex] = route;
    }
}

export function getRoutes(): PluginRoute[] {
    return routeRegistry;
}

export function emit(event: string, payload?: any) {
    const listeners = eventBus.get(event);
    listeners?.forEach(fn => fn(payload));
}

export function on(event: string, listener: Listener) {
    if (!eventBus.has(event)) {
        eventBus.set(event, new Set());
    }

    eventBus.get(event)!.add(listener);

    return () => {
        eventBus.get(event)?.delete(listener);
    };
}

export function modify(pluginId: string, selector: string, fn: DOMHook) {
    if (!validatedPlugins.has(pluginId)) {
        console.error(`[plugins] modify blocked: "${pluginId}" has no valid package.json`);
        return;
    }

    if (!domHooks.has(selector)) {
        domHooks.set(selector, []);
    }

    const hooks = domHooks.get(selector)!;
    const existingIndex = hooks.findIndex(hook => hook.pluginId === pluginId);

    if (existingIndex === -1) {
        hooks.push({ fn, pluginId });
    } else {
        hooks[existingIndex] = { fn, pluginId };
    }

    const dotIndex = selector.indexOf('.');
    const file = selector.slice(0, dotIndex);
    const cls = selector.slice(dotIndex + 1);
    const hookKey = `${selector}:${pluginId}`;

    document.querySelectorAll(
        `[data-component="${file}"] .${cls}, [data-component="${file}"].${cls}`
    ).forEach(el => {
        sharedState.appliedDomHooks.get(el)?.delete(hookKey);
    });

    applyDOMHooks();
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
            let appliedHooks = sharedState.appliedDomHooks.get(el);

            if (!appliedHooks) {
                appliedHooks = new Set<string>();
                sharedState.appliedDomHooks.set(el, appliedHooks);
            }

            hooks.forEach(({ fn, pluginId }) => {
                const hookKey = `${selector}:${pluginId}`;

                if (appliedHooks.has(hookKey)) return;

                appliedHooks.add(hookKey);

                try {
                    fn(el);
                } catch (err) {
                    appliedHooks.delete(hookKey);
                    showPluginError(pluginId, `DOM hook on "${selector}"`, err);
                }
            });
        });
    }
}

export function startDOMHookObserver() {
    if (sharedState.observer) return;

    applyDOMHooks();

    sharedState.observer = new MutationObserver(() => {
        applyDOMHooks();
    });

    sharedState.observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
}

export function stopDOMHookObserver() {
    sharedState.observer?.disconnect();
    sharedState.observer = null;
}

export function onPluginsLoaded(fn: () => void): () => void {
    sharedState.pluginLoadListeners.push(fn);

    return () => {
        const index = sharedState.pluginLoadListeners.indexOf(fn);

        if (index !== -1) {
            sharedState.pluginLoadListeners.splice(index, 1);
        }
    };
}

export function notifyPluginsLoaded(): void {
    sharedState.pluginLoadListeners.forEach(fn => fn());
}

export function hasFrontendPlugin(id: string): boolean {
  return validatedPlugins.has(id);
}

function getPluginConfig(id: string): PluginConfig | undefined {
    for (const mod of Object.values(configs)) {
        if (mod.default?.id === id) return mod.default;
    }
    return undefined;
}
