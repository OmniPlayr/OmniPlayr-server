import {
    Blocks,
    Info,
    Palette,
    SettingsIcon,
    User,
    ArrowLeft,
    SunMoon,
    CaseSensitive,
    Power,
    FileText,
    Users,
    Terminal as TerminalIcon,
    Languages,
    KeyRound,
    CodeXml
} from "lucide-react";

import './styles/Settings.css';
import { useLocation, useNavigate } from "react-router-dom";
import Theme from "./settings/Theme";
import Fonts from "./settings/Fonts";
import About from "./settings/About";
import Logs from "./settings/Logs";
import PowerOptions from "./settings/PowerOptions";
import TerminalPage from "./settings/Terminal";
import Colors from "./settings/Colors";
import Plugins from "./settings/Plugins";
import Profile from "./settings/Profile";
import Config from "./settings/Config";
import OtherPeople from "./settings/OtherPeople";
import Language from "./settings/Language";
import BackupCodes from "./settings/BackupCodes";
import { useTranslation } from 'react-i18next';
import { isDev } from './modules/dev';
import DeveloperOptions from "./settings/DeveloperOptions";

function Settings({ account, updateAvailable, onRefreshCheck, pluginsInteractionRequired }: any) {
    const navigate = useNavigate();
    const location = useLocation();

    const segments = location.pathname.split("/").filter(Boolean);
    const stack = segments.slice(1);

    const { t } = useTranslation();

    const isVisible = (tab: any) => {
        if (!tab.condition) return true;
        return tab.condition();
    };

    const rootTabs = [
        {
            id: "plugins",
            icon: Blocks,
            title: t("settings.tab.plugins"),
            description: t("settings.tab.plugins.desc"),
            component: () => <Plugins isAdmin={account?.role === "admin"} />
        },
        {
            id: "accounts",
            icon: User,
            title: t("settings.tab.people"),
            description: t("settings.tab.people.desc"),
        },
        {
            id: "appearance",
            icon: Palette,
            title: t("settings.tab.appearance"),
            description: t("settings.tab.appearance.desc"),
        },
        {
            id: "system",
            icon: SettingsIcon,
            title: t("settings.tab.system"),
            description: t("settings.tab.system.desc"),
            condition: () => account?.role === "admin"
        },
        {
            id: "about",
            icon: Info,
            title: t("settings.tab.about"),
            description: t("settings.tab.about.desc"),
            component: () => <About updateAvailable={updateAvailable} onRefreshCheck={onRefreshCheck} />
        },
        {
            id: "devoptions",
            icon: CodeXml,
            title: t("settings.tab.devoptions"),
            description: t("settings.tab.devoptions.desc"),
            condition: () => isDev,
            component: () => <DeveloperOptions />
        }
    ];

    const subTabs: Record<string, any[]> = {
        appearance: [
            {
                id: "theme",
                icon: SunMoon,
                title: t("settings.tab.appearance.theme"),
                description: t("settings.tab.appearance.theme.desc"),
                component: () => <Theme />
            },
            {
                id: "colors",
                icon: Palette,
                title: t("settings.tab.appearance.colors"),
                description: t("settings.tab.appearance.colors.desc"),
                component: () => <Colors />
            },
            {
                id: "fonts",
                icon: CaseSensitive,
                title: t("settings.tab.appearance.fonts"),
                description: t("settings.tab.appearance.fonts.desc"),
                component: () => <Fonts />
            },
            {
                id: "language",
                icon: Languages,
                title: t("settings.tab.appearance.language"),
                description: t("settings.tab.appearance.language.desc"),
                component: () => <Language />
            }
        ],
        system: [
            {
                id: "logs",
                icon: Info,
                title: t("settings.tab.system.logs"),
                description: t("settings.tab.system.logs.desc"),
                component: () => <Logs />,
                condition: () => account?.role === "admin"
            },
            {
                id: "power-options",
                icon: Power,
                title: t("settings.tab.system.power"),
                description: t("settings.tab.system.power.desc"),
                component: () => <PowerOptions />,
                condition: () => account?.role === "admin"
            },
            {
                id: "terminal",
                icon: TerminalIcon,
                title: t("settings.tab.system.terminal"),
                description: t("settings.tab.system.terminal.desc"),
                component: () => <TerminalPage />,
                condition: () => account?.role === "admin"
            },
            {
                id: "config",
                icon: FileText,
                title: t("settings.tab.system.config"),
                description: t("settings.tab.system.config.desc"),
                component: () => <Config />,
                condition: () => account?.role === "admin"
            }
        ],
        accounts: [
            {
                id: "profile",
                icon: User,
                title: t("settings.tab.people.profile"),
                description: t("settings.tab.people.profile.desc"),
                component: () => <Profile />
            },
            {
                id: "backup-codes",
                icon: KeyRound,
                title: t("settings.tab.people.backup_codes"),
                description: t("settings.tab.people.backup_codes.desc"),
                component: () => <BackupCodes />
            },
            {
                id: "other-people",
                icon: Users,
                title: t("settings.tab.people.other"),
                description: t("settings.tab.people.other.desc"),
                component: () => <OtherPeople />,
                condition: () => account?.role === "admin"
            }
        ]
    };

    const hasSubTabs = (id: string) => (subTabs[id]?.length ?? 0) > 0;

    const currentSection = stack[0];
    const currentSubTabs = subTabs[currentSection] ?? [];

    const root = rootTabs.find(t => t.id === currentSection);
    const currentSub = currentSubTabs.find(t => t.id === stack[1]);

    const title =
        stack.length === 0
            ? t("settings.title")
            : stack.length === 1
                ? root?.title ?? t("settings.title")
                : currentSub?.title ?? root?.title ?? t("settings.title");

    const goBack = () => {
        if (stack.length === 0) {
            navigate("/settings");
            return;
        }
        navigate("/settings/" + stack.slice(0, -1).join("/"));
    };

    const openRootTab = (id: string) => {
        navigate(`/settings/${id}`);
    };

    const openSubTab = (id: string) => {
        navigate(`/settings/${currentSection}/${id}`);
    };

    const ActiveComponent =
        stack.length >= 2
            ? currentSub?.component
            : stack.length === 1 && !hasSubTabs(currentSection)
                ? root?.component
                : null;

    return (
        <div className="settings-page">
            <h1>{title}</h1>

            {stack.length === 0 && (
                <div className="settings-tabs">
                    {rootTabs.filter(isVisible).map(tab => {
                        const Icon = tab.icon;

                        return (
                            <div
                                key={tab.id}
                                className="settings-tab"
                                id={tab.id}
                                onClick={() => openRootTab(tab.id)}
                            >
                                <Icon className="settings-option-icon" />
                                <div className="settings-tab-info">
                                    <p className="settings-tab-title">
                                        {tab.title}
                                    </p>
                                    <p className="settings-tab-description">{tab.description}</p>
                                </div>
                                {tab.id === "about" && updateAvailable && (
                                    <span className="update-badge-about">1</span>
                                )}
                                {tab.id === "plugins" && pluginsInteractionRequired > 0 && (
                                    <span className="update-badge-about">
                                        {pluginsInteractionRequired > 9 ? "9+" : pluginsInteractionRequired}
                                    </span>
                                )}
                                
                            </div>
                        );
                    })}
                </div>
            )}

            {stack.length === 1 && hasSubTabs(currentSection) && (
                <>
                    <button className="settings-back" onClick={goBack} data-type="secondary">
                        <ArrowLeft size={16} /> {t("common.back")}
                    </button>
                    <div className="settings-tabs">

                        {currentSubTabs.filter(isVisible).map(tab => {
                            const Icon = tab.icon;

                            return (
                                <div
                                    key={tab.id}
                                    className="settings-tab"
                                    id={tab.id}
                                    onClick={() => openSubTab(tab.id)}
                                >
                                    {Icon && <Icon className="settings-option-icon" />}
                                    <div className="settings-tab-info">
                                        <p className="settings-tab-title">{tab.title}</p>
                                        {tab.description && (
                                            <p className="settings-tab-description">{tab.description}</p>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {ActiveComponent && (
                <div className="settings-content">
                    <button className="settings-back" onClick={goBack} data-type="secondary">
                        <ArrowLeft size={16} /> {t("common.back")}
                    </button>

                    <ActiveComponent />
                </div>
            )}
        </div>
    );
}

export default Settings;
