import api from "../modules/api";
import { useEffect, useState, useRef } from "react";
import { ScrollText, FileSliders, Folder, Server, CircleFadingArrowUp, TriangleAlert, Search, Link, History, Save, RotateCcw, Zap } from "lucide-react";
import "../styles/settings/Config.css";
import { Tooltip } from "react-tooltip";
import { makeToast } from "@wokki20/jspt";

const SEARCH_FIELD_PREFIXES = ["type:", "value:", "default:", "comment:", "min:", "max:", "step:", "in_values:", "liveupdate:"];

let cachedConfigList: { backend: string[]; frontend: string[] } | null = null;
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

function getConfigIcon(file: string) {
    switch (file) {
        case "logging": return <ScrollText className="config-icon" />;
        case "paths": return <Folder className="config-icon" />;
        case "server": return <Server className="config-icon" />;
        case "update": return <CircleFadingArrowUp className="config-icon" />;
        case "api": return <Link className="config-icon" />;
        default: return <FileSliders className="config-icon" />;
    }
}

function renderFieldInput(fieldData: any, onChange: (v: any) => void) {
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
            <label className="config-toggle">
                <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
                <span className="config-toggle-track">
                    <span className="config-toggle-thumb" />
                </span>
            </label>
        );
    }

    if (type === "int" || type === "float" || (type === undefined && typeof value === "number")) {
        const hasRange = min !== undefined && max !== undefined;

        if (hasRange) {
            const range = max - min;

            const effectiveStep =
                step ??
                (type === "float" ? Math.max(range / 100, 0.0001) : 1);

            const numericValue =
                typeof value === "number"
                    ? value
                    : value === undefined || value === null || value === ""
                        ? min
                        : type === "float"
                            ? parseFloat(value)
                            : parseInt(value, 10);

            const clampedValue = Math.min(max, Math.max(min, numericValue));

            return (
                <div className="config-slider-wrapper">
                    <div className="config-slider-row">
                        <input
                            className="config-field-input"
                            type="range"
                            min={min}
                            max={max}
                            step={effectiveStep}
                            value={clampedValue}
                            onChange={e => {
                                const v =
                                    type === "float"
                                        ? parseFloat(e.target.value)
                                        : parseInt(e.target.value, 10);

                                onChange(v);
                            }}
                        />

                        <span className="config-slider-value">
                            {clampedValue}
                        </span>
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

function isFieldDefault(fieldData: any): boolean {
    if (!("default" in fieldData)) return true;
    const val = fieldData.value;
    const def = fieldData.default;
    if (Array.isArray(val) && Array.isArray(def)) {
        return val.length === def.length && val.every((v: any, i: number) => v === def[i]);
    }
    return val === def;
}

function ConfigEditor({ data }: { data: any }) {
    const [localData, setLocalData] = useState<any>(data.data);
    const [saving, setSaving] = useState(false);

    function handleChange(section: string, key: string | null, value: any) {
        setLocalData((prev: any) => {
            if (key === null) {
                return { ...prev, [section]: { ...prev[section], value } };
            }
            return {
                ...prev,
                [section]: {
                    ...prev[section],
                    [key]: { ...prev[section][key], value },
                },
            };
        });
    }

    function handleRestore(section: string, key: string | null) {
        setLocalData((prev: any) => {
            if (key === null) {
                const def = prev[section]?.default;
                if (def === undefined) return prev;
                return { ...prev, [section]: { ...prev[section], value: def } };
            }
            const def = prev[section]?.[key]?.default;
            if (def === undefined) return prev;
            return {
                ...prev,
                [section]: {
                    ...prev[section],
                    [key]: { ...prev[section][key], value: def },
                },
            };
        });
    }

    async function handleSave() {
        setSaving(true);
        try {
            await api(
                `/system/configs`,
                {
                    file: data.file,
                    source: data.source,
                    data: localData
                },
                undefined,
                true,
                false,
                "PUT"
            );
            makeToast({ message: "Saved successfully, please restart your system for changes to take effect", style: "default"});
        } catch (e: any) {
            makeToast({ message: e?.message ?? "Failed to save", style: "default-error" });
        } finally {
            setSaving(false);
        }
    }

    function renderField(fieldKey: string, fieldData: any, section: string, key: string | null) {
        const isDefault = isFieldDefault(fieldData);
        const isLive: boolean = !!fieldData.liveupdate;
        const displayType: string = fieldData.type ?? (Array.isArray(fieldData.value) ? "array" : typeof fieldData.value);

        return (
            <div key={fieldKey} className="config-field">
                <div className="config-field-header">
                    <div className="config-field-key">{fieldKey.charAt(0).toUpperCase() + fieldKey.slice(1).replaceAll("_", " ")}</div>
                    <div className="config-field-type">{displayType}</div>
                    <Tooltip id={`tooltip-${fieldKey}`} />
                    {isLive && (
                        <span className="config-field-live-badge" data-tooltip-content="Changes apply without restart" data-tooltip-id={`tooltip-${fieldKey}`}>
                            <Zap size={10} />
                            live
                        </span>
                    )}
                    {isDefault ? (
                        <span className="config-field-default-badge">default</span>
                    ) : (
                        <button className="config-field-restore" onClick={() => handleRestore(section, key)}>
                            <RotateCcw size={12} />
                            Restore
                        </button>
                    )}
                </div>
                {fieldData.comment && (
                    <div className="config-field-comment">{fieldData.comment}</div>
                )}
                {renderFieldInput(fieldData, v => handleChange(section, key, v))}
            </div>
        );
    }

    return (
        <div className="config-editor">
            <div className="config-editor-header">
                <div className="config-editor-header-left">
                    <div className="config-editor-title">{data.file}</div>
                    <div className="config-editor-subtitle">{data.file}.toml</div>
                </div>
                <div className="config-editor-header-right">
                    <button className="config-save-btn" onClick={handleSave} disabled={saving}>
                        <Save size={14} />
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
            </div>
            <div className="config-editor-body">
                {Object.entries(localData).map(([sectionKey, sectionVal]: [string, any]) => {
                    const isTopLevelField = sectionVal !== null && typeof sectionVal === "object" && "value" in sectionVal;

                    if (isTopLevelField) {
                        return (
                            <div key={sectionKey} className="config-group">
                                <div className="config-group-fields">
                                    {renderField(sectionKey, sectionVal, sectionKey, null)}
                                </div>
                            </div>
                        );
                    }

                    if (typeof sectionVal === "object" && !Array.isArray(sectionVal) && sectionVal !== null) {
                        return (
                            <div key={sectionKey} className="config-group">
                                <div className="config-group-title">{sectionKey.charAt(0).toUpperCase() + sectionKey.slice(1).replaceAll(".", " ")}</div>
                                <div className="config-group-fields">
                                    {Object.entries(sectionVal).map(([fieldKey, fieldData]: [string, any]) =>
                                        renderField(fieldKey, fieldData, sectionKey, fieldKey)
                                    )}
                                </div>
                            </div>
                        );
                    }

                    return null;
                })}
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
}

interface SearchGroup {
    file: string;
    matches: SearchMatch[];
}

function SearchResults({ groups, source }: { groups: SearchGroup[]; source: string }) {
    if (groups.length === 0) {
        return (
            <div className="config-main-empty">
                <Search className="config-empty-icon" />
                <p className="config-empty-text">No matching config keys found</p>
            </div>
        );
    }

    return (
        <div className="config-search-results">
            {groups.map(group => (
                <div key={group.file} className="config-group">
                    <div className="config-group-title">
                        {getConfigIcon(group.file)}
                        {group.file}.toml
                        <span className="config-search-source-badge">{source}</span>
                    </div>
                    <div className="config-group-fields">
                        {group.matches.map(match => {
                            const displayType = match.type ?? (Array.isArray(match.value) ? "array" : typeof match.value);
                            return (
                                <div key={match.key} className="config-field config-field-readonly">
                                    <div className="config-field-header">
                                        <div className="config-field-key">{match.key.charAt(0).toUpperCase() + match.key.slice(1).replaceAll(".", " ")}</div>
                                        <div className="config-field-type">{displayType}</div>
                                        {match.liveupdate && (
                                            <span className="config-field-live-badge" title="Changes apply without restart">
                                                <Zap size={10} />
                                                live
                                            </span>
                                        )}
                                    </div>
                                    {match.comment && (
                                        <div className="config-field-comment">{match.comment}</div>
                                    )}
                                    <div className="config-field-search-value">
                                        <span className="config-field-search-label">value</span>
                                        <span className="config-field-search-val">{JSON.stringify(match.value)}</span>
                                        {match.default !== undefined && match.value !== match.default && (
                                            <>
                                                <span className="config-field-search-label">default</span>
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
    const [configList, setConfigList] = useState<{ backend: string[]; frontend: string[] } | null>(cachedConfigList);
    const [selected, setSelected] = useState<{ file: string; source: string } | null>(null);
    const [configData, setConfigData] = useState<any>(null);
    const [search, setSearch] = useState("");
    const [showAC, setShowAC] = useState(false);
    const [acItems, setAcItems] = useState<string[]>([]);
    const [searchResults, setSearchResults] = useState<SearchGroup[] | null>(null);
    const [searchSource, setSearchSource] = useState<string>("backend");
    const [searchLoading, setSearchLoading] = useState(false);
    const searchRef = useRef<HTMLInputElement>(null);
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (configList) return;
        loadConfigList().then(setConfigList);
    }, []);

    useEffect(() => {
        if (!selected) return;
        setConfigData(null);
        const params = new URLSearchParams({ file: selected.file });
        if (selected.source === "frontend") params.set("source", "frontend");
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
                if (searchSource === "frontend") params.set("source", "frontend");
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

    const allBackend = (configList?.backend ?? []).map(f => ({ file: f, source: "backend" }));
    const allFrontend = (configList?.frontend ?? []).map(f => ({ file: f, source: "frontend" }));

    function filterList(list: { file: string; source: string }[]) {
        if (!search || search.includes(":")) return list;
        const lower = search.toLowerCase();
        return list.filter(c => c.file.toLowerCase().includes(lower));
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

    let mainContent: React.ReactNode;
    if (isFieldSearch) {
        if (searchLoading) {
            mainContent = (
                <div className="config-main-empty">
                    <p className="config-empty-text">Searching…</p>
                </div>
            );
        } else if (searchResults !== null) {
            mainContent = <SearchResults groups={searchResults} source={searchSource} />;
        } else {
            mainContent = (
                <div className="config-main-empty">
                    <Search className="config-empty-icon" />
                    <p className="config-empty-text">Type a value after the colon to search</p>
                </div>
            );
        }
    } else if (!selected) {
        mainContent = (
            <div className="config-main-empty">
                <FileSliders className="config-empty-icon" />
                <p className="config-empty-text">Select a config file to edit</p>
            </div>
        );
    } else if (!configData) {
        mainContent = (
            <div className="config-main-empty">
                <p className="config-empty-text">Loading…</p>
            </div>
        );
    } else {
        mainContent = <ConfigEditor data={configData} />;
    }

    return (
        <div className="config-section">
            <div className="config-warning">
                <TriangleAlert className="config-warning-icon" />
                <p className="config-warning-text">These settings are advanced settings, you should not modify it unless you know what you are doing.</p>
            </div>
            <div className="config-section-content">
                <div className="config-section-sidebar">
                    <div className="config-search-wrapper">
                        <Search className="config-search-icon" />
                        <input
                            ref={searchRef}
                            className="config-search"
                            placeholder="Search… (e.g. type:string)"
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
                            {["backend", "frontend"].map(src => (
                                <button
                                    key={src}
                                    className={`config-search-source-btn${searchSource === src ? " active" : ""}`}
                                    onClick={() => setSearchSource(src)}
                                >
                                    {src}
                                </button>
                            ))}
                        </div>
                    )}

                    {allBackend.length > 0 && (
                        <>
                            <div className="config-sidebar-group-label">Backend</div>
                            {backendFiltered.map(c => (
                                <div
                                    key={c.file}
                                    className={`config-section-sidebar-item${selected?.file === c.file && selected?.source === c.source ? " active" : ""}`}
                                    onClick={() => { setSelected(c); setSearch(""); setSearchResults(null); }}
                                >
                                    {getConfigIcon(c.file)}
                                    <div className="config-section-sidebar-item-info">
                                        <div className="config-section-sidebar-item-info-filename">{c.file}</div>
                                        <div className="config-section-sidebar-item-info-file">{c.file}.toml</div>
                                    </div>
                                </div>
                            ))}
                        </>
                    )}

                    {allFrontend.length > 0 && (
                        <>
                            <div className="config-sidebar-group-label">Frontend</div>
                            {frontendFiltered.map(c => (
                                <div
                                    key={c.file}
                                    className={`config-section-sidebar-item${selected?.file === c.file && selected?.source === c.source ? " active" : ""}`}
                                    onClick={() => { setSelected(c); setSearch(""); setSearchResults(null); }}
                                >
                                    {getConfigIcon(c.file)}
                                    <div className="config-section-sidebar-item-info">
                                        <div className="config-section-sidebar-item-info-filename">{c.file}</div>
                                        <div className="config-section-sidebar-item-info-file">{c.file}.toml</div>
                                    </div>
                                </div>
                            ))}
                        </>
                    )}
                </div>

                <div className="config-main">
                    {mainContent}
                </div>
            </div>
        </div>
    );
}

export default Config;