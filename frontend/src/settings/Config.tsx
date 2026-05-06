import api from "../modules/api";
import { useEffect, useState } from "react";
import { ScrollText, FileSliders, Folder, Server, CircleFadingArrowUp } from "lucide-react";
import "../styles/settings/Config.css";
let cachedConfigs: any = null;
let fetchPromise: Promise<any> | null = null;

async function loadAccount() {
    if (cachedConfigs) return cachedConfigs;
    if (!fetchPromise) {
        fetchPromise = api("/system/configs");
    }
    cachedConfigs = await fetchPromise;
    return cachedConfigs;
}

function getConfigIcon(file: string) {
    switch (file) {
        case "logging":
            return <ScrollText className="config-icon" />;
        case "paths":
            return <Folder className="config-icon" />;
        case "server":
            return <Server className="config-icon" />;
        case "update":
            return <CircleFadingArrowUp className="config-icon" />;
        default:
            return <FileSliders className="config-icon" />;
    }
}

function Config() {
    const [configs, setConfigs] = useState<any>(cachedConfigs);

    useEffect(() => {
        if (configs) return;
        loadAccount().then(setConfigs);
    }, []);

    return (
        <div className="config-section">
            <div className='config-section-sidebar'>
                {configs?.map((config: any) => (
                    <div key={config.file} className='config-section-sidebar-item'>
                        {getConfigIcon(config.file)}
                        <div className='config-section-sidebar-item-info'>
                            <div className='config-section-sidebar-item-info-filename'>{config.file}</div>
                            <div className='config-section-sidebar-item-info-file'>{config.file}.toml</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default Config