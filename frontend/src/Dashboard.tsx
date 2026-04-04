import api from "./modules/api"
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Sidebar from "./Sidebar";
import "./styles/Dashboard.css";
import Player from "./Player";
import { getAccount } from "./modules/account";

async function loadAccountById(accountId: string) {
    return await api("get_account", undefined, { id: accountId });
}

function Dashboard() {
    const [account, setAccount] = useState<any>(null);
    const [searchParams, setSearchParams] = useSearchParams();

    useEffect(() => {
        let accountId = getAccount() || searchParams.get("account_id");
        if (!accountId) return;

        loadAccountById(accountId).then(fetched => setAccount(fetched));
		setSearchParams({});
    }, [searchParams]);

    return (
        <div className="dashboard">
			<div className="dashboard-hor">
            	<Sidebar account={account} />

			</div>
			<Player />
        </div>
    )
}

export default Dashboard;