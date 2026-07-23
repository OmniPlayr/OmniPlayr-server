import { getConfig } from "./config";
import { getAccount } from "./account";

interface RouteInfo {
    path: string;
    methods: string[];
    name: string;
}

let _routeMap: Map<string, RouteInfo> | null = null;
let _routePromise: Promise<Map<string, RouteInfo>> | null = null;

function fetchRoutes(): Promise<Map<string, RouteInfo>> {
    if (_routePromise) return _routePromise;
    const baseUrl = getConfig<string>("api.apiUrl") ?? "";
    const token = localStorage.getItem("access_token");
    _routePromise = fetch(`${baseUrl}/api/endpoints/`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
        .then((res) => {
            if (!res.ok) throw new Error(`Failed to fetch endpoints: ${res.status}`);
            return res.json() as Promise<RouteInfo[]>;
        })
        .then((routes) => {
            _routeMap = new Map(routes.map((r) => [r.name, r]));
            return _routeMap;
        })
        .catch((error) => {
            _routeMap = null;
            _routePromise = null;
            throw error;
        });
    return _routePromise;
}

void fetchRoutes().catch(() => {});

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

async function getRouteMap(): Promise<Map<string, RouteInfo>> {
    if (_routeMap) return _routeMap;
    return fetchRoutes();
}

async function api(
    idOrPath: string,
    data?: object,
    params?: object,
    throwErrors = true,
    stream = false,
    methodOverride?: string
): Promise<unknown> {
    const baseUrl = getConfig<string>("api.apiUrl") ?? "";

    let method: string;
    let url: string;

    if (idOrPath.startsWith("/")) {
        method = methodOverride ?? (data ? "POST" : "GET");
        url = `${baseUrl}/api${replaceUrlParams(idOrPath, params)}`;
    } else {
        const routeMap = await getRouteMap();
        const route = routeMap.get(idOrPath);
        if (!route) throw new Error(`No route found with name "${idOrPath}"`);
        method = methodOverride ?? route.methods[0];
        url = `${baseUrl}${replaceUrlParams(route.path, params)}`;
    }

    const res = await fetch(url, {
        method,
        headers: buildHeaders(),
        body: data ? JSON.stringify(data) : undefined,
    });

    if (!res.ok && throwErrors) {
        const error = new Error(`Request failed: ${res.status} ${res.statusText}`) as Error & { status: number };
        error.status = res.status;
        throw error;
    }

    return stream ? res : res.status === 204 ? null : res.json();
}

export default api;
