import * as fs from "fs";
import * as path from "path";
import * as toml from "@iarna/toml";

const CONFIG_DIR = "config";
const CONFIG_TYPES_DIR = "config_types";

type TomlValue = string | number | boolean | TomlValue[] | { [key: string]: TomlValue };
type TomlObject = { [key: string]: TomlValue };

let _loadedConfigs: Record<string, TomlObject> = {};
const _watchers: Map<string, fs.FSWatcher> = new Map();

function convertType(value: TomlValue, typeStr: string): TomlValue {
    const t = typeStr.toLowerCase().trim();
    switch (t) {
        case "str":
            return String(value);
        case "int": {
            const n = Number(value);
            if (!Number.isInteger(n)) throw new Error(`Cannot convert '${value}' to int`);
            return n;
        }
        case "float":
            return Number(value);
        case "bool":
            if (typeof value === "boolean") return value;
            if (value === "true" || value === "1") return true;
            if (value === "false" || value === "0") return false;
            throw new Error(`Cannot convert '${value}' to bool`);
        case "list":
            if (!Array.isArray(value)) throw new Error(`Expected list, got ${typeof value}`);
            return value;
        case "dict":
            if (typeof value !== "object" || Array.isArray(value) || value === null)
                throw new Error(`Expected dict, got ${typeof value}`);
            return value;
        default:
            throw new Error(`Unknown type: ${t}`);
    }
}

function validateAgainstTypes(configData: TomlObject, typeData: TomlObject, keyPath = ""): void {
    for (const key of Object.keys(typeData)) {
        const fullKey = keyPath ? `${keyPath}.${key}` : key;
        if (!(key in configData)) throw new Error(`Missing key '${fullKey}'`);

        const val = configData[key];
        const typeVal = typeData[key];

        if (typeof typeVal === "object" && !Array.isArray(typeVal)) {
            if (typeof val !== "object" || Array.isArray(val) || val === null)
                throw new Error(`Expected dict for '${fullKey}'`);
            validateAgainstTypes(val as TomlObject, typeVal as TomlObject, fullKey);
        } else if (typeof typeVal === "string") {
            const cleanType = typeVal.split("#")[0].trim();
            configData[key] = convertType(val, cleanType);
        }
    }
}

function loadConfigFile(cfgPath: string): void {
    const stem = path.basename(cfgPath, ".toml");
    const raw = fs.readFileSync(cfgPath, "utf-8");
    const configData = toml.parse(raw) as TomlObject;

    const typePath = path.join(CONFIG_TYPES_DIR, path.basename(cfgPath));
    if (fs.existsSync(typePath)) {
        const typeRaw = fs.readFileSync(typePath, "utf-8");
        const typeData = toml.parse(typeRaw) as TomlObject;
        validateAgainstTypes(configData, typeData);
    }

    _loadedConfigs[stem] = configData;
}

function watchConfigFile(cfgPath: string): void {
    if (_watchers.has(cfgPath)) return;

    const watcher = fs.watch(cfgPath, () => {
        try {
            loadConfigFile(cfgPath);
        } catch (err) {
            console.error(`[config] Failed to reload '${cfgPath}':`, err);
        }
    });

    _watchers.set(cfgPath, watcher);
}

export function loadConfigs(): void {
    for (const watcher of _watchers.values()) watcher.close();
    _watchers.clear();
    _loadedConfigs = {};

    if (!fs.existsSync(CONFIG_DIR)) return;

    for (const file of fs.readdirSync(CONFIG_DIR)) {
        if (!file.endsWith(".toml")) continue;
        const cfgPath = path.join(CONFIG_DIR, file);
        loadConfigFile(cfgPath);
        watchConfigFile(cfgPath);
    }
}

export function getConfig<T = TomlValue>(keyPath: string, defaultValue?: T): T | undefined {
    const parts = keyPath.split(".");

    for (const config of Object.values(_loadedConfigs)) {
        let val: TomlValue = config as TomlValue;
        let found = true;

        for (const part of parts) {
            if (typeof val === "object" && !Array.isArray(val) && val !== null && part in (val as TomlObject)) {
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

export function stopWatching(): void {
    for (const watcher of _watchers.values()) watcher.close();
    _watchers.clear();
}