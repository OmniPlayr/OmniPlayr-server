import api from "../modules/api";
import { useEffect, useState, useRef, useMemo, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { ScrollText, FileSliders, Folder, Server, CircleFadingArrowUp, Search, Link, Save, RotateCcw, Puzzle, ChevronDown } from "lucide-react";
import "../styles/settings/Config.css";
import { Tooltip } from "react-tooltip";
import { makeToast } from "@wokki20/jspt"; 

const SEARCH_FIELD_PREFIXES = ["type:", "value:", "default:", "comment:", "min:", "max:", "step:", "in_values:", "liveupdate:"];

type ConfigSource = "backend" | "frontend" | "plugin-backend" | "plugin-frontend";

interface PluginConfigGroup {
    plugin: string;
    files: string[];
}

interface ConfigList {
    backend: string[];
    frontend: string[];
    plugin_backend?: PluginConfigGroup[];
    plugin_frontend?: PluginConfigGroup[];
}

interface ConfigEntry {
    file: string;
    source: ConfigSource;
    plugin?: string;
}

const CONFIG_SEARCH_SOURCES: ConfigSource[] = ["backend", "frontend", "plugin-backend", "plugin-frontend"];

let cachedConfigList: ConfigList | null = null;
let listFetchPromise: Promise<any> | null = null;

async function loadConfigList() {
    if (cachedConfigList) return cachedConfigList;
    if (!listFetchPromise) {
        listFetchPromise = api("/system/configs");
    }
    cachedConfigList = await listFetchPromise;
    listFetchPromise = null;
    return cachedConfigList;
}

function getSourceLabelKey(source: ConfigSource) {
    return source.replace("-", "_");
}

function getConfigIcon(file: string, source?: ConfigSource) {
    if (source?.startsWith("plugin")) return <Puzzle className="config-icon" />;

    switch (file) {
        case "logging": return <ScrollText className="config-icon" />;
        case "paths": return <Folder className="config-icon" />;
        case "server": return <Server className="config-icon" />;
        case "update": return <CircleFadingArrowUp className="config-icon" />;
        case "api": return <Link className="config-icon" />;
        default: return <FileSliders className="config-icon" />;
    }
}

function renderFieldInput(fieldData: any, onChange: (v: any) => void, t: (key: string) => string) {
    const value = fieldData.value;
    const type: string | undefined = fieldData.type;
    const inValues: string[] | undefined = fieldData.in_values;
    const min: number | undefined = fieldData.min;
    const max: number | undefined = fieldData.max;
    const step: number | undefined = fieldData.step;

    if (inValues && inValues.length > 0 && inValues.length <= 3) {
        return (
            <div className="config-field-input config-field-button-group">
                {inValues.map(v => {
                    const isActive = String(value ?? "") === String(v);
                    return (
                        <button
                            key={v}
                            type="button"
                            className={`config-field-button ${isActive ? "active" : ""}`}
                            onClick={() => {
                                if (type === "int") onChange(parseInt(String(v), 10));
                                else if (type === "float") onChange(parseFloat(String(v)));
                                else if (type === "bool") onChange(String(v) === "true");
                                else onChange(v);
                            }}
                        >
                            {v}
                        </button>
                    );
                })}
            </div>
        );
    }

    if (inValues && inValues.length > 0) {
        return (
            <select
                className="config-field-input config-field-select"
                value={String(value ?? "")}
                onChange={e => {
                    const raw = e.target.value;
                    if (type === "int") onChange(parseInt(raw, 10));
                    else if (type === "float") onChange(parseFloat(raw));
                    else if (type === "bool") onChange(raw === "true");
                    else onChange(raw);
                }}
            >
                {inValues.map(v => (
                    <option key={v} value={v}>{v}</option>
                ))}
            </select>
        );
    }

    if (type === "bool" || (type === undefined && typeof value === "boolean")) {
        const checked = typeof value === "boolean" ? value : value === "true" || value === "1";
        return (
            <div className="config-field-input config-field-button-group">
                {(["True", "False"] as const).map(label => {
                    const isActive = checked === (label === "True");
                    return (
                        <button
                            key={label}
                            type="button"
                            className={`config-field-button ${isActive ? "active" : ""}`}
                            onClick={() => onChange(label === "True")}
                        >
                            {t(`settings.config.field.${label.toLowerCase()}`)}
                        </button>
                    );
                })}
            </div>
        );
    }

    if (type === "int" || type === "float" || (type === undefined && typeof value === "number")) {
        const hasRange = min !== undefined && max !== undefined;

        if (hasRange) {
            const range = max - min;
            const effectiveStep = step ?? (type === "float" ? Math.max(range / 100, 0.0001) : 1);

            const numericValue =
                typeof value === "number"
                    ? value
                    : value === undefined || value === null || value === ""
                        ? min
                        : type === "float"
                            ? parseFloat(value)
                            : parseInt(value, 10);

            const clampedValue = Math.min(max, Math.max(min, numericValue));

            const numPossibleSteps = Math.round((max - min) / effectiveStep);
            const MAX_TICKS = 7;
            const tickValues: number[] = [];

            if (numPossibleSteps + 1 <= MAX_TICKS) {
                for (let i = 0; i <= numPossibleSteps; i++) {
                    tickValues.push(Math.round((min + i * effectiveStep) * 1e9) / 1e9);
                }
            } else {
                const interval = numPossibleSteps / (MAX_TICKS - 1);
                for (let i = 0; i < MAX_TICKS; i++) {
                    const idx = Math.round(i * interval);
                    const v = Math.round((min + idx * effectiveStep) * 1e9) / 1e9;
                    tickValues.push(Math.min(v, max));
                }
                tickValues[tickValues.length - 1] = max;
            }

            return (
                <div className="config-slider-wrapper">
                    <div className="config-slider-row">
                        <div className="config-slider-track-area">
                            <input
                                type="range"
                                min={min}
                                max={max}
                                step={effectiveStep}
                                value={clampedValue}
                                className="config-slider-input"
                                style={
                                    {
                                        "--value": clampedValue,
                                        "--min": min,
                                        "--max": max
                                    } as React.CSSProperties
                                }
                                onChange={e => {
                                    const v = type === "float"
                                        ? parseFloat(e.target.value)
                                        : parseInt(e.target.value, 10);
                                    onChange(v);
                                }}
                            />
                            <div className="config-slider-ticks-row">
                                {tickValues.map(v => {
                                    const pct = (v - min) / (max - min);
                                    return (
                                        <span
                                            key={v}
                                            className="config-slider-tick"
                                            style={{ left: `calc(8px + (100% - 16px) * ${pct})` }}
                                        >
                                            <span className="config-slider-tick-mark">|</span>
                                            <span className="config-slider-tick-label">{v}</span>
                                        </span>
                                    );
                                })}
                            </div>
                        </div>
                        <span className="config-slider-value">({clampedValue})</span>
                    </div>
                </div>
            );
        }

        return (
            <input
                className="config-field-input"
                type="number"
                value={value ?? ""}
                min={min}
                max={max}
                step={step ?? (type === "float" ? "any" : 1)}
                onChange={e => {
                    const parsed = type === "float" ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
                    onChange(isNaN(parsed) ? e.target.value : parsed);
                }}
            />
        );
    }

    if (type === "list" || (type === undefined && Array.isArray(value))) {
        const arrVal: any[] = Array.isArray(value) ? value : [];
        return (
            <input
                className="config-field-input"
                type="text"
                value={arrVal.join(", ")}
                onChange={e => onChange(e.target.value.split(",").map((s: string) => s.trim()))}
            />
        );
    }

    return (
        <input
            className="config-field-input"
            type="text"
            value={String(value ?? "")}
            onChange={e => onChange(e.target.value)}
        />
    );
}

function formatConfigLabel(key: string) {
    return key.charAt(0).toUpperCase() + key.slice(1).replaceAll("_", " ");
}

function isConfigField(value: any) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && "value" in value;
}

function getConfigFieldAtPath(data: any, path: string[]) {
    let node = data;
    for (const part of path) {
        node = node?.[part];
    }
    return node;
}

function setConfigFieldValueAtPath(data: any, path: string[], value: any): any {
    if (path.length === 0) return data;
    const [head, ...rest] = path;

    if (rest.length === 0) {
        return {
            ...data,
            [head]: {
                ...data[head],
                value,
            },
        };
    }

    return {
        ...data,
        [head]: setConfigFieldValueAtPath(data[head] ?? {}, rest, value),
    };
}

function getConfigEntryKey(entry: ConfigEntry) {
    return `${entry.source}:${entry.plugin ?? "core"}:${entry.file}`;
}

function ConfigEditor({
    data,
    draftData,
    onDraftChange,
    onModifiedChange,
    onSaved,
}: {
    data: any;
    draftData?: any;
    onDraftChange: (data: any) => void;
    onModifiedChange: (modified: boolean) => void;
    onSaved: () => void;
}) {
    const { t } = useTranslation();
    const [localData, setLocalData] = useState<any>(() => draftData ?? data.data);
    const [originalData, setOriginalData] = useState<any>(() => JSON.parse(JSON.stringify(data.data)));
    const [saving, setSaving] = useState(false);

    const isDirty = useMemo(
        () => JSON.stringify(localData) !== JSON.stringify(originalData),
        [localData, originalData]
    );

    useEffect(() => {
        setOriginalData(JSON.parse(JSON.stringify(data.data)));
        setLocalData(draftData ?? data.data);
    }, [data, draftData]);

    useEffect(() => {
        onModifiedChange(isDirty);
    }, [isDirty, onModifiedChange]);

    function handleChange(path: string[], value: any) {
        setLocalData((prev: any) => {
            const next = setConfigFieldValueAtPath(prev, path, value);
            onDraftChange(next);
            return next;
        });
    }

    function handleRestore(path: string[], fieldData: any) {
        const originalField = getConfigFieldAtPath(originalData, path);
        const restoreVal = "default" in fieldData
            ? fieldData.default
            : originalField?.value;

        setLocalData((prev: any) => {
            if (restoreVal === undefined) return prev;
            const next = setConfigFieldValueAtPath(prev, path, restoreVal);
            onDraftChange(next);
            return next;
        });
    }

    function handleResetAll() {
        const next = JSON.parse(JSON.stringify(originalData));
        setLocalData(next);
        onDraftChange(next);
    }

    async function handleSave() {
        setSaving(true);
        try {
            await api(
                `/system/configs`,
                {
                    file: data.file,
                    source: data.source,
                    plugin: data.plugin,
                    data: localData
                },
                undefined,
                true,
                false,
                "PUT"
            );
            setOriginalData(JSON.parse(JSON.stringify(localData)));
            onDraftChange(localData);
            onSaved();
            makeToast({ message: t('settings.config.toast.saved'), style: "default" });
        } catch (e: any) {
            makeToast({ message: e?.message ?? t('settings.config.toast.save_failed'), style: "default-error" });
        } finally {
            setSaving(false);
        }
    }

    function isFieldModified(fieldData: any): boolean {
        const currVal = fieldData.value;
        if ("default" in fieldData) {
            const def = fieldData.default;
            if (Array.isArray(currVal) && Array.isArray(def)) {
                return !(currVal.length === def.length && currVal.every((v: any, i: number) => v === def[i]));
            }
            return currVal !== def;
        }
        return fieldData.is_default === false;
    }

    function renderField(fieldKey: string, fieldData: any, path: string[]) {
        const isModified = isFieldModified(fieldData);
        const isLive: boolean = !!fieldData.liveupdate;
        const displayType: string = fieldData.type ?? (Array.isArray(fieldData.value) ? "array" : typeof fieldData.value);
        const fieldPath = path.join(".");

        return (
            <div key={fieldPath} className="config-field">
                <div className="config-field-header">
                    <div className="config-field-key">{formatConfigLabel(fieldKey)}</div>
                    <div className="config-field-type">{displayType}</div>
                    <Tooltip id={`tooltip-${fieldPath}`} />
                    {isLive && (
                        <span className="config-field-live-badge" data-tooltip-content={t('settings.config.field.live_tooltip')} data-tooltip-id={`tooltip-${fieldPath}`}>
                            {t('settings.config.field.live')}
                        </span>
                    )}
                    {!isModified ? (
                        <span className="config-field-default-badge">{t('settings.config.field.default')}</span>
                    ) : (
                        <button className="config-field-restore" onClick={() => handleRestore(path, fieldData)}>
                            <RotateCcw size={12} />
                            {t('settings.config.field.restore')}
                        </button>
                    )}
                </div>
                {fieldData.comment && (
                    <div className="config-field-comment">{fieldData.comment}</div>
                )}
                {renderFieldInput(fieldData, v => handleChange(path, v), t)}
            </div>
        );
    }

    function renderGroups(node: any, path: string[] = []): React.ReactNode[] {
        if (node === null || typeof node !== "object" || Array.isArray(node)) return [];

        const directFields: Array<[string, any]> = [];
        const nestedNodes: Array<[string, any]> = [];

        for (const [key, value] of Object.entries(node)) {
            if (isConfigField(value)) {
                directFields.push([key, value]);
            } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
                nestedNodes.push([key, value]);
            }
        }

        const groups: React.ReactNode[] = [];
        if (directFields.length > 0) {
            const groupKey = path.join(".") || "__root";
            groups.push(
                <div key={groupKey} className="config-group">
                    {path.length > 0 && (
                        <div className="config-group-title">{formatConfigLabel(path[path.length - 1])}</div>
                    )}
                    <div className="config-group-fields">
                        {directFields.map(([fieldKey, fieldData]) =>
                            renderField(fieldKey, fieldData, [...path, fieldKey])
                        )}
                    </div>
                </div>
            );
        }

        for (const [key, value] of nestedNodes) {
            groups.push(...renderGroups(value, [...path, key]));
        }

        return groups;
    }

    return (
        <div className="config-editor">
            <div className="config-editor-header">
                <div className="config-editor-header-left">
                    <div className="config-editor-title">{data.file}</div>
                    <div className="config-editor-subtitle">
                        {data.plugin ? `${data.plugin} / ${data.file}.toml` : `${data.file}.toml`}
                    </div>
                </div>
            </div>
            <div className="config-editor-body">
                {renderGroups(localData)}
            </div>

            <div className={`config-unsaved-banner${isDirty ? " visible" : ""}`}>
                <span className="config-unsaved-text">{t('settings.config.unsaved')}</span>
                <div className="config-unsaved-actions">
                    <button className="config-unsaved-reset" onClick={handleResetAll} disabled={saving}>
                        {t('settings.config.reset_all')}
                    </button>
                    <button className="config-unsaved-save" onClick={handleSave} disabled={saving}>
                        <Save size={14} />
                        {saving ? t('settings.config.saving') : t('settings.config.save_changes')}
                    </button>
                </div>
            </div>
        </div>
    );
}

interface SearchMatch {
    key: string;
    type: string;
    value: any;
    default: any;
    comment: string | null;
    liveupdate: boolean;
    min: number | null;
    max: number | null;
    step: number | null;
    in_values: string[] | null;
    file: string;
    plugin?: string;
}

interface SearchGroup {
    file: string;
    plugin?: string;
    matches: SearchMatch[];
}

function SearchResults({ groups, source }: { groups: SearchGroup[]; source: ConfigSource }) {
    const { t } = useTranslation();

    if (groups.length === 0) {
        return (
            <div className="config-main-empty">
                <Search className="config-empty-icon" />
                <p className="config-empty-text">{t('settings.config.no_results')}</p>
            </div>
        );
    }

    return (
        <div className="config-search-results">
            {groups.map(group => (
                <div key={`${group.plugin ?? "core"}-${group.file}`} className="config-group">
                    <div className="config-group-title">
                        {getConfigIcon(group.file, source)}
                        {group.plugin ? `${group.plugin} / ${group.file}.toml` : `${group.file}.toml`}
                        <span className="config-search-source-badge">{t(`settings.config.source.${getSourceLabelKey(source)}`)}</span>
                    </div>
                    <div className="config-group-fields">
                        {group.matches.map(match => {
                            const displayType = match.type ?? (Array.isArray(match.value) ? "array" : typeof match.value);
                            return (
                                <div key={match.key} className="config-field config-field-readonly">
                                    <div className="config-field-header">
                                        <div className="config-field-key">{match.key.charAt(0).toUpperCase() + match.key.slice(1).replaceAll("_", " ")}</div>
                                        <div className="config-field-type">{displayType}</div>
                                        {match.liveupdate && (<span className="config-field-live-badge" title={t('settings.config.field.live_tooltip')}>{t('settings.config.field.live')}</span>)}
                                    </div>
                                    {match.comment && (
                                        <div className="config-field-comment">{match.comment}</div>
                                    )}
                                    <div className="config-field-search-value">
                                        <span className="config-field-search-label">{t('settings.config.field.value')}</span>
                                        <span className="config-field-search-val">{JSON.stringify(match.value)}</span>
                                        {match.default !== undefined && match.value !== match.default && (
                                            <>
                                                <span className="config-field-search-label">{t('settings.config.field.default')}</span>
                                                <span className="config-field-search-val config-field-search-val--dim">{JSON.stringify(match.default)}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}

function Config() {
    const { t } = useTranslation();
    const [configList, setConfigList] = useState<ConfigList | null>(cachedConfigList);
    const [selected, setSelected] = useState<ConfigEntry | null>(null);
    const [configData, setConfigData] = useState<any>(null);
    const [search, setSearch] = useState("");
    const [showAC, setShowAC] = useState(false);
    const [acItems, setAcItems] = useState<string[]>([]);
    const [searchResults, setSearchResults] = useState<SearchGroup[] | null>(null);
    const [searchSource, setSearchSource] = useState<ConfigSource>("backend");
    const [searchLoading, setSearchLoading] = useState(false);
    const [configDrafts, setConfigDrafts] = useState<Record<string, any>>({});
    const [modifiedConfigs, setModifiedConfigs] = useState<Record<string, boolean>>({});
    const searchRef = useRef<HTMLInputElement>(null);
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [openSidebarGroups, setOpenSidebarGroups] = useState<Record<string, boolean>>({});

    function toggleSidebarGroup(key: string) {
        setOpenSidebarGroups(prev => ({
            ...prev,
            [key]: !(prev[key] ?? true),
        }));
    }

    function isSidebarGroupOpen(key: string) {
        return openSidebarGroups[key] ?? true;
    }

    useEffect(() => {
        if (configList) return;
        loadConfigList().then(setConfigList);
    }, []);

    useEffect(() => {
        if (!selected) return;
        setConfigData(null);
        const params = new URLSearchParams({ file: selected.file, source: selected.source });
        if (selected.plugin) params.set("plugin", selected.plugin);
        api(`/system/configs?${params}`).then(setConfigData);
    }, [selected]);

    useEffect(() => {
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

        const isFieldSearch = search.includes(":");
        if (!isFieldSearch || search.endsWith(":")) {
            setSearchResults(null);
            return;
        }

        searchDebounceRef.current = setTimeout(async () => {
            setSearchLoading(true);
            try {
                const params = new URLSearchParams({ query: search });
                params.set("source", searchSource);
                const results: SearchGroup[] = await api(`/system/config_search?${params}`) as SearchGroup[];
                setSearchResults(results);
            } catch {
                setSearchResults([]);
            } finally {
                setSearchLoading(false);
            }
        }, 300);

        return () => {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        };
    }, [search, searchSource]);

    const allBackend: ConfigEntry[] = (configList?.backend ?? []).map(f => ({ file: f, source: "backend" }));
    const allFrontend: ConfigEntry[] = (configList?.frontend ?? []).map(f => ({ file: f, source: "frontend" }));
    const allPluginBackend: ConfigEntry[] = (configList?.plugin_backend ?? []).flatMap(group =>
        group.files.map(file => ({ file, source: "plugin-backend", plugin: group.plugin }))
    );
    const allPluginFrontend: ConfigEntry[] = (configList?.plugin_frontend ?? []).flatMap(group =>
        group.files.map(file => ({ file, source: "plugin-frontend", plugin: group.plugin }))
    );

    function filterList(list: ConfigEntry[]) {
        if (!search || search.includes(":")) return list;
        const lower = search.toLowerCase();
        return list.filter(c =>
            c.file.toLowerCase().includes(lower) ||
            (c.plugin?.toLowerCase().includes(lower) ?? false)
        );
    }

    function selectConfig(entry: ConfigEntry) {
        setSelected(entry);
        setSearch("");
        setSearchResults(null);
    }

    function setConfigModified(key: string, modified: boolean) {
        setModifiedConfigs(prev => {
            if (!!prev[key] === modified) return prev;
            const next = { ...prev };
            if (modified) next[key] = true;
            else delete next[key];
            return next;
        });
    }

    function setConfigDraft(key: string, data: any) {
        setConfigDrafts(prev => ({
            ...prev,
            [key]: data,
        }));
    }

    function clearConfigModified(key: string) {
        setModifiedConfigs(prev => {
            if (!(key in prev)) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
        });
    }

    function isConfigModified(entry: ConfigEntry) {
        return !!modifiedConfigs[getConfigEntryKey(entry)];
    }

    function hasModifiedConfig(entries: ConfigEntry[]) {
        return entries.some(isConfigModified);
    }

    function handleSearchChange(val: string) {
        setSearch(val);
        if (!val.includes(":")) {
            const lower = val.toLowerCase();
            const suggestions = SEARCH_FIELD_PREFIXES.filter(p => p.startsWith(lower));
            setAcItems(suggestions);
            setShowAC(suggestions.length > 0 && val.length > 0);
        } else {
            setShowAC(false);
        }
    }

    function applyAC(item: string) {
        setSearch(item);
        setShowAC(false);
        searchRef.current?.focus();
    }

    const isFieldSearch = search.includes(":");
    const backendFiltered = filterList(allBackend);
    const frontendFiltered = filterList(allFrontend);
    const pluginBackendFiltered = filterList(allPluginBackend);
    const pluginFrontendFiltered = filterList(allPluginFrontend);

    let mainContent: React.ReactNode;
    if (isFieldSearch) {
        if (searchLoading) {
            mainContent = (
                <div className="config-main-empty">
                    <p className="config-empty-text">{t('settings.config.searching')}</p>
                </div>
            );
        } else if (searchResults !== null) {
            mainContent = <SearchResults groups={searchResults} source={searchSource} />;
        } else {
            mainContent = (
                <div className="config-main-empty">
                    <Search className="config-empty-icon" />
                    <p className="config-empty-text">{t('settings.config.empty.type_value')}</p>
                </div>
            );
        }
    } else if (!selected) {
        mainContent = (
            <div className="config-main-empty">
                <FileSliders className="config-empty-icon" />
                <p className="config-empty-text">{t('settings.config.empty.select_file')}</p>
            </div>
        );
    } else if (!configData) {
        mainContent = (
            <div className="config-main-empty">
                <p className="config-empty-text">{t('settings.config.empty.loading')}</p>
            </div>
        );
    } else {
        const selectedKey = getConfigEntryKey(selected);
        mainContent = (
            <ConfigEditor
                key={selectedKey}
                data={configData}
                draftData={configDrafts[selectedKey]}
                onDraftChange={data => setConfigDraft(selectedKey, data)}
                onModifiedChange={modified => setConfigModified(selectedKey, modified)}
                onSaved={() => clearConfigModified(selectedKey)}
            />
        );
    }

    function renderSidebarItems(items: ConfigEntry[], label: string) {
        if (items.length === 0) return null;
        const groupKey = `group-${label}`;
        const groupOpen = isSidebarGroupOpen(groupKey);
        const coreItems = items.filter(c => !c.plugin);
        const pluginItems = items.filter(c => c.plugin);
        const plugins = [...new Set(pluginItems.map(c => c.plugin))];
        const groupModified = hasModifiedConfig(items);
        return (
            <>
                <div
                    className={`config-sidebar-group-folder${groupOpen ? " open" : ""}${groupModified ? " modified" : ""}`}
                    style={{ '--file-item-depth': '0' } as CSSProperties}
                    onClick={() => toggleSidebarGroup(groupKey)}
                >
                    <ChevronDown className="config-sidebar-group-folder-icon" />{label}
                    {groupModified && <div className="config-sidebar-modified" />}
                </div>
                {groupOpen && (
                    <>
                        {coreItems.map(c => {
                            const active = selected?.file === c.file && selected?.source === c.source && selected?.plugin === c.plugin;
                            const modified = isConfigModified(c);
                            return (
                                <div
                                    key={`${c.source}-${c.plugin ?? "core"}-${c.file}`}
                                    className={`config-section-sidebar-file${active ? " active" : ""}${modified ? " modified" : ""}`}
                                    style={{
                                        '--file-item-depth': '1',
                                    } as CSSProperties}
                                    onClick={() => selectConfig(c)}
                                >
                                    {getConfigIcon(c.file, c.source)}
                                    <div className="config-section-sidebar-file-name">{c.file}.toml</div>
                                    {modified && <div className="config-sidebar-modified" />}
                                </div>
                            );
                        })}
                        {plugins.map(plugin => {
                            const pluginKey = `plugin-${label}-${plugin}`;
                            const pluginOpen = isSidebarGroupOpen(pluginKey);
                            const files = pluginItems.filter(c => c.plugin === plugin);
                            const pluginModified = hasModifiedConfig(files);
                            return (
                                <div key={plugin}>
                                    <div
                                        className={`config-sidebar-group-folder${pluginOpen ? " open" : ""}${pluginModified ? " modified" : ""}`}
                                        style={{
                                            '--file-item-depth': '1',
                                        } as CSSProperties}
                                        onClick={() => toggleSidebarGroup(pluginKey)}
                                    >
                                        <ChevronDown className="config-sidebar-group-folder-icon" />{plugin}
                                        {pluginModified && <div className="config-sidebar-modified" />}
                                    </div>
                                    {pluginOpen && files.map(c => {
                                        const active = selected?.file === c.file && selected?.source === c.source && selected?.plugin === c.plugin;
                                        const modified = isConfigModified(c);
                                        return (
                                            <div
                                                key={`${c.source}-${c.plugin ?? "core"}-${c.file}`}
                                                className={`config-section-sidebar-file${active ? " active" : ""}${modified ? " modified" : ""}`}
                                                style={{
                                                    '--file-item-depth': '2',
                                                } as CSSProperties}
                                                onClick={() => selectConfig(c)}
                                            >
                                                {getConfigIcon(c.file, c.source)}
                                                <div className="config-section-sidebar-file-name">{c.file}.toml</div>
                                                {modified && <div className="config-sidebar-modified" />}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </>
                )}
            </>
        );
    }

    return (
        <div className="config-section">
            <div className="config-section-content">
                <div className="config-section-sidebar">
                    <div className="config-search-wrapper">
                        <Search className="config-search-icon" />
                        <input
                            ref={searchRef}
                            className="config-search"
                            placeholder={t('settings.config.search_placeholder')}
                            value={search}
                            onChange={e => handleSearchChange(e.target.value)}
                            onBlur={() => setTimeout(() => setShowAC(false), 150)}
                            onFocus={() => search && handleSearchChange(search)}
                        />
                        {showAC && (
                            <div className="config-autocomplete">
                                {acItems.map(item => (
                                    <div
                                        key={item}
                                        className="config-autocomplete-item"
                                        onMouseDown={() => applyAC(item)}
                                    >
                                        <span className="config-autocomplete-field">{item.replace(":", "")}</span>
                                        <span className="config-autocomplete-colon">:</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {isFieldSearch && (
                        <div className="config-search-source-toggle">
                            {CONFIG_SEARCH_SOURCES.map(src => (
                                <button
                                    key={src}
                                    className={`config-search-source-btn${searchSource === src ? " active" : ""}`}
                                    onClick={() => setSearchSource(src)}
                                >
                                    {t(`settings.config.source.${getSourceLabelKey(src)}`)}
                                </button>
                            ))}
                        </div>
                    )}

                    {renderSidebarItems(backendFiltered, t('settings.config.source.backend'))}
                    {renderSidebarItems(frontendFiltered, t('settings.config.source.frontend'))}
                    {renderSidebarItems(pluginBackendFiltered, t('settings.config.source.plugin_backend'))}
                    {renderSidebarItems(pluginFrontendFiltered, t('settings.config.source.plugin_frontend'))}
                </div>

                <div className="config-main">
                    {mainContent}
                </div>
            </div>
        </div>
    );
}

export default Config;
