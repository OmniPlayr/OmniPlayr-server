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
    Terminal as TerminalIcon
} from "lucide-react";

import './styles/Settings.css';
import { useLocation, useNavigate } from "react-router-dom";
import Theme from "./settings/Theme";
import Fonts from "./settings/Fonts";
import About from "./settings/About";
import Logs from "./settings/Logs";
import PowerOptions from "./settings/PowerOptions";
import TerminalPage from "./settings/Terminal";

function Settings({ account }: any) {
    const navigate = useNavigate();
    const location = useLocation();

    const segments = location.pathname.split("/").filter(Boolean);
    const stack = segments.slice(1);

    const isVisible = (tab: any) => {
        if (!tab.condition) return true;
        return tab.condition();
    };

    const rootTabs = [
        {
            id: "plugins",
            icon: Blocks,
            title: "Plugins",
            description: "Modify your OmniPlayr experience by using plugins",
            component: () => <div>Plugins</div>,
            condition: () => account?.role === "admin"
        },
        {
            id: "accounts",
            icon: User,
            title: "People",
            description: "Manage your accounts"
        },
        {
            id: "appearance",
            icon: Palette,
            title: "Appearance",
            description: "Modify the looks and feel of OmniPlayr"
        },
        {
            id: "system",
            icon: SettingsIcon,
            title: "System",
            description: "Check logs, reboot your system and modify config files",
            condition: () => account?.role === "admin"
        },
        {
            id: "about",
            icon: Info,
            title: "About",
            description: "Version information, credits, and more",
            component: () => <About />
        }
    ];

    const subTabs: Record<string, any[]> = {
        appearance: [
            {
                id: "theme",
                icon: SunMoon,
                title: "Theme",
                description: "Change how OmniPlayr looks",
                component: () => <Theme />
            },
            {
                id: "colors",
                icon: Palette,
                title: "Colors",
                description: "Customize accent colors",
                component: () => <div>Colors</div>
            },
            {
                id: "fonts",
                icon: CaseSensitive,
                title: "Fonts",
                description: "Adjust typography",
                component: () => <Fonts />
            }
        ],
        system: [
            {
                id: "logs",
                icon: Info,
                title: "Logs",
                description: "View system logs",
                component: () => <Logs />,
                condition: () => account?.role === "admin"
            },
            {
                id: "power-options",
                icon: Power,
                title: "Power Options",
                description: "Reboot, shutdown, safe mode and more",
                component: () => <PowerOptions />,
                condition: () => account?.role === "admin"
            },
            {
                id: "terminal",
                icon: TerminalIcon,
                title: "Terminal",
                description: "Run commands on the server",
                component: () => <TerminalPage />,
                condition: () => account?.role === "admin"
            },
            {
                id: "config",
                icon: FileText,
                title: "Config",
                description: "Edit configuration files",
                component: () => <div>Config</div>,
                condition: () => account?.role === "admin"
            }
        ],
        accounts: [
            {
                id: "profile",
                icon: User,
                title: "Profile",
                description: "Edit your profile",
                component: () => <div>Profile</div>
            },
            {
                id: "other-people",
                icon: Users,
                title: "Other People",
                description: "Manage other accounts",
                component: () => <div>Other People</div>,
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
            ? "Settings"
            : stack.length === 1
                ? root?.title ?? "Settings"
                : currentSub?.title ?? root?.title ?? "Settings";

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
                                    <p className="settings-tab-title">{tab.title}</p>
                                    <p className="settings-tab-description">{tab.description}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {stack.length === 1 && hasSubTabs(currentSection) && (
                <div className="settings-tabs">
                    <button className="settings-back" onClick={goBack} data-type="secondary">
                        <ArrowLeft size={16} /> Back
                    </button>

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
            )}

            {ActiveComponent && (
                <div className="settings-content">
                    <button className="settings-back" onClick={goBack} data-type="secondary">
                        <ArrowLeft size={16} /> Back
                    </button>

                    <ActiveComponent />
                </div>
            )}
        </div>
    );
}

export default Settings;