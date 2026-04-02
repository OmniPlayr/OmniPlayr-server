import toml from "toml";

type TomlValue = string | number | boolean | TomlValue[] | { [key: string]: TomlValue };
type TomlObject = { [key: string]: TomlValue };

let _loadedConfigs: Record<string, TomlObject> = {};

function convertType(value: TomlValue, typeStr: string): TomlValue {
    const t = typeStr.toLowerCase().trim();
    switch (t) {
        case "string": case "str":
            return String(value);
        case "int": case "integer": {
            const n = Number(value);
            if (!Number.isInteger(n)) throw new Error(`Cannot convert '${value}' to int`);
            return n;
        }
        case "float":
            return Number(value);
        case "bool": case "boolean":
            if (typeof value === "boolean") return value;
            if (value === "true" || value === "1") return true;
            if (value === "false" || value === "0") return false;
            throw new Error(`Cannot convert '${value}' to bool`);
        case "list": case "array":
            if (!Array.isArray(value)) throw new Error(`Expected list, got ${typeof value}`);
            return value;
        case "dict": case "object":
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

function stemFromPath(path: string): string {
    return path.split("/").pop()!.replace(/\.toml$/, "");
}

export function loadConfigs(): void {
    _loadedConfigs = {};

    const configs = import.meta.glob("/src/config/*.toml", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
    const types = import.meta.glob("/src/config_types/*.toml", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;

    for (const [cfgPath, raw] of Object.entries(configs)) {
        const stem = stemFromPath(cfgPath);
        const configData = toml.parse(raw) as TomlObject;

        const typePath = `/src/config_types/${stem}.toml`;
        if (typePath in types) {
            const typeData = toml.parse(types[typePath]) as TomlObject;
            validateAgainstTypes(configData, typeData);
        }

        _loadedConfigs[stem] = configData;
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

loadConfigs();

if (import.meta.hot) {
    import.meta.hot.accept(() => {
        loadConfigs();
    });
}