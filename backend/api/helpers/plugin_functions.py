from __future__ import annotations

from threading import RLock
from typing import Any, Callable
from api.helpers.log import log


class PluginNotAvailableError(LookupError):
    """Raised when a cross-plugin call targets a plugin that is not loaded."""

    pass


class PluginFunctionNotFoundError(LookupError):
    """Raised when a loaded plugin does not expose the requested function."""

    pass


_functions: dict[str, dict[str, Callable[..., Any]]] = {}
_loaded_plugins: set[str] = set()
_lock = RLock()


class PluginFunctions:
    """Plugin-scoped helper for exposing and calling cross-plugin functions."""

    def __init__(self, plugin_key: str):
        """Create a helper bound to a single plugin key."""

        self._plugin_key = plugin_key
        log(f"[{plugin_key}] Plugin function API created", "debug")

    def expose(
        self,
        function_name: str,
        function: Callable[..., Any] | None = None,
    ):
        """Expose a plugin-local callable for other backend plugins."""

        log(
            f"[{self._plugin_key}] Expose requested: function={function_name!r}",
            "debug",
        )
        if function is None:
            def decorator(target: Callable[..., Any]):
                expose(self._plugin_key, function_name, target)
                return target

            return decorator

        expose(self._plugin_key, function_name, function)
        return function

    def call(
        self,
        plugin_key: str,
        function_name: str,
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        """Call a function exposed by another backend plugin."""

        log(
            f"[{self._plugin_key}] Calling plugin function: "
            f"plugin={plugin_key!r} function={function_name!r}",
            "debug",
        )
        return call(plugin_key, function_name, *args, **kwargs)

    def is_installed(self, plugin_key: str) -> bool:
        """Return whether another backend plugin has been loaded."""

        log(
            f"[{self._plugin_key}] Checking plugin installation: plugin={plugin_key!r}",
            "debug",
        )
        return is_installed(plugin_key)

    def has_function(self, plugin_key: str, function_name: str) -> bool:
        """Return whether another plugin exposes a named function."""

        log(
            f"[{self._plugin_key}] Checking plugin function: "
            f"plugin={plugin_key!r} function={function_name!r}",
            "debug",
        )
        return has_function(plugin_key, function_name)


def expose(plugin_key: str, function_name: str, function: Callable[..., Any]) -> None:
    """Expose a callable under a plugin key for cross-plugin calls."""

    log(
        f"[{plugin_key}] Registering exposed function {function_name!r}",
        "debug",
    )
    if not plugin_key or not function_name:
        log(
            f"Invalid exposed function registration: plugin={plugin_key!r} "
            f"function={function_name!r}",
            "error",
        )
        raise ValueError("plugin_key and function_name must not be empty")
    if not callable(function):
        log(
            f"[{plugin_key}] Exposed function {function_name!r} is not callable",
            "error",
        )
        raise TypeError("function must be callable")

    with _lock:
        plugin_functions = _functions.setdefault(plugin_key, {})
        if function_name in plugin_functions:
            log(
                f"[{plugin_key}] Function {function_name!r} is already exposed",
                "warning",
            )
            raise ValueError(
                f"Plugin {plugin_key!r} already exposes function {function_name!r}"
            )
        plugin_functions[function_name] = function
    log(
        f"[{plugin_key}] Function {function_name!r} exposed successfully",
        "debug",
    )


def mark_plugin_loaded(plugin_key: str) -> None:
    """Mark a plugin as loaded in the in-memory cross-plugin registry."""

    with _lock:
        _loaded_plugins.add(plugin_key)
    log(f"[{plugin_key}] Marked plugin as loaded", "debug")


def remove_plugin(plugin_key: str) -> None:
    """Remove a plugin and its exposed functions from the registry."""

    with _lock:
        function_count = len(_functions.get(plugin_key, {}))
        was_loaded = plugin_key in _loaded_plugins
        _loaded_plugins.discard(plugin_key)
        _functions.pop(plugin_key, None)
    log(
        f"[{plugin_key}] Removed plugin function state: "
        f"loaded={was_loaded} functions={function_count}",
        "debug",
    )


def is_installed(plugin_key: str) -> bool:
    """Return whether a plugin has been marked as loaded."""

    with _lock:
        available = plugin_key in _loaded_plugins
    log(
        f"Plugin installation check: plugin={plugin_key!r} available={available}",
        "debug",
    )
    return available


def has_function(plugin_key: str, function_name: str) -> bool:
    """Return whether a loaded plugin exposes a named function."""

    with _lock:
        available = (
            plugin_key in _loaded_plugins
            and function_name in _functions.get(plugin_key, {})
        )
    log(
        f"Plugin function check: plugin={plugin_key!r} "
        f"function={function_name!r} available={available}",
        "debug",
    )
    return available


def call(plugin_key: str, function_name: str, *args: Any, **kwargs: Any) -> Any:
    """Call a function exposed by another backend plugin."""

    log(
        f"Invoking plugin function: plugin={plugin_key!r} function={function_name!r}",
        "debug",
    )
    with _lock:
        if plugin_key not in _loaded_plugins:
            log(
                f"Cannot call plugin function: plugin={plugin_key!r} is not available",
                "warning",
            )
            raise PluginNotAvailableError(f"Plugin {plugin_key!r} is not available")
        function = _functions.get(plugin_key, {}).get(function_name)

    if function is None:
        log(
            f"Cannot call plugin function: plugin={plugin_key!r} "
            f"does not expose {function_name!r}",
            "warning",
        )
        raise PluginFunctionNotFoundError(
            f"Plugin {plugin_key!r} does not expose function {function_name!r}"
        )
    try:
        result = function(*args, **kwargs)
        log(
            f"Plugin function invoked successfully: "
            f"plugin={plugin_key!r} function={function_name!r}",
            "debug",
        )
        return result
    except Exception as e:
        log(
            f"Plugin function failed: plugin={plugin_key!r} "
            f"function={function_name!r} error={e}",
            "error",
        )
        raise
