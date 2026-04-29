import '../styles/settings/Plugins.css';
import { useState, useEffect } from 'react';
import api from '../modules/api';
import { EllipsisVertical, Package } from 'lucide-react';

async function loadPlugins() {
    return await api('/info/plugins') as { backend: any[]; frontend: any[] };
}

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

async function loadPluginIcon(folder: string, file: string): Promise<string> {
    const res = await api(`/info/plugin-file?plugin=${encodeURIComponent(folder)}&file=${encodeURIComponent(file)}&frontend=false`) as { data: string; mime_type: string };
    return `data:${res.mime_type};base64,${res.data}`;
}

function Plugins() {
    const [plugins, setPlugins] = useState<ReturnType<typeof groupPlugins>>([]);
    const [icons, setIcons] = useState<Record<string, string>>({});
    const [openMenu, setOpenMenu] = useState<string | null>(null);

    useEffect(() => {
        loadPlugins().then(data => setPlugins(groupPlugins(data)));
    }, []);

    useEffect(() => {
        Promise.all(
            plugins
                .filter(p => p.icon)
                .map(p =>
                    loadPluginIcon(p.folder, p.icon!).then(url => [p.folder, url] as [string, string]).catch(() => null)
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

    return (
        <div className='plugins-section'>
            <div className='plugins-grid'>
                {plugins.map(plugin => (
                    <div key={plugin.folder} className='plugin-card'>
                        {plugin.description && (
                            <p className='plugin-description'>{plugin.description}</p>
                        )}
                        <div className='plugin-footer'>
                            {icons[plugin.folder] ? (
                                <img
                                    className='plugin-icon'
                                    src={icons[plugin.folder]}
                                    alt={plugin.name}
                                />
                            ) : (
                                <div className='plugin-icon plugin-icon--placeholder'><Package className='plugin-icon--placeholder-icon' /></div>
                            )}
                            <div className='plugin-info'>
                                <span className='plugin-name'>{plugin.name}@{plugin.author}</span>
                                <a className='plugin-author link' href={'https://omniplayr.wokki20.nl/packages/profile/' + plugin.author} target="_blank">{plugin.author}</a>
                            </div>
                            <div className='plugin-badges'>
                                {plugin.hasBackend && (
                                    <span className='badge badge--backend'>
                                        Backend v{plugin.backendVersion}
                                    </span>
                                )}
                                {plugin.hasFrontend && (
                                    <span className='badge badge--frontend'>
                                        Frontend v{plugin.frontendVersion}
                                    </span>
                                )}
                            </div>
                        </div>
                        <EllipsisVertical
                            className='plugin-menu-icon'
                            onClick={() => setOpenMenu(openMenu === plugin.folder ? null : plugin.folder)}
                        />
                        <div className={`plugin-menu${openMenu === plugin.folder ? ' plugin-menu--open' : ''}`}>
                            <a className='plugin-menu-item' href={'https://omniplayr.wokki20.nl/packages/package/' + plugin.folder} target="_blank">
                                <Package className='plugin-menu-item-icon'/>
                                <span className='plugin-menu-item-name'>View on Registry</span>
                            </a>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default Plugins;