import { getConfig } from "./config";
import { getAccount } from "./account";

interface RouteInfo {
    path: string;
    methods: string[];
    name: string;
}

let _routeCache: Promise<RouteInfo[]> | null = null;

function fetchRoutes(): Promise<RouteInfo[]> {
    if (_routeCache) return _routeCache;
    const baseUrl = getConfig<string>("api.apiUrl") ?? "";
    const token = localStorage.getItem("access_token");
    return (_routeCache = fetch(`${baseUrl}/api/endpoints/`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch endpoints: ${res.status}`);
        return res.json();
    }));
}

fetchRoutes();

export function invalidateRouteCache() {
    _routeCache = null;
    fetchRoutes();
}

function replaceUrlParams(url: string, params?: object): string {
    if (!params) return url;
    return url.replace(/\{(\w+)\}/g, (_, key) => {
        if (!(key in params)) throw new Error(`Missing URL parameter: ${key}`);
        return encodeURIComponent(String((params as Record<string, unknown>)[key]));
    });
}

function buildHeaders(): Record<string, string> {
    const token = localStorage.getItem("access_token");
    const accountToken = getAccount();

    return {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(accountToken ? { "X-Account-Token": String(accountToken) } : {}),
    };
}

async function api(
    idOrPath: string,
    data?: object,
    params?: object,
    throwErrors = true,
    stream = false
): Promise<unknown> {
    const baseUrl = getConfig<string>("api.apiUrl") ?? "";

    let method: string;
    let url: string;

    if (idOrPath.startsWith("/")) {
        method = data ? "POST" : "GET";
        url = `${baseUrl}/api${replaceUrlParams(idOrPath, params)}`;
    } else {
        const routes = await fetchRoutes();
        const route = routes.find((r) => r.name === idOrPath);
        if (!route) throw new Error(`No route found with name "${idOrPath}"`);
        method = route.methods[0];
        url = `${baseUrl}${replaceUrlParams(route.path, params)}`;
    }

    const res = await fetch(url, {
        method,
        headers: buildHeaders(),
        body: data ? JSON.stringify(data) : undefined,
    });

    if (!res.ok && throwErrors)
        throw new Error(`Request failed: ${res.status} ${res.statusText}`);

    return stream ? res : res.json();
}

export default api;