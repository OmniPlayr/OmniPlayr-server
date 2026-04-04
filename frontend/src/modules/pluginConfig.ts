import toml from 'toml';

type TomlValue = string | number | boolean | TomlValue[] | { [key: string]: TomlValue };
type TomlObject = { [key: string]: TomlValue };

const _rawConfigs = import.meta.glob('../plugins/*/config.toml', {
    eager: true,
    query: '?raw',
    import: 'default',
}) as Record<string, string>;

const _pluginConfigs: Record<string, TomlObject> = {};

function _stemFromPath(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 2] ?? '';
}

for (const [path, raw] of Object.entries(_rawConfigs)) {
    const pluginId = _stemFromPath(path);
    try {
        _pluginConfigs[pluginId] = toml.parse(raw) as TomlObject;
    } catch (e) {
        console.error(`[plugin_config] Failed to parse config for "${pluginId}":`, e);
    }
}

export function getPluginConfig<T = TomlValue>(
    pluginId: string,
    keyPath: string,
    defaultValue?: T,
): T | undefined {
    const config = _pluginConfigs[pluginId];
    if (!config) return defaultValue;

    const parts = keyPath.split('.');
    let val: TomlValue = config as TomlValue;

    for (const part of parts) {
        if (typeof val === 'object' && !Array.isArray(val) && val !== null && part in (val as TomlObject)) {
            val = (val as TomlObject)[part];
        } else {
            return defaultValue;
        }
    }

    return val as unknown as T;
}

export function reloadPluginConfig(pluginId: string): void {
    const path = `../plugins/${pluginId}/config.toml`;
    const raw = _rawConfigs[path];
    if (!raw) {
        console.warn(`[plugin_config] No config found for plugin "${pluginId}"`);
        return;
    }
    try {
        _pluginConfigs[pluginId] = toml.parse(raw) as TomlObject;
    } catch (e) {
        console.error(`[plugin_config] Failed to reload config for "${pluginId}":`, e);
    }
}