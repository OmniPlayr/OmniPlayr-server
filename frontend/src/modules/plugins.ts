import { Component, createElement, type ComponentType, type ReactNode } from 'react';

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
    pluginId?: string;
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

export interface Infobar {
    id: string;
    barId: string;
    view: ComponentType;
}

type Listener = (payload: any) => void;
export type PluginErrorRecord = {
    pluginId: string;
    context: string;
    message: string;
    timestamp: number;
    stack?: string;
};
type PluginErrorListener = (error: PluginErrorRecord) => void;
type PluginLoadListenerEntry = { fn: () => void; pluginId?: string };
type DOMHookPosition = 'start' | 'middle' | 'end' | number;
type DOMHookOptions = {
    position?: DOMHookPosition;
    mount?: boolean;
};
type DOMHook = (el: Element, mount?: HTMLElement) => void;
type DOMHookEntry = {
    fn: DOMHook;
    pluginId: string;
    position: DOMHookPosition;
    useMount: boolean;
};

interface PluginSdkSharedState {
    tabRegistry: PluginTab[];
    infoBarRegistry: Infobar[];
    menuRegistry: PluginMenuItem[];
    eventBus: Map<string, Set<Listener>>;
    domHooks: Map<string, DOMHookEntry[]>;
    routeRegistry: PluginRoute[];
    validatedPlugins: Set<string>;
    registeredUrls: Set<string>;
    observer: MutationObserver | null;
    observerVersion?: number;
    refreshDOMHookObserverTargets?: () => void;
    stylesInjected: boolean;
    pluginLoadListeners: PluginLoadListenerEntry[];
    appliedDomHooks: WeakMap<Element, Set<string>>;
    failedPlugins: Set<string>;
    pluginErrors: PluginErrorRecord[];
    pluginErrorListeners: Set<PluginErrorListener>;
}

const PLUGIN_SDK_STATE_KEY = Symbol.for('omniplayr.plugin-sdk.state');

const globalPluginSdk = globalThis as typeof globalThis & {
    [PLUGIN_SDK_STATE_KEY]?: PluginSdkSharedState;
};

const createPluginSdkSharedState = (): PluginSdkSharedState => ({
    tabRegistry: [],
    infoBarRegistry: [],
    menuRegistry: [],
    eventBus: new Map<string, Set<Listener>>(),
    domHooks: new Map<string, DOMHookEntry[]>(),
    routeRegistry: [],
    validatedPlugins: new Set<string>(),
    registeredUrls: new Set<string>(['/settings']),
    observer: null,
    observerVersion: 0,
    stylesInjected: false,
    pluginLoadListeners: [],
    appliedDomHooks: new WeakMap<Element, Set<string>>(),
    failedPlugins: new Set<string>(),
    pluginErrors: [],
    pluginErrorListeners: new Set<PluginErrorListener>(),
});

const sharedState: PluginSdkSharedState =
    globalPluginSdk[PLUGIN_SDK_STATE_KEY] ??= createPluginSdkSharedState();

sharedState.failedPlugins ??= new Set<string>();
sharedState.pluginErrors ??= [];
sharedState.pluginErrorListeners ??= new Set<PluginErrorListener>();
sharedState.pluginLoadListeners = (sharedState.pluginLoadListeners as unknown[]).map(entry =>
    typeof entry === 'function' ? { fn: entry as () => void } : entry as PluginLoadListenerEntry
);

const {
    tabRegistry,
    infoBarRegistry,
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
                background: #9a6700;
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

function isPluginEnabled(pluginId: string): boolean {
    return validatedPlugins.has(pluginId) && !sharedState.failedPlugins.has(pluginId);
}

function showPluginError(record: PluginErrorRecord) {
    if (typeof document === 'undefined' || !document.body) return;

    try {
        injectPluginStyles();
        const banner = document.createElement('div');
        banner.className = '__plugin-error-banner';
        banner.setAttribute('role', 'alert');
        const text = document.createElement('span');
        text.textContent = `Plugin disabled: ${record.pluginId} — ${record.context}: ${record.message}`;
        const close = document.createElement('button');
        close.className = '__plugin-error-close';
        close.textContent = '×';
        close.setAttribute('aria-label', 'Dismiss');
        close.onclick = () => banner.remove();
        banner.appendChild(text);
        banner.appendChild(close);
        getErrorContainer().appendChild(banner);
    } catch (uiError) {
        console.warn('[plugins] Could not display the plugin warning banner:', uiError);
    }
}

function disablePlugin(pluginId: string, context: string, error: unknown) {
    if (sharedState.failedPlugins.has(pluginId)) return;

    sharedState.failedPlugins.add(pluginId);

    const message = error instanceof Error ? error.message : String(error);
    const record: PluginErrorRecord = {
        pluginId,
        context,
        message,
        timestamp: Date.now(),
        stack: error instanceof Error ? error.stack : undefined,
    };

    sharedState.pluginErrors.push(record);
    console.warn(`[plugins] Disabled plugin "${pluginId}" after an error in ${context}. Its SDK registrations have been removed.`, error);
    showPluginError(record);

    for (const [selector, hooks] of domHooks) {
        const remaining = hooks.filter(hook => hook.pluginId !== pluginId);
        if (remaining.length) {
            domHooks.set(selector, remaining);
        } else {
            domHooks.delete(selector);
        }
    }

    for (let index = tabRegistry.length - 1; index >= 0; index -= 1) {
        if (tabRegistry[index].id === pluginId) tabRegistry.splice(index, 1);
    }

    for (let index = menuRegistry.length - 1; index >= 0; index -= 1) {
        if (menuRegistry[index].id === pluginId) menuRegistry.splice(index, 1);
    }

    for (let index = routeRegistry.length - 1; index >= 0; index -= 1) {
        if (routeRegistry[index].pluginId === pluginId) routeRegistry.splice(index, 1);
    }

    for (let index = sharedState.pluginLoadListeners.length - 1; index >= 0; index -= 1) {
        if (sharedState.pluginLoadListeners[index].pluginId === pluginId) {
            sharedState.pluginLoadListeners.splice(index, 1);
        }
    }

    for (const url of [...registeredUrls]) {
        const stillRegistered = tabRegistry.some(tab => tab.url === url);
        if (!stillRegistered && url !== '/settings') registeredUrls.delete(url);
    }

    if (typeof document !== 'undefined') {
        document.querySelectorAll<HTMLElement>('[data-plugin-owner], [data-plugin-mount]').forEach(element => {
            const owner = element.getAttribute('data-plugin-owner');
            const mountKey = element.getAttribute('data-plugin-mount') ?? '';
            if (owner === pluginId || mountKey.endsWith(`:${pluginId}`)) element.remove();
        });
    }

    sharedState.refreshDOMHookObserverTargets?.();

    for (const listener of sharedState.pluginErrorListeners) {
        try {
            listener(record);
        } catch (listenerError) {
            console.warn('[plugins] An error listener failed while handling a plugin warning:', listenerError);
        }
    }

    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
        window.dispatchEvent(new CustomEvent<PluginErrorRecord>('omniplayr:plugin-error', { detail: record }));
    }
}

class PluginErrorBoundary extends Component<{
    pluginId: string;
    context: string;
    children?: ReactNode;
}, { hasError: boolean }> {
    state = { hasError: false };

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error: Error) {
        disablePlugin(this.props.pluginId, this.props.context, error);
    }

    render() {
        if (this.state.hasError || !isPluginEnabled(this.props.pluginId)) return null;
        return this.props.children ?? null;
    }
}

function protectPluginComponent(pluginId: string, context: string, ComponentToProtect: ComponentType<any>): ComponentType<any> {
    return function ProtectedPluginComponent(props: any) {
        return createElement(
            PluginErrorBoundary,
            { pluginId, context },
            createElement(ComponentToProtect, props)
        );
    };
}

export function withPluginErrorBoundary(pluginId: string, context: string, component: ComponentType<any>): ComponentType<any> {
    return protectPluginComponent(pluginId, context, component);
}

export function getPluginErrors(): PluginErrorRecord[] {
    return [...sharedState.pluginErrors];
}

export function onPluginError(listener: PluginErrorListener): () => void {
    sharedState.pluginErrorListeners.add(listener);
    return () => sharedState.pluginErrorListeners.delete(listener);
}

export function isPluginDisabled(pluginId: string): boolean {
    return sharedState.failedPlugins.has(pluginId);
}

export function reportPluginFailure(pluginId: string, context: string, error: unknown): void {
    disablePlugin(pluginId, context, error);
}

export async function loadPlugin<T>(pluginId: string, loader: () => Promise<T>): Promise<T | null> {
    if (!isPluginEnabled(pluginId)) return null;

    try {
        return await loader();
    } catch (error) {
        disablePlugin(pluginId, 'plugin initialization', error);
        return null;
    }
}

export function registerTab(
    id: string,
    tab: { icon: ComponentType; view: ComponentType; sourceType?: string; label?: string; url?: string }
) {
    if (!isPluginEnabled(id)) {
        console.warn(`[plugins] blocked: "${id}" is not enabled or has been disabled`);
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
    const next = {
        id,
        label,
        ...tab,
        icon: protectPluginComponent(id, `tab icon (${label})`, tab.icon),
        view: protectPluginComponent(id, `tab view (${label})`, tab.view),
    };
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
    if (!isPluginEnabled(id)) {
        console.warn(`[plugins] blocked: "${id}" is not enabled or has been disabled`);
        return;
    }

    if (!menuItem.view && !menuItem.function) {
        console.error(`[plugins] blocked: "${id}" menu item must have either a view or a function`);
        return;
    }

    const label = menuItem.label ?? getPluginConfig(id)?.name ?? id;

    const next: PluginMenuItem = {
        id,
        label,
        ...menuItem,
        icon: protectPluginComponent(id, `menu icon (${label})`, menuItem.icon),
        view: menuItem.view
            ? protectPluginComponent(id, `menu view (${label})`, menuItem.view)
            : menuItem.view,
        function: menuItem.function
            ? () => {
                if (!isPluginEnabled(id)) return;
                try {
                    menuItem.function?.();
                } catch (error) {
                    disablePlugin(id, `menu action (${label})`, error);
                }
            }
            : undefined,
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

export function registerRoute(route: PluginRoute, pluginId?: string) {
    const owner = pluginId ?? route.pluginId;
    if (owner && !isPluginEnabled(owner)) return;

    const nextRoute = owner
        ? {
            ...route,
            pluginId: owner,
            component: protectPluginComponent(owner, `route (${route.path})`, route.component),
        }
        : route;

    const existingIndex = routeRegistry.findIndex(existing => existing.path === route.path);
    if (existingIndex === -1) {
        routeRegistry.push(nextRoute);
    } else {
        routeRegistry[existingIndex] = nextRoute;
    }
}

export function getRoutes(): PluginRoute[] {
    return routeRegistry;
}

export function emit(event: string, payload?: any) {
    const listeners = eventBus.get(event);
    listeners?.forEach(listener => {
        try {
            listener(payload);
        } catch (error) {
            console.warn(`[plugins] An event listener for "${event}" failed:`, error);
        }
    });
}

export function on(event: string, listener: Listener, pluginId?: string) {
    if (pluginId && !isPluginEnabled(pluginId)) return () => undefined;

    if (!eventBus.has(event)) {
        eventBus.set(event, new Set());
    }

    const guardedListener: Listener = payload => {
        if (pluginId && !isPluginEnabled(pluginId)) return;
        try {
            listener(payload);
        } catch (error) {
            if (pluginId) {
                disablePlugin(pluginId, `event listener (${event})`, error);
            } else {
                console.warn(`[plugins] An event listener for "${event}" failed:`, error);
            }
        }
    };

    eventBus.get(event)!.add(guardedListener);

    return () => {
        eventBus.get(event)?.delete(guardedListener);
    };
}

function getDOMHookPositionValue(position: DOMHookPosition): number {
    if (typeof position === 'number') {
        return Number.isFinite(position) ? position : 0;
    }

    if (position === 'start') return Number.NEGATIVE_INFINITY;
    if (position === 'end') return Number.POSITIVE_INFINITY;
    return 0;
}

function compareDOMHookEntries(a: DOMHookEntry, b: DOMHookEntry): number {
    const aPosition = getDOMHookPositionValue(a.position);
    const bPosition = getDOMHookPositionValue(b.position);

    if (aPosition < bPosition) return -1;
    if (aPosition > bPosition) return 1;

    const aId = a.pluginId.toLowerCase();
    const bId = b.pluginId.toLowerCase();

    if (aId < bId) return -1;
    if (aId > bId) return 1;

    return 0;
}

function getPluginMount(
    el: Element,
    selector: string,
    pluginId: string,
    position: DOMHookPosition
): { mount: HTMLElement; created: boolean } {
    const mountKey = `${selector}:${pluginId}`;
    let mount = Array.from(el.children).find(
        child => child.getAttribute('data-plugin-mount') === mountKey
    ) as HTMLElement | undefined;
    const created = !mount;

    if (!mount) {
        mount = document.createElement('div');
        mount.className = '__plugin-hook-wrapper';
        mount.setAttribute('data-plugin-mount', mountKey);
        el.appendChild(mount);
    }

    mount.setAttribute('data-plugin-owner', pluginId);
    mount.setAttribute('data-plugin-position', String(getDOMHookPositionValue(position)));

    return { mount, created };
}

function reorderPluginMounts(el: Element) {
    const currentChildren = Array.from(el.children);
    const nonPluginChildren = currentChildren.filter(
        child => !child.hasAttribute('data-plugin-mount')
    );
    const mounts = currentChildren.filter(
        child => child.hasAttribute('data-plugin-mount')
    );

    mounts.sort((a, b) => {
        const aPosition = Number(a.getAttribute('data-plugin-position') ?? 0);
        const bPosition = Number(b.getAttribute('data-plugin-position') ?? 0);

        if (aPosition < bPosition) return -1;
        if (aPosition > bPosition) return 1;

        const aOwner = (a.getAttribute('data-plugin-owner') ?? '').toLowerCase();
        const bOwner = (b.getAttribute('data-plugin-owner') ?? '').toLowerCase();

        if (aOwner < bOwner) return -1;
        if (aOwner > bOwner) return 1;

        const aKey = a.getAttribute('data-plugin-mount') ?? '';
        const bKey = b.getAttribute('data-plugin-mount') ?? '';

        if (aKey < bKey) return -1;
        if (aKey > bKey) return 1;

        return 0;
    });

    const expectedChildren = [...nonPluginChildren, ...mounts];
    const alreadyOrdered = currentChildren.length === expectedChildren.length
        && currentChildren.every((child, index) => child === expectedChildren[index]);

    if (alreadyOrdered) return;

    const fragment = document.createDocumentFragment();
    mounts.forEach(mount => fragment.appendChild(mount));
    el.appendChild(fragment);
}

export function modify(
    pluginId: string,
    selector: string,
    fn: DOMHook,
    options: DOMHookOptions = {}
) {
    if (!isPluginEnabled(pluginId)) {
        console.warn(`[plugins] modify blocked: "${pluginId}" is not enabled or has been disabled`);
        return;
    }

    if (!domHooks.has(selector)) {
        domHooks.set(selector, []);
    }

    const hooks = domHooks.get(selector)!;
    const existingIndex = hooks.findIndex(hook => hook.pluginId === pluginId);
    const nextHook: DOMHookEntry = {
        fn,
        pluginId,
        position: options.position ?? 'middle',
        useMount: options.mount ?? true,
    };

    if (existingIndex === -1) {
        hooks.push(nextHook);
    } else {
        hooks[existingIndex] = nextHook;
    }

    const dotIndex = selector.indexOf('.');
    const file = selector.slice(0, dotIndex);
    const cls = selector.slice(dotIndex + 1);
    const hookKey = `${selector}:${pluginId}`;

    try {
        document.querySelectorAll(
            `[data-component="${file}"] .${cls}, [data-component="${file}"].${cls}`
        ).forEach(el => {
            sharedState.appliedDomHooks.get(el)?.delete(hookKey);
        });

        applyDOMHooks();
        sharedState.refreshDOMHookObserverTargets?.();
    } catch (error) {
        disablePlugin(pluginId, `DOM hook registration (${selector})`, error);
    }
}

function applyDOMHooksToElement(el: Element, selector: string, hooks: DOMHookEntry[]) {
    let appliedHooks = sharedState.appliedDomHooks.get(el);

    if (!appliedHooks) {
        appliedHooks = new Set<string>();
        sharedState.appliedDomHooks.set(el, appliedHooks);
    }

    const orderedHooks = [...hooks].sort(compareDOMHookEntries);

    for (const { fn, pluginId, position, useMount } of orderedHooks) {
        if (!isPluginEnabled(pluginId)) continue;

        const hookKey = `${selector}:${pluginId}`;

        try {
            const mountResult = useMount
                ? getPluginMount(el, selector, pluginId, position)
                : undefined;
            const mount = mountResult?.mount;

            if (mountResult?.created) {
                appliedHooks.delete(hookKey);
            }

            if (!useMount) {
                const existingMount = Array.from(el.children).find(
                    child => child.getAttribute('data-plugin-mount') === hookKey
                );
                existingMount?.remove();
            }

            if (appliedHooks.has(hookKey)) continue;

            appliedHooks.add(hookKey);
            fn(el, mount);
        } catch (error) {
            appliedHooks.delete(hookKey);
            disablePlugin(pluginId, `DOM hook on "${selector}"`, error);
        }
    }

    try {
        reorderPluginMounts(el);
    } catch (error) {
        console.warn(`[plugins] Could not order plugin mounts for "${selector}":`, error);
    }
}

function applyDOMHooks() {
    injectPluginStyles();

    for (const [selector, hooks] of domHooks) {
        const activeHooks = hooks.filter(hook => isPluginEnabled(hook.pluginId));
        if (!activeHooks.length) continue;

        let elements: NodeListOf<Element>;

        try {
            const { targetSelector } = getDOMHookSelectors(selector);
            elements = document.querySelectorAll(targetSelector);
        } catch (error) {
            activeHooks.forEach(hook => {
                disablePlugin(hook.pluginId, `invalid DOM hook selector "${selector}"`, error);
            });
            continue;
        }

        elements.forEach(el => {
            if (el.closest('[data-plugin-mount]')) return;
            applyDOMHooksToElement(el, selector, activeHooks);
        });
    }
}

function getDOMHookSelectors(selector: string) {
    const dotIndex = selector.indexOf('.');
    const file = selector.slice(0, dotIndex);
    const cls = selector.slice(dotIndex + 1);

    return {
        componentSelector: `[data-component="${file}"]`,
        targetSelector: `[data-component="${file}"] .${cls}, [data-component="${file}"].${cls}`,
    };
}

function getMatchingElementsInNode(node: Element, selector: string): Element[] {
    const { targetSelector } = getDOMHookSelectors(selector);
    const matches: Element[] = [];

    if (node.matches(targetSelector)) {
        matches.push(node);
    }

    node.querySelectorAll(targetSelector).forEach(match => matches.push(match));

    return matches;
}

function applyDOMHooksToAddedNode(node: Element): boolean {
    let relevant = false;

    for (const [selector, hooks] of domHooks) {
        const activeHooks = hooks.filter(hook => isPluginEnabled(hook.pluginId));
        if (!activeHooks.length) continue;

        try {
            const { componentSelector } = getDOMHookSelectors(selector);
            const containsComponentRoot = node.matches(componentSelector)
                || (!node.closest('[data-component]') && node.querySelector(componentSelector) !== null);
            const matches = getMatchingElementsInNode(node, selector);

            if (containsComponentRoot || matches.length > 0) {
                relevant = true;
            }

            matches.forEach(el => {
                if (el.closest('[data-plugin-mount]')) return;
                applyDOMHooksToElement(el, selector, activeHooks);
            });
        } catch (error) {
            activeHooks.forEach(hook => {
                disablePlugin(hook.pluginId, `DOM hook matching for "${selector}"`, error);
            });
        }
    }

    return relevant;
}

function collectDOMHookObserverTargets(): Set<Element> {
    const targets = new Set<Element>();

    const add = (element: Element | null) => {
        if (!element) return;
        targets.add(element);
    };

    add(document.body);

    const addAncestorChain = (element: Element | null) => {
        let current = element;

        while (current) {
            add(current);
            if (current === document.body) break;
            current = current.parentElement;
        }
    };

    for (const [selector, hooks] of domHooks) {
        const activeHooks = hooks.filter(hook => isPluginEnabled(hook.pluginId));
        if (!activeHooks.length) continue;

        try {
            const { componentSelector, targetSelector } = getDOMHookSelectors(selector);
            const components = document.querySelectorAll(componentSelector);
            const allMatches = document.querySelectorAll(targetSelector);

            components.forEach(component => {
                addAncestorChain(component);
            });

            allMatches.forEach(target => {
                add(target);
                addAncestorChain(target.parentElement ?? target);
            });
        } catch (error) {
            activeHooks.forEach(hook => {
                disablePlugin(hook.pluginId, `DOM hook observer target setup for "${selector}"`, error);
            });
        }
    }

    return targets;
}

function isDOMHookTargetElement(element: Element, selector: string): boolean {
    const { targetSelector } = getDOMHookSelectors(selector);
    return element.matches(targetSelector);
}

const DOM_HOOK_OBSERVER_VERSION = 5;

export function startDOMHookObserver() {
    if (sharedState.observer && sharedState.observerVersion === DOM_HOOK_OBSERVER_VERSION) return;

    sharedState.observer?.disconnect();
    sharedState.observer = null;
    sharedState.observerVersion = DOM_HOOK_OBSERVER_VERSION;

    applyDOMHooks();

    let observedTargets = new Set<Element>();
    const observer = new MutationObserver(records => {
        const addedNodes = new Set<Element>();
        let shouldRefreshTargets = false;

        records.forEach(record => {
            const mutationTarget = record.target instanceof Element ? record.target : null;

            if (mutationTarget) {
                for (const removedNode of record.removedNodes) {
                    if (!(removedNode instanceof Element)) continue;

                    if (observedTargets.has(removedNode) && !removedNode.isConnected) {
                        shouldRefreshTargets = true;
                    }

                    if (!removedNode.hasAttribute('data-plugin-mount')) continue;
                    if (removedNode.parentNode === mutationTarget) continue;

                    for (const [selector, hooks] of domHooks) {
                        if (isDOMHookTargetElement(mutationTarget, selector)) {
                            applyDOMHooksToElement(mutationTarget, selector, hooks);
                        }
                    }
                }

                const isHookTarget = Array.from(domHooks.keys()).some(selector =>
                    isDOMHookTargetElement(mutationTarget, selector)
                );

                if (isHookTarget) return;
            }

            record.addedNodes.forEach(node => {
                if (!(node instanceof Element)) return;
                if (node.hasAttribute('data-plugin-mount')) return;
                if (node.closest('[data-plugin-mount]')) return;
                addedNodes.add(node);
            });
        });

        addedNodes.forEach(node => {
            if (applyDOMHooksToAddedNode(node)) {
                shouldRefreshTargets = true;
            }
        });

        if (shouldRefreshTargets) {
            refreshObserverTargets();
        }
    });

    const refreshObserverTargets = () => {
        const nextTargets = collectDOMHookObserverTargets();
        const unchanged = nextTargets.size === observedTargets.size
            && Array.from(nextTargets).every(element => observedTargets.has(element));

        if (unchanged) return;

        observer.disconnect();
        observedTargets = nextTargets;

        observedTargets.forEach(element => {
            observer.observe(element, { childList: true });
        });
    };

    sharedState.observer = observer;
    sharedState.refreshDOMHookObserverTargets = refreshObserverTargets;
    observedTargets = collectDOMHookObserverTargets();

    observedTargets.forEach(element => {
        observer.observe(element, { childList: true });
    });
}
export function stopDOMHookObserver() {
    sharedState.observer?.disconnect();
    sharedState.observer = null;
    sharedState.observerVersion = 0;
    sharedState.refreshDOMHookObserverTargets = undefined;
}

export function onPluginsLoaded(fn: () => void, pluginId?: string): () => void {
    if (pluginId && !isPluginEnabled(pluginId)) return () => undefined;

    const entry: PluginLoadListenerEntry = { fn, pluginId };
    sharedState.pluginLoadListeners.push(entry);

    return () => {
        const index = sharedState.pluginLoadListeners.indexOf(entry);
        if (index !== -1) sharedState.pluginLoadListeners.splice(index, 1);
    };
}

export function notifyPluginsLoaded(): void {
    for (const entry of [...sharedState.pluginLoadListeners]) {
        if (entry.pluginId && !isPluginEnabled(entry.pluginId)) continue;

        try {
            entry.fn();
        } catch (error) {
            if (entry.pluginId) {
                disablePlugin(entry.pluginId, 'plugin-loaded callback', error);
            } else {
                console.warn('[plugins] A plugin-loaded callback failed:', error);
            }
        }
    }
}

export function hasFrontendPlugin(id: string): boolean {
    return isPluginEnabled(id);
}

function getPluginConfig(id: string): PluginConfig | undefined {
    for (const mod of Object.values(configs)) {
        if (mod.default?.id === id) return mod.default;
    }
    return undefined;
}

export function registerInfobar(
    id: string,
    infoBar: { barId: string; view: ComponentType; }
) {
    if (!isPluginEnabled(id)) {
        console.warn(`[plugins] blocked: "${id}" is not enabled or has been disabled`);
        return;
    }

    const existingIndex = (() => {
        if (infoBar.barId) {
            const exactIndex = infoBarRegistry.findIndex(existing =>
                existing.id === id && existing.barId === infoBar.barId
            );
            if (exactIndex !== -1) {
                return exactIndex;
            }
        }
        return infoBarRegistry.findIndex(existing => existing.id === id);
    })();
    const next = {
        id,
        ...infoBar,
        view: protectPluginComponent(id, `infobar view (${infoBar.barId})`, infoBar.view),
    };
    if (existingIndex === -1) {
        infoBarRegistry.push(next);
    } else {
        infoBarRegistry[existingIndex] = next;
    }
}

export function getInfoBars(): Infobar[] {
    return [...infoBarRegistry];
}

export function toggleInfoBar(id: string, barId: string) {
    if (!isPluginEnabled(id)) {
        console.warn(`[plugins] blocked: "${id}" is not enabled or has been disabled`);
        return;
    }

    const infoBarIndex = (() => {
        if (barId) {
            const exactIndex = infoBarRegistry.findIndex(existing =>
                existing.id === id && existing.barId === barId
            );
            if (exactIndex !== -1) return exactIndex;
        }

        return infoBarRegistry.findIndex(existing => existing.id === id);
    })();

    if (infoBarIndex === -1) {
        console.warn(`[plugins] failed to open infobar with id: ${id} and barId: ${barId}. Infobar for this item does not exist.`);
        return;
    }

    const target = infoBarRegistry[infoBarIndex];
    const currentInfobar = JSON.parse(localStorage.getItem('infobar:opened') || "null");

    const isSameInfobar =
        currentInfobar?.id === target.id &&
        currentInfobar?.barId === target.barId;

    const updatedInfobar = isSameInfobar
        ? null
        : { id: target.id, barId: target.barId };

    localStorage.setItem('infobar:opened', JSON.stringify(updatedInfobar));
    emit('infobar:updated', updatedInfobar);
}

export function currentInfobar() {
    return JSON.parse(localStorage.getItem('infobar:opened') || "null");
}