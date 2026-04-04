# Frontend Plugin Development

Frontend plugins live in `frontend/src/plugins/` and are loaded automatically at startup via Vite's glob imports. Each plugin is a TypeScript/TSX module that registers UI components and optional routes with the core via `src/modules/plugins.ts`.

---

## Plugin Structure

```
frontend/src/plugins/
└── my-plugin@author/
    ├── index.ts         # Required — entry point
    ├── package.json     # Required — metadata and validation
    ├── config.toml      # Optional — plugin-specific config
    └── MyView.tsx       # Your components (any name, any structure)
```

The directory name is the plugin key and must follow the pattern `name@author`. It is used everywhere: validation, registration, config loading, and event namespacing.

---

## Declaring the Plugin

The plugin directory is picked up automatically by Vite's glob import in `main.tsx`:

```ts
import.meta.glob('./plugins/*/index.{ts,tsx}', { eager: true });
```

No manual registration in any config file is needed — just create the folder.

---

## package.json

Every plugin must have a `package.json`. It is validated at startup and a plugin whose `package.json` fails validation will be silently blocked from registering any UI, routes, or DOM hooks.

```json
{
    "id": "my-plugin@author",
    "name": "My Plugin",
    "author": "author",
    "version": "1.0.0",
    "description": "What this plugin does"
}
```

All five fields are required and must be non-empty strings. The rules enforced at load time are:

- `id` must exactly match the folder name (`my-plugin@author`)
- `author` must match the part after `@` in the folder name
- The folder name itself must contain exactly one `@`

If validation fails, a console error is printed and the plugin is excluded from all registries for the rest of the session.

---

## Registering UI

Use `registerPluginUI` from `src/modules/plugins.ts` to add your plugin to the sidebar or any future plugin slot. Call it from your `index.ts`.

```ts
import { registerPluginUI } from '../../modules/plugins';
import { Music } from 'lucide-react';
import MyView from './MyView';

registerPluginUI('my-plugin@author', {
    icon: Music,
    view: MyView,
    sourceType: 'my-plugin',
});
```

### Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `icon` | `ComponentType` | Yes | Lucide icon or any React component, used in the sidebar |
| `view` | `ComponentType` | Yes | The main view rendered when this plugin is active |
| `sourceType` | `string` | No | Matches the `source_type` from the backend plugin. Used by the player to route stream requests |

The label shown in the UI is taken from `package.json`'s `name` field automatically — you do not set it here.

---

## Registering Routes

Use `registerRoute` to add pages that sit outside the main dashboard layout.

```ts
import { registerRoute } from '../../modules/plugins';
import MyPage from './MyPage';

registerRoute({
    path: '/my-plugin/page',
    component: MyPage,
});
```

Routes registered here are injected into the React Router tree in `main.tsx` alongside the built-in routes. There is no automatic namespacing — include your plugin key in the path yourself to avoid clashes.

---

## Plugin Config

Store config in `plugins/<your-key>/config.toml`. This is the only config file your plugin should read. Do not use `getConfig` from `src/modules/config.ts` — that is reserved for the core application.

```toml
[display]
items_per_page = 20
show_artwork = true

[api]
endpoint = "https://example.com"
```

Read values using `getPluginConfig` from `src/modules/plugin_config.ts`:

```ts
import { getPluginConfig } from '../../modules/plugin_config';

const PLUGIN_ID = 'my-plugin@author';

const itemsPerPage = getPluginConfig<number>(PLUGIN_ID, 'display.items_per_page', 20);
const showArtwork = getPluginConfig<boolean>(PLUGIN_ID, 'display.show_artwork', true);
const endpoint = getPluginConfig<string>(PLUGIN_ID, 'api.endpoint', '');
```

The function signature is:

```ts
getPluginConfig<T>(pluginId: string, keyPath: string, defaultValue?: T): T | undefined
```

Key paths use dot notation to traverse nested TOML tables, identical to how the backend's `get_plugin_config` works. If the plugin has no `config.toml`, or the key does not exist, `defaultValue` is returned.

The config is parsed once at module load time. If you need to force a re-parse (for example, after a hot-reload in development), call:

```ts
import { reloadPluginConfig } from '../../modules/plugin_config';

reloadPluginConfig('my-plugin@author');
```

Note that in a production build the TOML files are bundled by Vite, so `reloadPluginConfig` re-parses from the same bundled string — it does not read from disk at runtime.

---

## Event Bus

Plugins can communicate with each other and with the core through a simple publish/subscribe system.

```ts
import { emit, on } from '../../modules/plugins';

const unsubscribe = on('player:track-changed', (payload) => {
    console.log('New track:', payload);
});

emit('my-plugin:something-happened', { data: 42 });

unsubscribe();
```

`on` returns a cleanup function. Call it when your component unmounts to avoid memory leaks:

```ts
import { useEffect } from 'react';
import { on } from '../../modules/plugins';

useEffect(() => {
    return on('player:track-changed', (payload) => {
        console.log(payload);
    });
}, []);
```

There is no namespace enforcement on event names — use your plugin key as a prefix for events you own (e.g. `my-plugin@author:event-name`) to avoid collisions with other plugins.

---

## DOM Hooks

DOM hooks let a plugin modify elements rendered by core components or other plugins without needing direct access to their React trees.

```ts
import { modify } from '../../modules/plugins';

modify('my-plugin@author', 'Player.player-controls', (el) => {
    el.style.border = '1px solid red';
});
```

The selector format is `ComponentName.css-class`. The first part is matched against the `data-component` attribute that core components add to their root element (e.g. `<div data-component="Player">`). The second part is a CSS class within that component.

Hooks are applied every time `applyDOMHooks()` runs, which happens after every React render in any component that calls `usePlugins()`. Keep hook functions idempotent.

A plugin whose `package.json` failed validation cannot register DOM hooks — `modify` will print a console error and return early.

---

## Playing Media

If your plugin has a corresponding backend plugin that serves a stream, set `sourceType` when registering your UI. Then use the core player module to trigger playback:

```ts
import { playSong } from '../../modules/player';

playSong('path/to/file.mp3', 'my-plugin');
```

The player fetches metadata from `GET /api/player/media/<sourceType>:<songId>` and the stream from `GET /api/player/stream/<sourceType>:<songId>`, then plays it through the shared audio element and updates the Player UI automatically.

---

## Full Example

```
frontend/src/plugins/my-plugin@author/
├── index.ts
├── package.json
├── config.toml
└── MyView.tsx
```

**package.json**
```json
{
    "id": "my-plugin@author",
    "name": "My Plugin",
    "author": "author",
    "version": "1.0.0",
    "description": "Streams files from a custom source"
}
```

**config.toml**
```toml
[display]
label = "My Files"
```

**index.ts**
```ts
import { registerPluginUI, registerRoute, on } from '../../modules/plugins';
import { getPluginConfig } from '../../modules/plugin_config';
import { Folder } from 'lucide-react';
import MyView from './MyView';
import MyPage from './MyPage';

const PLUGIN_ID = 'my-plugin@author';

registerPluginUI(PLUGIN_ID, {
    icon: Folder,
    view: MyView,
    sourceType: 'my-plugin',
});

registerRoute({
    path: '/my-plugin/browse',
    component: MyPage,
});

on('player:track-changed', (track) => {
    const label = getPluginConfig<string>(PLUGIN_ID, 'display.label', 'My Files');
    console.log(`[${label}] now playing:`, track);
});
```

**MyView.tsx**
```tsx
import { playSong } from '../../modules/player';
import { getPluginConfig } from '../../modules/plugin_config';

const PLUGIN_ID = 'my-plugin@author';

export default function MyView() {
    const label = getPluginConfig<string>(PLUGIN_ID, 'display.label', 'My Files');

    return (
        <div>
            <h2>{label}</h2>
            <button onClick={() => playSong('example.mp3', 'my-plugin')}>
                Play
            </button>
        </div>
    );
}
```