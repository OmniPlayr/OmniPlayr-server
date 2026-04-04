import { getConfig } from "./config";

const apiEndpoints = [
    {
        id: 'login',
        url: '/api/server/token',
        method: 'POST',
        authentication: 'none',
        data: {
            password: 'string'
        }
    },
    {
        id: 'get_accounts',
        url: '/api/accounts/',
        method: 'GET',
        authentication: 'access_token'
    },
    {
        id: 'get_account',
        url: '/api/accounts/{id}',
        method: 'GET',
        authentication: 'access_token',
        urlParams: {
            id: 'number'
        }
    }
];

function validateData(expected: object, received: object): void {
    const missingKeys = Object.keys(expected).filter(key => !(key in received));
    if (missingKeys.length > 0)
        throw new Error(`Missing required fields: ${missingKeys.join(', ')}`);

    const wrongTypes = Object.entries(expected).filter(([key, type]) =>
        typeof received[key as keyof typeof received] !== type
    );
    if (wrongTypes.length > 0)
        throw new Error(`Invalid field types: ${wrongTypes.map(([key, type]) => `${key} (expected ${type})`).join(', ')}`);
}

function replaceUrlParams(url: string, params?: object) {
    if (!params) return url;
    return url.replace(/\{(\w+)\}/g, (_, key) => {
        if (!(key in params)) throw new Error(`Missing URL parameter: ${key}`);
        return encodeURIComponent((params as any)[key]);
    });
}

async function api(id: string, data?: object, params?: object, throwErrors = true): Promise<any> {
    const endpoint = apiEndpoints.find(e => e.id === id);
    if (!endpoint) throw new Error(`API endpoint "${id}" not found`);

    if (endpoint.data) {
        if (!data) throw new Error(`Endpoint "${id}" requires a data payload`);
        validateData(endpoint.data, data);
    }

    const baseUrl = getConfig('api.apiUrl');
    const urlWithParams = replaceUrlParams(endpoint.url, params);
    const url = `${baseUrl}${urlWithParams}`;

    let token = null;

    const authentication = endpoint.authentication;
    if (authentication === 'access_token') {
        token = localStorage.getItem('access_token');
        if (!token && throwErrors) throw new Error('Access token not found');
    }

    const response = await fetch(url, {
        method: endpoint.method,
        headers: { 
            'Content-Type': 'application/json',
            ...(authentication === 'access_token' && { 'Authorization': `Bearer ${token}` })
        },
        body: data ? JSON.stringify(data) : undefined
    });

    if (!response.ok && throwErrors)
        throw new Error(`Request failed: ${response.status} ${response.statusText}`);

    return response.json();
}

export default api;