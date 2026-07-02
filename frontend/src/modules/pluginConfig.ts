import toml from 'toml';
import {
    deepMerge,
    parseTypeString,
    validateAgainstTypes,
    type FlatConfigItem,
    type TomlObject,
    type TomlValue,
} from './config';

const _installedRawConfigs = import.meta.glob('../plugins/*/config/*.toml', {
    eager: true,
    query: '?raw',
    import: 'default',
}) as Record<string, string>;
const _localRawConfigs = import.meta.env.DEV ? import.meta.glob([
    '../local-plugins/*/config/*.toml',
    '../local-plugins/config/*.toml',
], {
    eager: true,
    query: '?raw',
    import: 'default',
}) as Record<string, string> : {};
const _rawConfigs = { ..._installedRawConfigs, ..._localRawConfigs };

const _installedRawTypes = import.meta.glob('../plugins/*/config_types/*.toml', {
    eager: true,
    query: '?raw',
    import: 'default',
}) as Record<string, string>;
const _localRawTypes = import.meta.env.DEV ? import.meta.glob([
    '../local-plugins/*/config_types/*.toml',
    '../local-plugins/config_types/*.toml',
], {
    eager: true,
    query: '?raw',
    import: 'default',
}) as Record<string, string> : {};
const _rawTypes = { ..._installedRawTypes, ..._localRawTypes };

const _installedRawDefaults = import.meta.glob('../plugins/*/config_defaults/*.toml', {
    eager: true,
    query: '?raw',
    import: 'default',
}) as Record<string, string>;
const _localRawDefaults = import.meta.env.DEV ? import.meta.glob([
    '../local-plugins/*/config_defaults/*.toml',
    '../local-plugins/config_defaults/*.toml',
], {
    eager: true,
    query: '?raw',
    import: 'default',
}) as Record<string, string> : {};
const _rawDefaults = { ..._installedRawDefaults, ..._localRawDefaults };

const _installedPackages = import.meta.glob('../plugins/*/package.json', { eager: true }) as Record<string, { default: { id?: string } }>;
const _localPackages = import.meta.env.DEV ? import.meta.glob([
    '../local-plugins/*/package.json',
    '../local-plugins/package.json',
], { eager: true }) as Record<string, { default: { id?: string } }> : {};
const _packages = { ..._installedPackages, ..._localPackages };

const _pluginConfigs: Record<string, Record<string, TomlObject>> = {};

function _pluginIdFromPath(path: string): string {
    const parts = path.split('/');
    const idx = parts.indexOf('plugins');
    if (idx !== -1) return parts[idx + 1] ?? '';

    const localIdx = parts.indexOf('local-plugins');
    if (localIdx === -1) return '';

    const next = parts[localIdx + 1];
    if (next && !['config', 'config_types', 'config_defaults', 'package.json'].includes(next)) {
        return next;
    }

    return _packages['../local-plugins/package.json']?.default?.id ?? '';
}

function _stemFromPath(path: string): string {
    return path.split('/').pop()!.replace(/\.toml$/, '');
}

function _loadPlugin(pluginId: string): void {
    const loaded: Record<string, TomlObject> = {};

    const configEntries = Object.entries(_rawConfigs).filter(([p]) => _pluginIdFromPath(p) === pluginId);
    const defaultEntries = Object.fromEntries(
        Object.entries(_rawDefaults).filter(([p]) => _pluginIdFromPath(p) === pluginId).map(([p, r]) => [_stemFromPath(p), r])
    );
    const typeEntries = Object.fromEntries(
        Object.entries(_rawTypes).filter(([p]) => _pluginIdFromPath(p) === pluginId).map(([p, r]) => [_stemFromPath(p), r])
    );

    for (const [cfgPath, raw] of configEntries) {
        const stem = _stemFromPath(cfgPath);
        let configData = toml.parse(raw) as TomlObject;

        if (stem in defaultEntries) {
            const defaultData = toml.parse(defaultEntries[stem]) as TomlObject;
            configData = deepMerge(defaultData, configData);
        }

        if (stem in typeEntries) {
            const typeData = toml.parse(typeEntries[stem]) as TomlObject;
            validateAgainstTypes(configData, typeData);
        }

        loaded[stem] = configData;
    }

    _pluginConfigs[pluginId] = loaded;
}

function _ensureLoaded(pluginId: string): void {
    if (!_pluginConfigs[pluginId]) {
        _loadPlugin(pluginId);
    }
}

export function getPluginConfig<T = TomlValue>(pluginId: string, keyPath: string, defaultValue?: T): T | undefined {
    _ensureLoaded(pluginId);
    const loaded = _pluginConfigs[pluginId] ?? {};
    const parts = keyPath.split('.');

    for (const config of Object.values(loaded)) {
        let val: TomlValue = config as TomlValue;
        let found = true;

        for (const part of parts) {
            if (typeof val === 'object' && !Array.isArray(val) && val !== null && part in (val as TomlObject)) {
                val = (val as TomlObject)[part];
            } else {
                found = false;
                break;
            }
        }

        if (found) return val as unknown as T;
    }

    return defaultValue;
}

export function reloadPluginConfig(pluginId: string): void {
    delete _pluginConfigs[pluginId];
    _loadPlugin(pluginId);
}

export function flattenPluginConfigs(pluginId: string): FlatConfigItem[] {
    _ensureLoaded(pluginId);
    const results: FlatConfigItem[] = [];

    const typeEntries = Object.entries(_rawTypes).filter(([p]) => _pluginIdFromPath(p) === pluginId);
    const defaultMap = Object.fromEntries(
        Object.entries(_rawDefaults).filter(([p]) => _pluginIdFromPath(p) === pluginId).map(([p, r]) => [_stemFromPath(p), r])
    );
    const loaded = _pluginConfigs[pluginId] ?? {};

    for (const [typePath, typeRaw] of typeEntries) {
        const stem = _stemFromPath(typePath);
        const typeData = toml.parse(typeRaw) as TomlObject;
        const defaultData = stem in defaultMap ? (toml.parse(defaultMap[stem]) as TomlObject) : {};
        const configData = loaded[stem] ?? {};

        function walk(prefix: string, typeNode: TomlObject, configNode: TomlObject, defaultNode: TomlObject) {
            for (const [key, val] of Object.entries(typeNode)) {
                const fullKey = prefix ? `${prefix}.${key}` : key;

                if (typeof val === 'object' && !Array.isArray(val)) {
                    walk(fullKey, val as TomlObject, (configNode[key] ?? {}) as TomlObject, (defaultNode[key] ?? {}) as TomlObject);
                } else if (typeof val === 'string') {
                    const parsed = parseTypeString(val);
                    results.push({
                        key: fullKey,
                        type: parsed.baseType,
                        value: configNode[key] ?? null,
                        default: defaultNode[key] ?? null,
                        comment: parsed.comment ?? null,
                        liveupdate: parsed.liveupdate,
                        min: parsed.minmax ? parsed.minmax[0] : null,
                        max: parsed.minmax ? parsed.minmax[1] : null,
                        step: parsed.step ?? null,
                        in_values: parsed.inValues ?? null,
                        file: stem,
                    });
                }
            }
        }

        walk('', typeData, configData, defaultData);
    }

    return results;
}

const allPluginIds = new Set(
    [...Object.keys(_rawConfigs), ...Object.keys(_rawTypes), ...Object.keys(_rawDefaults)]
        .map(_pluginIdFromPath)
        .filter(Boolean)
);

for (const pluginId of allPluginIds) {
    _loadPlugin(pluginId);
}

if (import.meta.hot) {
    import.meta.hot.accept(() => {
        for (const pluginId of Object.keys(_pluginConfigs)) {
            _loadPlugin(pluginId);
        }
    });
}
