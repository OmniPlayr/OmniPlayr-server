import { getConfig } from "./config";
function storeAccount(id: string) {
    if (getConfig('accounts.accountStore') === 'sessionStorage') {
        sessionStorage.setItem('account_id', id);
    } else if (getConfig('accounts.accountStore') === 'localStorage') {
        localStorage.setItem('account_id', id);
    } else {
        throw new Error('Invalid account store');
    }
}

function getAccount() {
    if (getConfig('accounts.accountStore') === 'sessionStorage') {
        return sessionStorage.getItem('account_id');
    } else if (getConfig('accounts.accountStore') === 'localStorage') {
        return localStorage.getItem('account_id');
    } else {
        throw new Error('Invalid account store');
    }
}

export { storeAccount, getAccount };