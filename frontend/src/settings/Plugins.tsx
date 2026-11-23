
import '../styles/settings/Plugins.css';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../modules/api';
import { EllipsisVertical, Package, Plus, RotateCcw, Search, Trash } from 'lucide-react';
import { Tooltip } from 'react-tooltip';
import { getPluginsMenuItems } from '../modules/plugins';
import { getConfig } from '../modules/config';
import { createPopup } from '../modules/PopupContext';

async function loadPlugins() {
    return await api('/info/plugins') as { backend: any[]; frontend: any[] };
}

async function loadServerInfo() {
    return await api('/info/server') as any;
}

const EMPTY_DESCRIPTION_MESSAGES = [
    'Nothing to see here… yet.',
    'Description coming soon.',
    'Still figuring out what to write here.',
    'This space is intentionally left blank.',
    'No description has been added.',
    'Work in progress...',
    'Just vibes, no description.',
    'Silence speaks louder than words.',
    'Description not found.',
];

function groupPlugins(data: { backend: any[]; frontend: any[] }) {
    const map = new Map<string, { backend: any | null; frontend: any | null }>();

    for (const plugin of data.backend) {
        map.set(plugin.folder, { backend: plugin, frontend: null });
    }

    for (const plugin of data.frontend) {
        if (map.has(plugin.folder)) {
            map.get(plugin.folder)!.frontend = plugin;
        } else {
            map.set(plugin.folder, { backend: null, frontend: plugin });
        }
    }

    return Array.from(map.entries()).map(([folder, { backend, frontend }]) => {
        const base = (backend ?? frontend)!.package;

        return {
            folder,
            packageId: String(base.package_id ?? base.packageId ?? base.id ?? folder),
            name: base.name,
            description: base.description,
            author: base.author,
            repository: base.repository ?? null,
            homepage: base.homepage ?? null,
            contributors: base.contributors ?? [],
            icon: base.icon ?? null,
            banner: base.banner ?? null,
            hasBackend: !!backend,
            hasFrontend: !!frontend,
            backendVersion: backend?.package.version ?? null,
            frontendVersion: frontend?.package.version ?? null,
            pythonDependencies: backend?.package.pythonDependencies ?? {},
            dependencies: frontend?.package.dependencies ?? {},
        };
    });
}

function readConstraint(pkg: any, type: 'backend' | 'frontend', name: string): string | null {
    const normalizedName = name.replaceAll('-', '_');
    const candidates = [
        pkg?.[type]?.[name],
        pkg?.[type]?.[normalizedName],
        pkg?.[type]?.[`${name}s`],
        pkg?.[type]?.[`${normalizedName}s`],
        pkg?.[`${type}_${normalizedName}`],
        pkg?.[`${type}-${name}`],
        pkg?.[`${type}_${normalizedName}s`],
        pkg?.[`${type}-${name}s`],
        pkg?.[name],
        pkg?.[normalizedName],
        pkg?.[`${name}s`],
        pkg?.[`${normalizedName}s`],
        pkg?.latest?.[type]?.[normalizedName],
        pkg?.latest?.[type]?.[name],
    ];

    const value = candidates.find(v => typeof v === 'string' && v.trim());
    return value ? value.trim() : null;
}

function versionParts(version?: string | null): number[] {
    const base = String(version ?? '0.0.0').split('-', 1)[0];
    const parts: number[] = [];

    for (const raw of base.split('.')) {
        const digits = raw.replace(/\D/g, '');
        if (!digits) break;
        parts.push(Number(digits));
    }

    return parts.length ? parts : [0];
}

function compareVersions(left?: string | null, right?: string | null): number {
    const leftParts = versionParts(left);
    const rightParts = versionParts(right);
    const length = Math.max(leftParts.length, rightParts.length);

    while (leftParts.length < length) leftParts.push(0);
    while (rightParts.length < length) rightParts.push(0);

    for (let i = 0; i < length; i += 1) {
        if (leftParts[i] < rightParts[i]) return -1;
        if (leftParts[i] > rightParts[i]) return 1;
    }

    return 0;
}

function checkTypeCompatibility(
    pkg: any,
    type: 'backend' | 'frontend',
    current: { safeVersion: string; branch: string } | null,
    t: ReturnType<typeof useTranslation>['t'],
): string | null {
    if (!current) return null;

    const currentVersion = current.safeVersion;
    const isDev = current.branch === 'dev' || currentVersion.includes('dev');
    const minVersion = readConstraint(pkg, type, 'min-version');
    const maxVersion = readConstraint(pkg, type, 'max-version');
    const minDevVersion = readConstraint(pkg, type, 'min-dev-version');
    const maxDevVersion = readConstraint(pkg, type, 'max-dev-version');

    if (minVersion && compareVersions(currentVersion, minVersion) < 0) {
        return t('settings.plugins.compat.min_version', { type, version: minVersion, current: currentVersion });
    }

    if (maxVersion && compareVersions(currentVersion, maxVersion) > 0) {
        return t('settings.plugins.compat.max_version', { type, version: maxVersion, current: currentVersion });
    }

    if (isDev && minDevVersion && compareVersions(currentVersion, minDevVersion) < 0) {
        return t('settings.plugins.compat.min_dev_version', { type, version: minDevVersion, current: currentVersion });
    }

    if (isDev && maxDevVersion && compareVersions(currentVersion, maxDevVersion) > 0) {
        return t('settings.plugins.compat.max_dev_version', { type, version: maxDevVersion, current: currentVersion });
    }

    return null;
}

function getCompatibilityError(
    pkg: any,
    currentVersions: { backend: { safeVersion: string; branch: string } | null; frontend: { safeVersion: string; branch: string } },
    t: ReturnType<typeof useTranslation>['t'],
): string | null {
    const hasBackend = !pkg.types || pkg.types.includes?.('backend') || !!pkg.backend_version || !!pkg.latest?.backend;
    const hasFrontend = !pkg.types || pkg.types.includes?.('frontend') || !!pkg.frontend_version || !!pkg.latest?.frontend;

    if (hasBackend) {
        const backendError = checkTypeCompatibility(pkg, 'backend', currentVersions.backend, t);
        if (backendError) return backendError;
    }

    if (hasFrontend) {
        const frontendError = checkTypeCompatibility(pkg, 'frontend', currentVersions.frontend, t);
        if (frontendError) return frontendError;
    }

    return null;
}

async function loadPluginIcon(folder: string, file: string): Promise<string> {
    const res = await api(`/info/plugin-file?plugin=${encodeURIComponent(folder)}&file=${encodeURIComponent(file)}&frontend=false`) as { data: string; mime_type: string };
    return `data:${res.mime_type};base64,${res.data}`;
}

type DeletePluginSelection = {
    frontend: boolean;
    backend: boolean;
};

function pluginHasComponent(plugin: any, component: 'frontend' | 'backend') {
    const values = [
        plugin?.[component],
        plugin?.[`${component}_version`],
        plugin?.[`${component}Version`],
        plugin?.[`has_${component}`],
        plugin?.[`has${component.charAt(0).toUpperCase()}${component.slice(1)}`],
        plugin?.components?.[component],
        plugin?.versions?.[component],
        plugin?.manifest?.[component],
        plugin?.manifest?.components?.[component],
    ];

    return values.some(value =>
        value !== undefined &&
        value !== null &&
        value !== false &&
        value !== ''
    );
}

function Plugins({ isAdmin }: { isAdmin: boolean }) {
    const { t } = useTranslation();

    const [plugins, setPlugins] = useState<ReturnType<typeof groupPlugins>>([]);
    const [icons, setIcons] = useState<Record<string, string>>({});
    const [openMenu, setOpenMenu] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [searching, setSearching] = useState(false);
    const [packages, setPackages] = useState<any[]>([]);
    const [query, setQuery] = useState('');
    const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [installingPkgs, setInstallingPkgs] = useState<Record<string, boolean>>({});
    const [needsRestart, setNeedsRestart] = useState(false);
    const [backendVersion, setBackendVersion] = useState<{ safeVersion: string; branch: string } | null>(null);

    const frontendVersion = useMemo(() => ({
        safeVersion: String(getConfig('version.frontend.safeVersion', '0.0.0')),
        branch: String(getConfig('version.frontend.branch', 'main')),
    }), []);

    const randomDescription = useMemo(() => {
        return EMPTY_DESCRIPTION_MESSAGES[Math.floor(Math.random() * EMPTY_DESCRIPTION_MESSAGES.length)];
    }, []);

    async function fetchPlugins() {
        try {
            const data = await loadPlugins();
            setPlugins(groupPlugins(data));
        } catch (error) {
            console.error('Failed to fetch installed plugins:', error);
        }
    }

    async function handleInstallPackage(packageId: string) {
        if (!isAdmin) return;

        setInstallingPkgs(prev => ({ ...prev, [packageId]: true }));

        try {
            await api(`/plugins/install?package_id=${encodeURIComponent(packageId)}`, {
                method: 'POST',
            });

            await fetchPlugins();
            setNeedsRestart(true);
        } catch (error) {
            showPluginActionError(error);
        } finally {
            setInstallingPkgs(prev => ({ ...prev, [packageId]: false }));
        }
    }

    function showPluginActionError(error: any) {
        const message =
            typeof error === 'string'
                ? error
                : error?.detail ?? error?.message ?? 'The operation could not be completed.';

        createPopup({
            id: 'plugin-operation-error',
            title: 'Plugin operation failed',
            content: (
                <div className="delete-plugin">
                    <p className="delete-plugin__message-text">{message}</p>
                </div>
            ),
            close_button: true,
            buttons: [
                {
                    label: 'Close',
                    type: 'danger',
                    onClick: () => {},
                },
            ],
        });
    }

    useEffect(() => {
        void fetchPlugins();
    }, []);

    useEffect(() => {
        loadServerInfo()
            .then(data => {
                if (!data?.error) {
                    setBackendVersion({
                        safeVersion: String(data.safeVersion ?? data.version ?? '0.0.0'),
                        branch: String(data.branch ?? 'main'),
                    });
                }
            })
            .catch(() => setBackendVersion(null));
    }, []);

    useEffect(() => {
        Promise.all(
            plugins
                .filter(p => p.icon)
                .map(p =>
                    loadPluginIcon(p.folder, p.icon!)
                        .then(url => [p.folder, url] as [string, string])
                        .catch(() => null)
                )
        ).then(results => {
            setIcons(Object.fromEntries(results.filter(Boolean) as [string, string][]));
        });
    }, [plugins]);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (!(e.target as Element).closest('.plugin-menu') && !(e.target as Element).closest('.plugin-menu-icon')) {
                setOpenMenu(null);
            }
        }

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    function timeAgo(dateStr: string): string {
        const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);

        if (seconds < 60) return t('common.timeAgo.justNow');
        if (seconds < 3600) return t('common.timeAgo.minutes', { count: Math.floor(seconds / 60) });
        if (seconds < 86400) return t('common.timeAgo.hours', { count: Math.floor(seconds / 3600) });
        if (seconds < 604800) return t('common.timeAgo.days', { count: Math.floor(seconds / 86400) });
        if (seconds < 2592000) return t('common.timeAgo.weeks', { count: Math.floor(seconds / 604800) });
        if (seconds < 31536000) return t('common.timeAgo.months', { count: Math.floor(seconds / 2592000) });

        return t('common.timeAgo.years', { count: Math.floor(seconds / 31536000) });
    }

    function formatDate(dateStr: string): string {
        return new Date(dateStr).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    }

    useEffect(() => {
        if (!isAdmin) return;

        fetch('https://omniplayr.wokki20.nl/api/top_packages.php')
            .then(res => res.json())
            .then(data => {
                setPackages(data.packages ?? []);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (!isAdmin) return;

        if (searchTimeout.current) clearTimeout(searchTimeout.current);

        if (!query.trim()) {
            setSearching(false);
            setLoading(true);

            fetch('https://omniplayr.wokki20.nl/api/top_packages.php')
                .then(res => res.json())
                .then(data => {
                    setPackages(data.packages ?? []);
                    setLoading(false);
                })
                .catch(() => setLoading(false));

            return;
        }

        setSearching(true);

        searchTimeout.current = setTimeout(() => {
            fetch('https://omniplayr.wokki20.nl/api/search_packages.php?q=' + encodeURIComponent(query.trim()))
                .then(res => res.json())
                .then(data => {
                    setPackages(data.packages ?? []);
                    setSearching(false);
                })
                .catch(() => setSearching(false));
        }, 300);

        return () => {
            if (searchTimeout.current) clearTimeout(searchTimeout.current);
        };
    }, [query]);

    const isLoading = loading || searching;
    const currentVersions = { backend: backendVersion, frontend: frontendVersion };

    function DeletePluginNode({ plugin, selection }: {
        plugin: any;
        selection: DeletePluginSelection;
    }) {
        const hasFrontend = pluginHasComponent(plugin, 'frontend');
        const hasBackend = pluginHasComponent(plugin, 'backend');

        return (
            <div className="delete-plugin">
                <div className="delete-plugin__message">
                    <p className="delete-plugin__message-text">
                        {t('settings.plugins.popup.delete.message', {
                            plugin: `${plugin.name}@${plugin.author}`,
                        })}
                    </p>
                </div>

                {hasFrontend && hasBackend && (
                    <div className="delete-plugin__components">
                        <p className="delete-plugin__components-title">
                            {t('settings.plugins.popup.delete.components')}
                        </p>

                        <div className="delete-plugin__component-list">
                            <label className="delete-plugin__component">
                                <input
                                    className="delete-plugin__checkbox"
                                    type="checkbox"
                                    defaultChecked
                                    onChange={e => {
                                        selection.frontend = e.currentTarget.checked;
                                    }}
                                />
                                <span className="delete-plugin__component-label">
                                    {t('settings.plugins.popup.delete.frontend')}
                                </span>
                            </label>

                            <label className="delete-plugin__component">
                                <input
                                    className="delete-plugin__checkbox"
                                    type="checkbox"
                                    defaultChecked
                                    onChange={e => {
                                        selection.backend = e.currentTarget.checked;
                                    }}
                                />
                                <span className="delete-plugin__component-label">
                                    {t('settings.plugins.popup.delete.backend')}
                                </span>
                            </label>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    function RemovePluginDataNode({ plugin }: { plugin: any }) {
        return (
            <div className="remove-plugin-data">
                <div className="remove-plugin-data__message">
                    <p className="remove-plugin-data__message-text">
                        {t('settings.plugins.popup.data-remove.message', {
                            plugin: `${plugin.name}@${plugin.author}`,
                        })}
                    </p>
                </div>
            </div>
        );
    }

    function getSelectedPluginTarget(
        plugin: any,
        selection: DeletePluginSelection
    ): 'frontend' | 'backend' | null | undefined {
        const targets: ('frontend' | 'backend')[] = [];

        if (pluginHasComponent(plugin, 'frontend') && selection.frontend) {
            targets.push('frontend');
        }

        if (pluginHasComponent(plugin, 'backend') && selection.backend) {
            targets.push('backend');
        }

        if (targets.length === 0) return null;
        if (targets.length === 2) return undefined;

        return targets[0];
    }

    async function executePluginRemoval(
        plugin: any,
        selection: DeletePluginSelection,
        deleteData: boolean
    ) {
        if (!isAdmin) return;

        const hasBackend = pluginHasComponent(plugin, 'backend');
        const selectedBackend = hasBackend && selection.backend;
        const target = getSelectedPluginTarget(plugin, selection);

        if (target === null) {
            showPluginActionError('Select at least one plugin component to remove.');
            return;
        }

        if (deleteData && hasBackend && !selectedBackend) {
            showPluginActionError(
                'The backend component must also be selected when deleting plugin data.'
            );
            return;
        }

        const params = new URLSearchParams({
            package_id: plugin.packageId ?? plugin.folder,
            delete_data: String(deleteData && selectedBackend),
        });

        if (target) {
            params.set('target', target);
        }

        setOpenMenu(null);

        try {
            const result = await api(
                `/plugins/remove?${params.toString()}`,
                { method: 'DELETE' }
            ) as any;

            await fetchPlugins();

            if (result?.backend_restart_required) {
                setNeedsRestart(true);
            }

            if (result?.frontend_rebuild_scheduled) {
                setNeedsRestart(true);
            }

            const failures = Array.isArray(result?.results)
                ? result.results.filter((entry: any) => entry.status === 'failed')
                : [];

            if (failures.length > 0) {
                showPluginActionError(
                    failures.map((entry: any) => `${entry.type}: ${entry.reason}`).join('\n')
                );
            }
        } catch (error) {
            showPluginActionError(error);
        }
    }

    async function clearPluginData(plugin: any) {
        if (!isAdmin || !pluginHasComponent(plugin, 'backend')) return;

        const params = new URLSearchParams({
            package_id: plugin.packageId ?? plugin.folder,
        });

        setOpenMenu(null);

        try {
            const result = await api(
                `/plugins/clear-data?${params.toString()}`,
                { method: 'DELETE' }
            ) as any;

            await fetchPlugins();

            console.log(`Cleared ${result?.table_count ?? 0} plugin database table(s)`);
        } catch (error) {
            showPluginActionError(error);
        }
    }

    function deletePlugin(plugin: any) {
        if (!isAdmin) return;

        const hasFrontend = pluginHasComponent(plugin, 'frontend');
        const hasBackend = pluginHasComponent(plugin, 'backend');

        const selection: DeletePluginSelection = {
            frontend: hasFrontend,
            backend: hasBackend,
        };

        setOpenMenu(null);

        createPopup({
            id: 'delete-plugin',
            title: t('settings.plugins.popup.delete.title', {
                plugin: `${plugin.name}@${plugin.author}`,
            }),
            content: (
                <DeletePluginNode
                    plugin={plugin}
                    selection={selection}
                />
            ),
            close_button: true,
            buttons: [
                {
                    label: t('settings.plugins.popup.delete.plugin.delete-only'),
                    type: 'danger',
                    onClick: () => executePluginRemoval(plugin, selection, false),
                },
                {
                    label: t('settings.plugins.popup.delete.plugin.delete'),
                    type: 'danger-secondary',
                    onClick: () => executePluginRemoval(plugin, selection, true),
                },
            ],
        });
    }

    function removePluginData(plugin: any) {
        if (!isAdmin || !pluginHasComponent(plugin, 'backend')) return;

        setOpenMenu(null);

        createPopup({
            id: 'remove-plugin-data',
            title: t('settings.plugins.popup.data-remove.title', {
                plugin: `${plugin.name}@${plugin.author}`,
            }),
            content: (
                <RemovePluginDataNode plugin={plugin} />
            ),
            close_button: true,
            buttons: [
                {
                    label: t('settings.plugins.popup.data-remove.confirm'),
                    type: 'danger',
                    onClick: () => clearPluginData(plugin),
                },
            ],
        });
    }

    return (
        <div className="plugins-section">
            <Tooltip id="plugin-compat-tooltip" />

            {needsRestart && (
                <div className="restart-banner">
                    <span className="restart-banner-text">
                        {t('settings.plugins.restart_banner')}
                    </span>
                </div>
            )}

            <p className="section-title">{t('settings.plugins.installed_title')}</p>

            <div className="plugins-grid">
                {plugins.map(plugin => {
                    const pluginMenuItems = getPluginsMenuItems().filter(
                        item => item.id === plugin.folder && (!item.adminOnly || isAdmin)
                    );

                    return (
                        <div key={plugin.folder} className="plugin-card">
                            {plugin.description && (
                                <p className="plugin-description">{plugin.description}</p>
                            )}

                            <div className="plugin-footer">
                                {icons[plugin.folder] ? (
                                    <img
                                        className="plugin-icon"
                                        src={icons[plugin.folder]}
                                        alt={plugin.name}
                                    />
                                ) : (
                                    <div className="plugin-icon plugin-icon--placeholder">
                                        <Package className="plugin-icon--placeholder-icon" />
                                    </div>
                                )}

                                <div className="plugin-info">
                                    <span className="plugin-name">{plugin.name}@{plugin.author}</span>
                                    <a
                                        className="plugin-author link"
                                        href={'https://omniplayr.wokki20.nl/packages/profile/' + plugin.author}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        {plugin.author}
                                    </a>
                                </div>

                                <div className="plugin-badges">
                                    {plugin.hasBackend && (
                                        <span className="badge badge--backend">
                                            {t('settings.plugins.badge.backend_version', {
                                                version: plugin.backendVersion,
                                            })}
                                        </span>
                                    )}

                                    {plugin.hasFrontend && (
                                        <span className="badge badge--frontend">
                                            {t('settings.plugins.badge.frontend_version', {
                                                version: plugin.frontendVersion,
                                            })}
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="plugin-menu-button-container">
                                <EllipsisVertical
                                    className="plugin-menu-icon"
                                    onClick={() => setOpenMenu(openMenu === plugin.folder ? null : plugin.folder)}
                                />

                                {pluginMenuItems.length > 0 && pluginMenuItems.some(item => item.needsInteraction) && (
                                    <span className="update-badge">!</span>
                                )}
                            </div>

                            <div className={`plugin-menu${openMenu === plugin.folder ? ' plugin-menu--open' : ''}`}>
                                <a
                                    className="plugin-menu-item"
                                    href={'https://omniplayr.wokki20.nl/packages/package/' + plugin.folder}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    <Package className="plugin-menu-item-icon" />
                                    <span className="plugin-menu-item-name">
                                        {t('settings.plugins.menu.view_registry')}
                                    </span>
                                </a>

                                {isAdmin && (
                                    <>
                                        <div className="plugin-menu-divider" />

                                        <a
                                            className="plugin-menu-item danger"
                                            onClick={() => deletePlugin(plugin)}
                                        >
                                            <Trash className="plugin-menu-item-icon" />
                                            <span className="plugin-menu-item-name">
                                                {t('settings.plugins.menu.delete')}
                                            </span>
                                        </a>

                                        {plugin.hasBackend && (
                                            <a
                                                className="plugin-menu-item danger"
                                                onClick={() => removePluginData(plugin)}
                                            >
                                                <RotateCcw className="plugin-menu-item-icon" />
                                                <span className="plugin-menu-item-name">
                                                    {t('settings.plugins.menu.data-remove')}
                                                </span>
                                            </a>
                                        )}
                                    </>
                                )}

                                {pluginMenuItems.length > 0 && (
                                    <div className="plugin-menu-divider" />
                                )}

                                {pluginMenuItems.map((item, index) => {
                                    const Icon = item.icon as any;

                                    return item.view ? (
                                        <a
                                            key={index}
                                            className="plugin-menu-item"
                                            onClick={() => {
                                                console.log(item.view);
                                            }}
                                        >
                                            <Icon className="plugin-menu-item-icon" />

                                            <span className="plugin-menu-item-name">
                                                <span>{item.label}</span>
                                                {item.needsInteraction && <span className="update-badge">!</span>}
                                            </span>
                                        </a>
                                    ) : (
                                        <a
                                            key={index}
                                            className="plugin-menu-item"
                                            onClick={() => item.function?.()}
                                        >
                                            <Icon className="plugin-menu-item-icon" />

                                            <span className="plugin-menu-item-name">
                                                <span>{item.label}</span>
                                                {item.needsInteraction && <span className="update-badge">!</span>}
                                            </span>
                                        </a>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {isAdmin && (
                <div className="plugins-install">
                    <p className="section-title">{t('settings.plugins.install_title')}</p>

                    <div className="search-bar">
                        <Search className="search-plugins-icon" />

                        <input
                            type="text"
                            className="search-plugins-input"
                            placeholder={t('settings.plugins.search_placeholder')}
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                        />
                    </div>

                    <div className="plugins-result-list">
                        <p className="section-subtitle">
                            {query.trim()
                                ? t('settings.plugins.search_results')
                                : t('settings.plugins.top_packages')}
                        </p>

                        {isLoading ? (
                            <p className="packages-status">{t('common.loading')}</p>
                        ) : packages.length === 0 ? (
                            <p className="packages-status">{t('settings.plugins.no_packages')}</p>
                        ) : (
                            <div className="profile-packages-list">
                                {packages.map((pkg: any) => (
                                    <div key={pkg.package_id} className="profile-package">
                                        <div className="profile-package-info">
                                            {pkg.icon ? (
                                                <img
                                                    src={pkg.icon}
                                                    alt={pkg.package_id}
                                                    className="profile-package-icon"
                                                />
                                            ) : (
                                                <Package className="profile-package-icon no-icon" />
                                            )}

                                            <div className="profile-package-name-versions">
                                                <p
                                                    className="profile-package-name"
                                                    onClick={() => window.open(
                                                        'https://omniplayr.wokki20.nl/packages/package/' + pkg.package_id,
                                                        '_blank'
                                                    )}
                                                >
                                                    {pkg.package_id}
                                                </p>

                                                <div className="profile-package-versions">
                                                    {pkg.backend_version && (
                                                        <span className="profile-package-version backend">
                                                            B {pkg.backend_version}
                                                        </span>
                                                    )}

                                                    {pkg.frontend_version && (
                                                        <span className="profile-package-version frontend">
                                                            F {pkg.frontend_version}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <p className={`profile-package-description ${pkg.description ? '' : 'not-found'}`}>
                                            {pkg.description || randomDescription}
                                        </p>

                                        <div className="profile-package-more-info">
                                            <p
                                                className="profile-package-author"
                                                onClick={() => window.open(
                                                    'https://omniplayr.wokki20.nl/packages/profile/' + pkg.author,
                                                    '_blank'
                                                )}
                                            >
                                                {pkg.author}
                                            </p>

                                            <p className="profile-package-updated">
                                                {formatDate(pkg.created_at)} - {timeAgo(pkg.created_at)}
                                            </p>

                                            {(() => {
                                                const installed = plugins.find(p => p.packageId === pkg.package_id || p.folder === pkg.package_id);

                                                const versionMatch =
                                                    (!pkg.backend_version || installed?.backendVersion === pkg.backend_version) &&
                                                    (!pkg.frontend_version || installed?.frontendVersion === pkg.frontend_version);

                                                const compatibilityError = getCompatibilityError(pkg, currentVersions, t);

                                                if (installed && versionMatch) {
                                                    return (
                                                        <span className="pkg-installed-badge">
                                                            {t('settings.plugins.badge.installed')}
                                                        </span>
                                                    );
                                                }

                                                return (
                                                    <span
                                                        className="pkg-install-btn-tooltip-wrap"
                                                        data-tooltip-id={compatibilityError ? 'plugin-compat-tooltip' : undefined}
                                                        data-tooltip-content={compatibilityError ?? undefined}
                                                    >
                                                        <button
                                                            className="pkg-install-btn"
                                                            onClick={() => handleInstallPackage(pkg.package_id)}
                                                            disabled={!!installingPkgs[pkg.package_id] || !!compatibilityError}
                                                        >
                                                            <Plus className="pkg-install-btn-icon" />

                                                            {t(
                                                                installingPkgs[pkg.package_id]
                                                                    ? 'settings.plugins.badge.installing'
                                                                    : installed
                                                                        ? 'settings.plugins.badge.update'
                                                                        : 'settings.plugins.badge.install'
                                                            )}
                                                        </button>
                                                    </span>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default Plugins;
