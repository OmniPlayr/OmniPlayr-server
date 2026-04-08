import React, { useEffect, useState } from "react";
import api from "./modules/api";
import "./styles/AccountSelect.css";
import defaultPfp from "./assets/images/default-pfp-dark.svg";
import { storeAccount } from "./modules/account";

async function loadAccounts() {
    return await api("get_accounts") as any[];
}

function AccountSelect({ onAccountSelected }: { onAccountSelected: (id: string) => void }) {
    const [accounts, setAccounts] = useState<any[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [fadingOut, setFadingOut] = useState(false);

    useEffect(() => {
        loadAccounts().then(fetched => {
            setAccounts(fetched);
            setTimeout(() => setLoaded(true), 50);
        });
    }, []);

    const loadAccount = (id: string) => {
        setSelected(id);
        storeAccount(id);
        setFadingOut(true);
        setTimeout(() => {
            onAccountSelected(id);
        }, 600);
    };

    return (
        <div className={`account-select ${loaded ? "active" : ""} ${fadingOut ? "fading-out" : ""}`} style={{ pointerEvents: selected ? "none" : "auto" }}>
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
    );
}

export default AccountSelect;