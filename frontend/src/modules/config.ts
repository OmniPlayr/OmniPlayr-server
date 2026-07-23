import toml from "toml";

export type TomlValue = string | number | boolean | TomlValue[] | { [key: string]: TomlValue };
export type TomlObject = { [key: string]: TomlValue };

let _loadedConfigs: Record<string, TomlObject> = {};

interface ParsedType {
    baseType: string;
    liveupdate: boolean;
    comment?: string;
    minmax?: [number, number];
    step?: number;
    inValues?: string[];
}

export function deepMerge(base: TomlObject, override: TomlObject): TomlObject {
    const result: TomlObject = { ...base };
    for (const [key, val] of Object.entries(override)) {
        if (
            key in result &&
            typeof result[key] === "object" &&
            !Array.isArray(result[key]) &&
            typeof val === "object" &&
            !Array.isArray(val)
        ) {
            result[key] = deepMerge(result[key] as TomlObject, val as TomlObject);
        } else {
            result[key] = val;
        }
    }
    return result;
}

export function parseTypeString(typeStr: string): ParsedType {
    let s = typeStr;

    const liveupdate = s.includes("# liveupdate:true");
    if (liveupdate) s = s.replace("# liveupdate:true", "").trim();

    let comment: string | undefined;
    const commentMatch = s.match(/#\s*comment:\s*(.+)/);
    if (commentMatch) {
        comment = commentMatch[1].trim();
        s = s.slice(0, commentMatch.index!).trim();
    }

    let minmax: [number, number] | undefined;
    let step: number | undefined;
    const minmaxMatch = s.match(/<minmax\s*\[([^\]]+)\]\s*step\s*\[([^\]]+)\]>/);
    if (minmaxMatch) {
        const [min, max] = minmaxMatch[1].split(",").map(x => parseFloat(x.trim()));
        minmax = [min, max];
        step = parseFloat(minmaxMatch[2].trim());
        s = s.slice(0, minmaxMatch.index!).trim();
    }

    let inValues: string[] | undefined;
    const inMatch = s.match(/<in\s*\[([^\]]+)\]>/);
    if (inMatch) {
        inValues = inMatch[1].split(",").map(v => v.trim().replace(/^['"]|['"]$/g, ""));
        s = s.slice(0, inMatch.index!).trim();
    }

    const baseType = s.split("#")[0].trim().toLowerCase();

    return { baseType, liveupdate, comment, minmax, step, inValues };
}

function convertType(value: TomlValue, baseType: string): TomlValue {
    switch (baseType) {
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
        case "eval": {
            if (typeof value !== "string") throw new Error(`Expected string for eval, got ${typeof value}`);
            try {
                return Function(`return (${value})`)();
            } catch (e) {
                throw new Error(`Eval failed: ${(e as Error).message}`);
            }
        }
        default:
            throw new Error(`Unknown type: ${baseType}`);
    }
}

export function validateAgainstTypes(configData: TomlObject, typeData: TomlObject, keyPath = ""): void {
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
            const parsed = parseTypeString(typeVal);
            const converted = convertType(val, parsed.baseType);

            if (parsed.minmax !== undefined) {
                const [min, max] = parsed.minmax;
                if (typeof converted !== "number" || converted < min || converted > max) {
                    throw new Error(`Value ${converted} out of range [${min}, ${max}] for '${fullKey}'`);
                }
            }

            if (parsed.inValues !== undefined && !parsed.inValues.includes(String(converted))) {
                throw new Error(
                    `Invalid value '${converted}' for '${fullKey}'. Must be one of: ${parsed.inValues.join(", ")}`
                );
            }

            configData[key] = converted;
        }
    }
}

function stemFromPath(path: string): string {
    return path.split("/").pop()!.replace(/\.toml$/, "");
}

function resolvePlaceholdersObject(value: TomlObject): TomlObject {
    const resolve = (v: TomlValue): TomlValue => {
        if (typeof v === "string") {
            return v.replace(/\{([^}]+)\}/g, (_, expr) => {
                try {
                    return String(Function(`return (${expr})`)());
                } catch (e) {
                    throw new Error(`Eval failed in {${expr}} -> ${(e as Error).message}`);
                }
            });
        }
        if (Array.isArray(v)) return v.map(resolve);
        if (v && typeof v === "object") {
            const out: TomlObject = {};
            for (const k in v) out[k] = resolve(v[k]);
            return out;
        }
        return v;
    };

    const out: TomlObject = {};
    for (const k in value) out[k] = resolve(value[k]);
    return out;
}

function shouldResolveEval(typeData: TomlObject): boolean {
    return JSON.stringify(typeData).includes('"eval"');
}

function loadConfigs(): void {
    _loadedConfigs = {};

    const configs = import.meta.glob("/src/config/*.toml", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
    const types = import.meta.glob("/src/config_types/*.toml", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
    const defaults = import.meta.glob("/src/config_defaults/*.toml", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;

    for (const [cfgPath, raw] of Object.entries(configs)) {
        const stem = stemFromPath(cfgPath);
        let configData = toml.parse(raw) as TomlObject;

        const defaultPath = `/src/config_defaults/${stem}.toml`;
        if (defaultPath in defaults) {
            const defaultData = toml.parse(defaults[defaultPath]) as TomlObject;
            configData = deepMerge(defaultData, configData);
        }

        const typePath = `/src/config_types/${stem}.toml`;
        if (typePath in types) {
            const typeData = toml.parse(types[typePath]) as TomlObject;
            validateAgainstTypes(configData, typeData);
            if (shouldResolveEval(typeData)) {
                configData = resolvePlaceholdersObject(configData);
            }
        }

        _loadedConfigs[stem] = configData;
    }
}

export interface FlatConfigItem {
    key: string;
    type: string;
    value: TomlValue | null;
    default: TomlValue | null;
    comment: string | null;
    liveupdate: boolean;
    min: number | null;
    max: number | null;
    step: number | null;
    in_values: string[] | null;
    file: string;
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