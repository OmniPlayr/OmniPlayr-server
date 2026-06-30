import { getConfig } from "./config";
function storeAccount(token: string) {
    if (getConfig('accounts.accountStore') === 'sessionStorage') {
        sessionStorage.setItem('account_token', token);
    } else if (getConfig('accounts.accountStore') === 'localStorage') {
        localStorage.setItem('account_token', token);
    } else {
        throw new Error('Invalid account store');
    }
}

function getAccount() {
    if (getConfig('accounts.accountStore') === 'sessionStorage') {
        return sessionStorage.getItem('account_token');
    } else if (getConfig('accounts.accountStore') === 'localStorage') {
        return localStorage.getItem('account_token');
    } else {
        throw new Error('Invalid account store');
    }
}

export { storeAccount, getAccount };