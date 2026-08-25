"""Runtime facade for backend plugin imports.

This module lets plugins use the same import path inside OmniPlayr that they
use with the local development SDK:

    from omniplayr.plugins import BackendPlugin, api, register
"""

from __future__ import annotations

import inspect
from collections.abc import Callable
from typing import Any

from api.helpers.account import (
    create_2fa_setup,
    create_account,
    create_account_token,
    create_backup_codes,
    delete_2fa,
    delete_account,
    delete_account_token,
    delete_backup_codes,
    delete_profile_picture,
    get_account,
    get_account_summary,
    has_backup_codes,
    list_account_summaries,
    list_accounts,
    revoke_token,
    update_account,
    verify_2fa_code,
    verify_account_password,
    verify_backup_code,
)
from api.helpers.admin import get_admin_status, verify_admin
from api.helpers.config import flatten_configs, flatten_frontend_configs, get_config, load_configs
from api.helpers.config_watcher import ConfigChangeHandler, deep_merge, start_config_watcher, sync_config
from api.helpers.db import can_convert_column, get_conn, init_db, init_db_when_ready, is_safe_sql_identifier, parse_column_type
from api.helpers.diagnostics import (
    get_error_counts,
    get_uptime_seconds,
    record_error,
    run_diagnostics,
    start_diagnostics,
)
from api.helpers.health import HealthResponse, ServiceStatus, health
from api.helpers.https_proxy import start_https_proxy
from api.helpers.log import (
    get_logs,
    log,
    log_exception,
    setup_asyncio_exception_handler,
    setup_exception_hook,
    setup_thread_exception_hook,
)
from api.helpers.notifications import (
    NotificationManager,
    delete_notification,
    get_notifications,
    get_unread_count,
    manager,
    mark_read,
    notify,
    notify_once,
    notify_once_sync,
    notify_sync,
    set_main_loop,
)
from api.helpers.passwords import password_check, password_hash
from api.helpers.plugin_config import flatten_plugin_configs, get_plugin_config, reload_plugin_config
from api.helpers.plugin_db import (
    PluginDB,
    ProtectionLevel,
    remove_table_protection,
    request_db_access as _request_db_access,
    set_table_protection,
)
from api.helpers.plugin_functions import (
    PluginFunctionNotFoundError,
    PluginFunctions,
    PluginNotAvailableError,
    call,
    expose as _expose,
    has_function,
    is_installed,
    mark_plugin_loaded,
    remove_plugin,
)
from api.helpers.plugin_installer import fetch_plugin_info, install_plugin
from api.helpers.plugins import PluginBase, api, get_backend_plugin_dir, get_plugin, get_plugin_router, load_plugins, register
from api.helpers.server import create_access_token, get_token_user, match_account, parse_interval, verify_auth, verify_token
from api.helpers.updater import apply_update, check_for_updates
from api.helpers.userwarn import user_warn

BackendPlugin = PluginBase

_PLUGIN_MODULE_KEYS: dict[str, str] = {}


def _register_plugin_module(module_name: str, plugin_key: str) -> None:
    """Register a loaded plugin module name for plugin-scoped helpers."""

    _PLUGIN_MODULE_KEYS[module_name] = plugin_key


def _infer_plugin_key() -> str:
    for frame in inspect.stack()[2:]:
        module_name = frame.frame.f_globals.get("__name__")
        if isinstance(module_name, str) and module_name in _PLUGIN_MODULE_KEYS:
            return _PLUGIN_MODULE_KEYS[module_name]
    raise RuntimeError("Could not infer the current OmniPlayr plugin module.")


def request_db_access(
    plugin_key: str | None = None,
    *,
    own: dict[str, dict[str, str]] | None = None,
    read: list[str] | None = None,
    readwrite: list[str] | None = None,
) -> PluginDB:
    """Request database access for a backend plugin."""

    return _request_db_access(plugin_key or _infer_plugin_key(), own=own, read=read, readwrite=readwrite)


def expose(plugin_key: str, function_name: str, function: Callable[..., Any]) -> None:
    """Expose a callable under an explicit plugin key."""

    return _expose(plugin_key, function_name, function)


def expose_function(
    function_name: str,
    function: Callable[..., Any] | None = None,
) -> Callable[..., Any] | Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Expose a callable for the current plugin."""

    plugin_key = _infer_plugin_key()
    if function is not None:
        _expose(plugin_key, function_name, function)
        return function

    def decorator(target: Callable[..., Any]) -> Callable[..., Any]:
        _expose(plugin_key, function_name, target)
        return target

    return decorator


def call_plugin_function(plugin_key: str, function_name: str, *args: Any, **kwargs: Any) -> Any:
    """Call a function exposed by another backend plugin."""

    return call(plugin_key, function_name, *args, **kwargs)


def is_plugin_available(plugin_key: str) -> bool:
    """Return whether a backend plugin is loaded."""

    return is_installed(plugin_key)


def is_plugin_function_available(plugin_key: str, function_name: str) -> bool:
    """Return whether a backend plugin exposes a function."""

    return has_function(plugin_key, function_name)


class _CurrentPluginFunctions:
    """Plugin-scoped cross-plugin helper that infers the caller plugin."""

    def expose(
        self,
        function_name: str,
        function: Callable[..., Any] | None = None,
    ) -> Callable[..., Any] | Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Expose a callable for the current plugin."""

        return expose_function(function_name, function)

    def call(self, plugin_key: str, function_name: str, *args: Any, **kwargs: Any) -> Any:
        """Call a function exposed by another backend plugin."""

        return call(plugin_key, function_name, *args, **kwargs)

    def is_installed(self, plugin_key: str) -> bool:
        """Return whether a backend plugin is loaded."""

        return is_installed(plugin_key)

    def has_function(self, plugin_key: str, function_name: str) -> bool:
        """Return whether a backend plugin exposes a function."""

        return has_function(plugin_key, function_name)


plugins = _CurrentPluginFunctions()

__all__ = [
    name
    for name in globals()
    if not name.startswith("_")
    and name not in {"Any", "Callable", "annotations", "inspect"}
]
