import React, { useEffect, useState } from "react";
import { useNavigate, type Path } from "react-router-dom";
import api from "./modules/api";
import "./styles/AccountSelect.css";
import defaultPfp from "./assets/images/default-pfp-dark.svg";
import Dashboard from "./Dashboard";
import { storeAccount } from "./modules/account";

async function loadAccounts() {
    return await api("get_accounts") as any[];
}

function AccountSelect() {
    const [accounts, setAccounts] = useState<any[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [clonePage, setClonePage] = useState(false);
    const [overlayClone, setOverlayClone] = useState<React.ReactNode | null>(null);
    const navigate = useNavigate();

    useEffect(() => {
        loadAccounts().then(fetched => {
            setAccounts(fetched);
            setTimeout(() => setLoaded(true), 50);
        });
    }, []);

    const loadAccount = (id: string) => {
        setSelected(id);
        storeAccount(id);
        const accountItem = document.querySelector(`.account-select-option[data-id="${id}"]`) as HTMLElement;
        accountItem?.parentElement?.classList.add("active");
        accountItem?.classList.add("loading");

        if (accountItem) {
            const rect = accountItem.getBoundingClientRect();
            const clone = (
                <div
                    className="account-select-option loading"
                    style={{
                        position: "absolute",
                        top: `${rect.top}px`,
                        left: `${rect.left}px`,
                        width: `${rect.width}px`,
                        height: `${rect.height}px`,
                        zIndex: 10001,
                        transform: "translate(0,0)"
                    }}
                >
                    <img src={(accountItem.querySelector("img") as HTMLImageElement)?.src || defaultPfp} alt="" />
                    <span>{(accountItem.querySelector("span") as HTMLElement)?.innerText}</span>
                </div>
            );
            setOverlayClone(clone);
        }

        setClonePage(true);

        setTimeout(() => {
            navigate(`/dashboard`);
        }, 1000);
    };

    return (
        <>
            {clonePage && (
                <div className="cloned-page-overlay">
                    {overlayClone}
                    <div className="cloned-page-content">
                        <Dashboard />
                    </div>
                </div>
            )}
            <div className={`account-select ${loaded ? "active" : ""}`} style={{ pointerEvents: selected ? "none" : "auto" }}>
                <h1>Who's listening?</h1>
                <div className="account-select-options">
                    {accounts.map((a, i) => (
                        <div
                            key={a.id}
                            className={`account-select-option ${selected === a.id ? "loading" : ""}`}
                            style={{ "--i": i } as any}
                            data-id={a.id}
                            onClick={() => loadAccount(a.id)}
                        >
                            <img src={a.avatar_b64 || defaultPfp} alt={a.name} />
                            <span>{a.name}</span>
                        </div>
                    ))}
                </div>
            </div>
        </>
    );
}

export default AccountSelect;