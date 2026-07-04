import '../styles/settings/About.css';
import api from '../modules/api';
import { useEffect, useRef, useState } from 'react';
import { getConfig } from '../modules/config';
import { ArrowRight, TriangleAlert, WifiOff, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next'; 

const GITHUB_CACHE_KEY = 'omniplayr_github_info';

async function loadServerInfo() {
    return await api('/info/server') as any[];
}

async function fetchGithub(branch: string) {
    async function fetchFile(path: string) {
        const res = await fetch(`https://api.github.com/repos/OmniPlayr/OmniPlayr-server/contents/${path}?ref=${branch}`);
        if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
        const data = await res.json();
        return atob(data.content.replace(/\n/g, ""));
    }

    async function fetchContributors() {
        const res = await fetch(`https://api.github.com/repos/OmniPlayr/OmniPlayr-server/contributors`);
        if (!res.ok) throw new Error(`Failed to fetch contributors: ${res.status}`);
        return await res.json();
    }

    const [backendConfigRaw, versionTomlRaw, licenseRaw, contributors] = await Promise.all([
        fetchFile("backend/config.json"),
        fetchFile("frontend/src/config/version.toml"),
        fetchFile("LICENSE"),
        fetchContributors()
    ]);

    const result = {
        backendConfig: JSON.parse(backendConfigRaw),
        versionToml: versionTomlRaw,
        license: licenseRaw,
        contributors
    };

    try {
        localStorage.setItem(GITHUB_CACHE_KEY, JSON.stringify(result));
    } catch {
    }

    return result;
}

function loadCachedGithub(): any | null {
    try {
        const raw = localStorage.getItem(GITHUB_CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function parseToml(toml: string): Record<string, any> {
    const result: Record<string, any> = {};
    let currentSection = result;

    for (const raw of toml.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;

        const sectionMatch = line.match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
            const parts = sectionMatch[1].split('.');
            let obj = result;
            for (const part of parts) {
                if (!obj[part]) obj[part] = {};
                obj = obj[part];
            }
            currentSection = obj;
            continue;
        }

        const kvMatch = line.match(/^(\w+)\s*=\s*(.+)$/);
        if (kvMatch) {
            const key = kvMatch[1];
            const raw = kvMatch[2].trim();
            if (raw.startsWith('"') && raw.endsWith('"')) {
                currentSection[key] = raw.slice(1, -1);
            } else if (!isNaN(Number(raw))) {
                currentSection[key] = Number(raw);
            } else {
                currentSection[key] = raw;
            }
        }
    }

    return result;
}

type UpdateLevel = 'year' | 'month' | 'bugfix' | null;

function getUpdateLevel(
    current: { year: number; month: number; bugfix: number },
    latest: { year: number; month: number; bugfix: number }
): UpdateLevel {
    if (latest.year > current.year) return 'year';
    if (latest.year === current.year && latest.month > current.month) return 'month';
    if (latest.year === current.year && latest.month === current.month && latest.bugfix > current.bugfix) return 'bugfix';
    return null;
}

interface VersionBlockProps {
    title: string;
    current: { year: number; month: number; bugfix: number; safeVersion: string };
    latest: { year: number; month: number; bugfix: number; safeVersion: string } | null;
}

function VersionBlock({ title, current, latest }: VersionBlockProps) {
    const updateLevel = latest ? getUpdateLevel(current, latest) : null;
    const isLatest = updateLevel === null;

    const { t } = useTranslation();

    const versionClass = ['about-version', updateLevel, !isLatest ? 'newer' : null]
        .filter(Boolean).join(' ');

    return (
        <div className={versionClass}>
            <h1 className='about-version-title'>{title}</h1>
            <p className='about-version-value'>
                <b>{t("settings.about.version.version")}</b>
                <span className='about-version-current'>{current.safeVersion}</span>
                {!isLatest && latest && (
                    <span className={`about-version-update ${updateLevel}`}>
                        <ArrowRight className='about-version-arrow' size={14} /> {latest.safeVersion}
                    </span>
                )}
                {isLatest && <span className='about-version-latest'>{t("settings.about.version.latest")}</span>}
            </p>
            <div className='about-version-divider' />
            <p className='about-version-value'>
                <b>{t("settings.about.version.year")}</b>
                <span className='about-version-current'>{current.year}</span>
                {latest && latest.year > current.year && (
                    <span className='about-version-update year'><ArrowRight className='about-version-arrow' size={14} /> {latest.year}</span>
                )}
            </p>
            <p className='about-version-value'>
                <b>{t("settings.about.version.month")}</b>
                <span className='about-version-current'>{current.month}</span>
                {latest && (latest.year > current.year || latest.month > current.month) && (
                    <span className='about-version-update month'><ArrowRight className='about-version-arrow' size={14} /> {latest.month}</span>
                )}
            </p>
            <p className='about-version-value'>
                <b>{t("settings.about.version.bugfix")}</b>
                <span className='about-version-current'>{current.bugfix}</span>
                {latest && updateLevel !== null && (
                    <span className='about-version-update bugfix'><ArrowRight className='about-version-arrow' size={14} /> {latest.bugfix}</span>
                )}
            </p>
        </div>
    );
}

function About({ updateAvailable, onRefreshCheck }: any) {
    const [serverInfo, setServerInfo] = useState<any>(null);
    const [githubInfo, setGithubInfo] = useState<any>(null);
    const [githubStale, setGithubStale] = useState(false);
    const githubFetched = useRef(false);
    const [loading, setLoading] = useState(false);

    const { t } = useTranslation();

    const navigate = useNavigate();

    const handleCheck = async () => {
        setLoading(true);
        await api("/update/check");
        onRefreshCheck(); 
        setLoading(false);
    };

    const handleApply = async () => {
        if (!confirm("The server will restart to apply the update. Proceed?")) return;
        setLoading(true);
        await api("/update/apply", {}, {});
        navigate("/updating");
    };

    useEffect(() => {
        loadServerInfo().then(setServerInfo);
    }, []);

    useEffect(() => {
        if (!serverInfo?.branch || githubFetched.current) return;
        githubFetched.current = true;

        fetchGithub(serverInfo.branch)
            .then(data => {
                setGithubInfo(data);
                setGithubStale(false);
            })
            .catch(() => {
                const cached = loadCachedGithub();
                if (cached) {
                    setGithubInfo(cached);
                    setGithubStale(true);
                }
            });
    }, [serverInfo]);
    

    const frontendSafeVersion = getConfig("version.frontend.safeVersion") as string;
    const frontendYear = getConfig("version.frontend.year") as number;
    const frontendMonth = getConfig("version.frontend.month") as number;
    const frontendBugfix = getConfig("version.frontend.bugfix") as number;
    const githubFrontend = githubInfo?.versionToml
        ? parseToml(githubInfo.versionToml)?.version?.frontend
        : null;

    const githubBackend = githubInfo?.backendConfig ?? null;

    const frontendCurrent = {
        year: frontendYear,
        month: frontendMonth,
        bugfix: frontendBugfix
    };

    const backendCurrent = serverInfo
        ? {
            year: serverInfo.year,
            month: serverInfo.month,
            bugfix: serverInfo.bugfix
        }
        : null;

    const frontendHasUpdate = githubFrontend
        ? getUpdateLevel(frontendCurrent, githubFrontend) !== null
        : false;

    const backendHasUpdate = githubBackend && backendCurrent
        ? getUpdateLevel(backendCurrent, githubBackend) !== null
        : false;

    const anyUpdateAvailable =
        updateAvailable || frontendHasUpdate || backendHasUpdate;

    return (
        <>
            <div className="about-version">
                <div className="about-version-title">{t("settings.about.update.title")}</div>
                <div className="about-version-divider" />
                <div className="about-version-value">
                    <b>{t("settings.about.update.status")}</b> 
                    {anyUpdateAvailable ? (
                        <span className="about-version-update month">{t("settings.about.update.available")}</span>
                    ) : (
                        t("settings.about.update.up_to_date")
                    )}
                </div>
                <div className="about-update-controls">
                    {anyUpdateAvailable ? (
                        <button className="btn-update primary" onClick={handleApply} disabled={loading}>
                            {loading && <RefreshCw className="loading-icon" size={14} />}
                            {t("settings.about.update.install")}
                        </button>
                    ) : (
                        <button className="btn-update secondary" onClick={handleCheck} disabled={loading}>
                            {loading && <RefreshCw className="loading-icon" size={14} />}
                            {t("settings.about.update.check")}
                        </button>
                    )}
                </div>
            </div>
            <div className="about-section">
                <div className='about-left'>
                    <h1 className='about-title'>{t("settings.about.version_credits")}</h1>
                    {githubStale && (
                        <div className='disclaimer-banner'>
                            <WifiOff className='disclaimer-icon' />
                            <span className='disclaimer-text'>{t("settings.about.github_stale")}</span>
                        </div>
                    )}
                    <div className='about-versions'>
                        <VersionBlock
                            title="Frontend"
                            current={{ year: frontendYear, month: frontendMonth, bugfix: frontendBugfix, safeVersion: frontendSafeVersion }}
                            latest={githubFrontend}
                        />
                        {serverInfo && (
                            <VersionBlock
                                title="Backend"
                                current={{ year: serverInfo.year, month: serverInfo.month, bugfix: serverInfo.bugfix, safeVersion: serverInfo.safeVersion }}
                                latest={githubBackend}
                            />
                        )}
                    </div>
                    {serverInfo?.branch === "dev" && (
                        <div className='disclaimer-banner'>
                            <TriangleAlert className='disclaimer-icon' />
                            <span className='disclaimer-text'>
                                <Trans
                                    i18nKey='settings.about.dev_warning'
                                    components={{ theme_link: <a href="https://github.com/OmniPlayr/OmniPlayr-server/issues" className='link' target="_blank" rel="noreferrer" />}}
                                />
                            </span>
                        </div>
                    )}
                    {githubInfo?.contributors && (
                        <div className='about-contributors'>
                            <h1 className='about-contributors-title'>{t("settings.about.contributors")}</h1>
                            <div className='about-contributors-list'>
                                {githubInfo.contributors.map((c: any) => (
                                    <a key={c.id} className='about-contributor' href={c.html_url} target='_blank' rel='noreferrer'>
                                        <img className='about-contributor-avatar' src={c.avatar_url} alt={c.login} />
                                        <span className='about-contributor-name'>{c.login}</span>
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
                <div className='about-right'>
                    <div className='about-license'>
                        <h1 className='about-license-title'>{t("settings.about.license")}</h1>
                        <div className='about-license-content'>
                            {githubInfo?.license
                                ? <pre className='about-license-text'>{githubInfo.license}</pre>
                                : <span className='about-license-loading'>{t("settings.about.license.loading")}</span>
                            }
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

export default About;