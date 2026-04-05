import { getConfig } from "./config";
interface RouteInfo {
    path: string;
    methods: string[];
    name: string;
}
let _routeCache: RouteInfo[] | null = null;
async function fetchRoutes(): Promise<RouteInfo[]> {
    if (_routeCache) return _routeCache;
    const baseUrl = getConfig<string>("api.apiUrl") ?? "";
    const token = localStorage.getItem("access_token");
    const res = await fetch(`${baseUrl}/api/endpoints/`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Failed to fetch endpoints: ${res.status}`);
    _routeCache = await res.json();
    return _routeCache!;
}
export function invalidateRouteCache() {
    _routeCache = null;
}
function replaceUrlParams(url: string, params?: object): string {
    if (!params) return url;
    return url.replace(/\{(\w+)\}/g, (_, key) => {
        if (!(key in params)) throw new Error(`Missing URL parameter: ${key}`);
        return encodeURIComponent(String((params as Record<string, unknown>)[key]));
    });
}
async function api(
    idOrPath: string,
    data?: object,
    params?: object,
    throwErrors = true,
    stream = false
): Promise<unknown> {
    const baseUrl = getConfig<string>("api.apiUrl") ?? "";
    const token = localStorage.getItem("access_token");
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    if (idOrPath.startsWith("/")) {
        const url = `${baseUrl}/api${replaceUrlParams(idOrPath, params)}`;
        const res = await fetch(url, {
            method: data ? "POST" : "GET",
            headers,
            body: data ? JSON.stringify(data) : undefined,
        });
        if (!res.ok && throwErrors)
            throw new Error(`Request failed: ${res.status} ${res.statusText}`);
        if (stream) return res;
        return res.json();
    }
    const routes = await fetchRoutes();
    const route = routes.find((r) => r.name === idOrPath);
    if (!route) throw new Error(`No route found with name "${idOrPath}"`);
    const method = route.methods[0];
    const url = `${baseUrl}${replaceUrlParams(route.path, params)}`;
    const res = await fetch(url, {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined,
    });
    if (!res.ok && throwErrors)
        throw new Error(`Request failed: ${res.status} ${res.statusText}`);
    if (stream) return res;
    return res.json();
}
export default api;