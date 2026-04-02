import api from "./modules/api"
import React, { useEffect, useState } from "react";

async function loadCurrentAccount() {
  const urlParams = new URLSearchParams(window.location.search);
  let accountId = sessionStorage.getItem("account_id");
  
  if (!accountId || accountId === "null") {
    accountId = urlParams.get("account_id");
  }

  if (!accountId) {
    throw new Error("No account ID specified");
  }

  return await api("get_account", undefined, { id: accountId });
}

function Dashboard() {
  const [account, setAccount] = useState<any>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
      loadCurrentAccount().then(fetched => {
          setAccount(fetched);
          setTimeout(() => setLoaded(true), 50);
      });
  }, []);
  return (
    <>
      <h1>Yo, {account?.name}</h1>
    </>
  )
}

export default Dashboard
