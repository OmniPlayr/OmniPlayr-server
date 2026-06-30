import toml from 'toml';
import {
    deepMerge,
    parseTypeString,
    validateAgainstTypes,
    type FlatConfigItem,
    type TomlObject,
    type TomlValue,
} from './config';

const _rawConfigs = import.meta.glob('../plugins/*/config/*.toml', {
    eager: true,
    query: '?raw',
    import: 'default',
}) as Record<string, string>;

const _rawTypes = import.meta.glob('../plugins/*/config_types/*.toml', {
    eager: true,
    query: '?raw',
    import: 'default',
}) as Record<string, string>;

const _rawDefaults = import.meta.glob('../plugins/*/config_defaults/*.toml', {
    eager: true,
    query: '?raw',
    import: 'default',
}) as Record<string, string>;

const _pluginConfigs: Record<string, Record<string, TomlObject>> = {};

function _pluginIdFromPath(path: string): string {
    const parts = path.split('/');
    const idx = parts.indexOf('plugins');
    return idx !== -1 ? parts[idx + 1] : '';
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