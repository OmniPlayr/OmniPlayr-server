export { default as api } from './api';
export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | string;
export type ApiParams = Record<string, string | number | boolean | null | undefined>;
export type ApiBody = object;

console.log('[pluginSdk.ts loaded]', import.meta.url);
console.trace('[pluginSdk.ts load trace]');

export interface ApiError extends Error {
    status: number;
}
export interface ApiClient {
    (
        idOrPath: string,
        data?: ApiBody,
        params?: ApiParams,
        throwErrors?: boolean,
        stream?: false,
        methodOverride?: ApiMethod
    ): Promise<unknown>;
    (
        idOrPath: string,
        data: ApiBody | undefined,
        params: ApiParams | undefined,
        throwErrors: boolean | undefined,
        stream: true,
        methodOverride?: ApiMethod
    ): Promise<Response>;
}
export {
    flattenPluginConfigs,
    getPluginConfig,
    reloadPluginConfig,
} from './pluginConfig';
export type { FlatConfigItem, TomlObject, TomlValue } from './config';
export { getAccount } from './account';
export { navigate } from './navigate';
export { useIsMobile } from './useIsMobile';
export { useNotificationsContext } from './NotificationsContext';
export type {
    Notification,
    NotificationAction,
    UseNotificationsResult,
} from './useNotifications';
export { closePopup, createPopup, goBackPopup } from './PopupContext';
export type { Popup, PopupButton } from './PopupContext';
import { getVolumeStorage as getCoreVolumeStorage } from './player';
export function getVolumeStorage(): Storage | null {
    return getCoreVolumeStorage();
}
export { player, playSong } from './player';
export type {
    AudioOutputDevice,
    AudioOutputPlaybackRequest,
    AudioOutputPlugin,
    AudioOutputPluginCallbacks,
    QueueItem,
    RegisteredAudioOutputDevice,
    RepeatMode,
    SourcePlugin,
    TrackMetadata,
} from './player';
export {
    emit,
    getPluginsMenuItems,
    getRoutes,
    getTab,
    getTabByUrl,
    getTabs,
    hasFrontendPlugin,
    modify,
    notifyPluginsLoaded,
    on,
    onPluginsLoaded,
    registerPluginsMenuItem,
    registerRoute,
    registerTab,
} from './plugins';
export type {
    PluginConfig,
    PluginMenuItem,
    PluginRoute,
    PluginTab,
} from './plugins';
export { definePluginTranslations } from './pluginTranslation';
export type {
    PluginTranslationHookResult,
    PluginTranslationsApi,
} from './pluginTranslation';
