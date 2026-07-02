from __future__ import annotations

import argparse
import ast
import json
import re
import shutil
from pathlib import Path


HELPER_MODULES = {
    "account": "backend/api/helpers/account.py",
    "admin": "backend/api/helpers/admin.py",
    "server": "backend/api/helpers/server.py",
    "notifications": "backend/api/helpers/notifications.py",
    "logging": "backend/api/helpers/log.py",
    "passwords": "backend/api/helpers/passwords.py",
    "config": "backend/api/helpers/plugin_config.py",
    "db": "backend/api/helpers/plugin_db.py",
    "functions": "backend/api/helpers/plugin_functions.py",
    "runtime": "backend/api/helpers/plugins.py",
}

EXTRA_RUNTIME_MODULES = {
    "backend_config": "backend/api/helpers/config.py",
    "diagnostics": "backend/api/helpers/diagnostics.py",
    "health": "backend/api/helpers/health.py",
    "installer": "backend/api/helpers/plugin_installer.py",
    "updater": "backend/api/helpers/updater.py",
}

RUNTIME_ERROR_IMPORT = "from ._runtime import runtime_unavailable"
SAFE_CLASS_BASES = {"Exception", "LookupError", "RuntimeError", "ValueError", "TypeError", "object"}

DOCUMENTED_LINKS = {
    "functions.PluginFunctionNotFoundError": "https://omniplayr.wokki20.nl/docs/plugins/building/backend/cross-plugin-functions.html#handling-unavailable-functions",
    "functions.PluginNotAvailableError": "https://omniplayr.wokki20.nl/docs/plugins/building/backend/cross-plugin-functions.html#handling-unavailable-functions",
    "functions.call": "https://omniplayr.wokki20.nl/docs/plugins/building/backend/cross-plugin-functions.html#discovering-and-calling-functions",
    "functions.expose": "https://omniplayr.wokki20.nl/docs/plugins/building/backend/cross-plugin-functions.html#exposing-a-function",
    "functions.has_function": "https://omniplayr.wokki20.nl/docs/plugins/building/backend/cross-plugin-functions.html#available-helpers",
    "functions.is_installed": "https://omniplayr.wokki20.nl/docs/plugins/building/backend/cross-plugin-functions.html#available-helpers",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate the backend plugin SDK from the server source.")
    parser.add_argument("--sdk-repo", required=True, type=Path, help="Path to OmniPlayr-plugin-SDK checkout.")
    parser.add_argument("--server-repo", default=Path.cwd(), type=Path, help="Path to OmniPlayr-server checkout.")
    return parser.parse_args()


def read_tree(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def clean_docstring(value: str | None) -> str:
    return value or ""


def collect_existing_docstrings(sdk_src: Path) -> dict[str, str]:
    docs: dict[str, str] = {}
    if not sdk_src.exists():
        return docs

    for path in sdk_src.glob("*.py"):
        if path.name == "__init__.py":
            module_name = "__init__"
        else:
            module_name = path.stem
        try:
            tree = read_tree(path)
        except SyntaxError:
            continue
        module_doc = ast.get_docstring(tree)
        if module_doc:
            docs[f"{module_name}.__module__"] = module_doc
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                doc = ast.get_docstring(node)
                if doc:
                    docs[f"{module_name}.{node.name}"] = doc
                if isinstance(node, ast.ClassDef):
                    for child in node.body:
                        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                            child_doc = ast.get_docstring(child)
                            if child_doc:
                                docs[f"{module_name}.{node.name}.{child.name}"] = child_doc
    return docs


def public_name(name: str) -> bool:
    return not name.startswith("_")


def annotation(node: ast.AST | None) -> str:
    if node is None:
        return ""
    return ast.unparse(node)


def render_arg(arg: ast.arg) -> str:
    rendered = arg.arg
    if arg.annotation is not None:
        rendered += f": {annotation(arg.annotation)}"
    return rendered


def render_arguments(args: ast.arguments) -> str:
    parts: list[str] = []
    positional = [*args.posonlyargs, *args.args]
    default_offset = len(positional) - len(args.defaults)

    for index, arg in enumerate(positional):
        part = render_arg(arg)
        if index >= default_offset:
            part += " = ..."
        parts.append(part)

    if args.vararg is not None:
        parts.append("*" + render_arg(args.vararg))
    elif args.kwonlyargs:
        parts.append("*")

    for arg, default in zip(args.kwonlyargs, args.kw_defaults):
        part = render_arg(arg)
        if default is not None:
            part += " = ..."
        parts.append(part)

    if args.kwarg is not None:
        parts.append("**" + render_arg(args.kwarg))

    return ", ".join(parts)


def render_docstring(doc: str, indent: str) -> list[str]:
    if not doc:
        return []
    escaped = doc.replace('"""', r'\"\"\"')
    lines = escaped.splitlines() or [""]
    if len(lines) == 1:
        return [f'{indent}"""{lines[0]}"""']
    rendered = [f'{indent}"""']
    rendered.extend(f"{indent}{line}" for line in lines)
    rendered.append(f'{indent}"""')
    return rendered


def strip_documentation_link(doc: str) -> str:
    lines = doc.splitlines()
    filtered = [line for line in lines if "[View Documentation]" not in line]
    while filtered and not filtered[-1].strip():
        filtered.pop()
    return "\n".join(filtered)


def parse_docstring_metadata(doc: str) -> tuple[str, dict[str, str]]:
    metadata: dict[str, str] = {}
    lines = doc.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if not line.startswith("@") or "=" not in line:
            break
        key, value = line[1:].split("=", 1)
        metadata[key.strip().lower()] = value.strip()
        index += 1
    while index < len(lines) and not lines[index].strip():
        index += 1
    return "\n".join(lines[index:]).strip(), metadata


def format_docstring(
    doc: str,
    qualname: str,
    metadata: dict[str, str],
    deprecations: dict[str, dict[str, str]],
    version: str,
) -> str:
    deprecated = metadata.get("deprecated", "").lower() == "true"
    explicit_since = metadata.get("deprecated_since") or metadata.get("deprecated-version")
    doc = strip_documentation_link(doc)

    if deprecated:
        since = explicit_since or deprecations.get(qualname, {}).get("since") or version
        deprecations[qualname] = {"since": since}
        prefix = f"Deprecated since OmniPlayr backend {since}."
        doc = f"{prefix}\n\n{doc}" if doc else prefix

    link = DOCUMENTED_LINKS.get(qualname)
    if link:
        doc = f"{doc}\n\n[View Documentation]({link})" if doc else f"[View Documentation]({link})"

    return doc


def fallback_docstring(name: str, module: str, owner: str | None = None, *, kind: str = "function") -> str:
    if owner is not None:
        return (
            f"Development-time stub for `{owner}.{name}` from the OmniPlayr "
            f"backend `{module}` helpers."
        )
    if kind == "class":
        return f"Development-time type stub for `{name}` from the OmniPlayr backend `{module}` helpers."
    return f"Development-time stub for `{name}` from the OmniPlayr backend `{module}` helpers."


def stub_body(name: str, indent: str) -> list[str]:
    return [f'{indent}raise runtime_unavailable("{name}")']


def render_function(
    node: ast.FunctionDef | ast.AsyncFunctionDef,
    module: str,
    docs: dict[str, str],
    deprecations: dict[str, dict[str, str]],
    version: str,
    owner: str | None = None,
) -> tuple[list[str], str]:
    qualname = f"{module}.{node.name}" if owner is None else f"{module}.{owner}.{node.name}"
    raw_doc = clean_docstring(ast.get_docstring(node)) or docs.get(qualname, "")
    doc, metadata = parse_docstring_metadata(raw_doc)
    doc = format_docstring(doc, qualname, metadata, deprecations, version)
    if not doc:
        doc = fallback_docstring(node.name, module, owner)
    prefix = "async def" if isinstance(node, ast.AsyncFunctionDef) else "def"
    returns = f" -> {annotation(node.returns)}" if node.returns is not None else " -> Any"
    decorators = []
    for dec in node.decorator_list:
        if isinstance(dec, ast.Name) and dec.id == "property":
            decorators.append("@property")
    lines = decorators + [f"{prefix} {node.name}({render_arguments(node.args)}){returns}:"]
    lines.extend(render_docstring(doc, "    "))
    lines.extend(stub_body(node.name, "    "))
    return lines, node.name


def render_class(
    node: ast.ClassDef,
    module: str,
    docs: dict[str, str],
    deprecations: dict[str, dict[str, str]],
    version: str,
) -> tuple[list[str], str]:
    qualname = f"{module}.{node.name}"
    raw_doc = clean_docstring(ast.get_docstring(node)) or docs.get(qualname, "")
    doc, metadata = parse_docstring_metadata(raw_doc)
    doc = format_docstring(doc, qualname, metadata, deprecations, version)
    if not doc:
        doc = fallback_docstring(node.name, module, kind="class")
    bases = ", ".join(
        ast.unparse(base)
        for base in node.bases
        if isinstance(base, ast.Name) and base.id in SAFE_CLASS_BASES
    )
    class_head = f"class {node.name}({bases}):" if bases else f"class {node.name}:"
    lines = [class_head]
    lines.extend(render_docstring(doc, "    "))
    names: list[str] = []

    for child in node.body:
        if isinstance(child, ast.AnnAssign) and isinstance(child.target, ast.Name) and public_name(child.target.id):
            value = f" = {ast.unparse(child.value)}" if child.value is not None else ""
            lines.append(f"    {child.target.id}: {annotation(child.annotation)}{value}")
        elif isinstance(child, ast.Assign):
            targets = [target.id for target in child.targets if isinstance(target, ast.Name) and public_name(target.id)]
            for target in targets:
                lines.append(f"    {target} = {ast.unparse(child.value)}")
        elif isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) and public_name(child.name):
            method_lines, _ = render_function(child, module, docs, deprecations, version, node.name)
            lines.append("")
            lines.extend("    " + line if line else "" for line in method_lines)

    if len(lines) == 1 or (len(lines) == 2 and lines[1].strip().startswith('"""')):
        lines.append("    pass")
    return lines, node.name


def safe_sdk_value(node: ast.AST | None) -> bool:
    if node is None:
        return True
    if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name) and node.value.id == "Literal":
        return True
    try:
        ast.literal_eval(node)
        return True
    except Exception:
        return False


def render_assign(node: ast.Assign | ast.AnnAssign) -> tuple[list[str], list[str]]:
    lines: list[str] = []
    names: list[str] = []
    if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and public_name(node.target.id):
        if not safe_sdk_value(node.value):
            return [], []
        names.append(node.target.id)
        value = f" = {ast.unparse(node.value)}" if node.value is not None else ""
        lines.append(f"{node.target.id}: {annotation(node.annotation)}{value}")
    elif isinstance(node, ast.Assign):
        if not safe_sdk_value(node.value):
            return [], []
        target_names = [target.id for target in node.targets if isinstance(target, ast.Name) and public_name(target.id)]
        for target in target_names:
            names.append(target)
            lines.append(f"{target} = {ast.unparse(node.value)}")
    return lines, names


def render_module(
    server_path: Path,
    module: str,
    docs: dict[str, str],
    deprecations: dict[str, dict[str, str]],
    version: str,
) -> tuple[str, list[str]]:
    tree = read_tree(server_path)
    module_doc = docs.get(f"{module}.__module__", clean_docstring(ast.get_docstring(tree)) or f"Generated SDK stubs for OmniPlayr backend `{module}` helpers.")
    lines = [
        "# This file is generated from the OmniPlayr server backend.",
        "from __future__ import annotations",
        "",
        "from typing import Any, Callable, Literal",
        "",
        RUNTIME_ERROR_IMPORT,
        "",
    ]
    lines.extend(render_docstring(module_doc, ""))
    lines.append("")

    exports: list[str] = []
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            continue
        if isinstance(node, ast.ClassDef) and public_name(node.name):
            rendered, name = render_class(node, module, docs, deprecations, version)
            lines.extend(rendered)
            lines.append("")
            exports.append(name)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and public_name(node.name):
            rendered, name = render_function(node, module, docs, deprecations, version)
            lines.extend(rendered)
            lines.append("")
            exports.append(name)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            rendered, names = render_assign(node)
            if rendered:
                lines.extend(rendered)
                lines.append("")
                exports.extend(names)

    lines.append(f"__all__ = {sorted(set(exports))!r}")
    lines.append("")
    return "\n".join(lines), sorted(set(exports))


def write_static_files(package_dir: Path) -> None:
    (package_dir / "_runtime.py").write_text(
        '''"""Runtime placeholders for the generated OmniPlayr backend SDK."""

from __future__ import annotations


class OmniPlayrRuntimeUnavailableError(RuntimeError):
    """Raised when an OmniPlayr server-only API is used outside the runtime."""


def runtime_unavailable(name: str) -> OmniPlayrRuntimeUnavailableError:
    """Return an error for APIs that are only implemented by the server."""

    return OmniPlayrRuntimeUnavailableError(
        f"{name} is provided by the OmniPlayr backend runtime. "
        "The omniplayr-plugins package only supplies development-time typing, "
        "imports, docstrings, and autocomplete support."
    )
''',
        encoding="utf-8",
    )
    (package_dir / "py.typed").write_text("", encoding="utf-8")
    (package_dir / "api.py").write_text(
        '''"""Typed route decorators for OmniPlayr backend plugin API routes."""

from __future__ import annotations

from typing import Any, Callable


RouteHandler = Callable[..., Any]
RouteDecorator = Callable[[RouteHandler], RouteHandler]


class PluginApi:
    """Development-time facade for OmniPlayr backend plugin routes.

    [View Documentation](https://omniplayr.wokki20.nl/docs/plugins/building/backend/routes.html#registering-routes)
    """

    def route(self, method: str, path: str, **kwargs: Any) -> RouteDecorator:
        """Create a typed route decorator."""

        def decorator(handler: RouteHandler) -> RouteHandler:
            return handler

        return decorator

    def get(self, path: str, **kwargs: Any) -> RouteDecorator:
        """Decorate a GET route for a backend plugin."""

        return self.route("GET", path, **kwargs)

    def post(self, path: str, **kwargs: Any) -> RouteDecorator:
        """Decorate a POST route for a backend plugin."""

        return self.route("POST", path, **kwargs)

    def put(self, path: str, **kwargs: Any) -> RouteDecorator:
        """Decorate a PUT route for a backend plugin."""

        return self.route("PUT", path, **kwargs)

    def patch(self, path: str, **kwargs: Any) -> RouteDecorator:
        """Decorate a PATCH route for a backend plugin."""

        return self.route("PATCH", path, **kwargs)

    def delete(self, path: str, **kwargs: Any) -> RouteDecorator:
        """Decorate a DELETE route for a backend plugin."""

        return self.route("DELETE", path, **kwargs)


api = PluginApi()

__all__ = ["PluginApi", "RouteDecorator", "RouteHandler", "api"]
''',
        encoding="utf-8",
    )


def update_pyproject_version(pyproject: Path, version: str) -> None:
    text = pyproject.read_text(encoding="utf-8")
    text = re.sub(r'^version = ".*"$', f'version = "{version}"', text, count=1, flags=re.MULTILINE)
    pyproject.write_text(text, encoding="utf-8")


def load_deprecations(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    result: dict[str, dict[str, str]] = {}
    for key, value in data.items():
        if isinstance(key, str) and isinstance(value, dict) and isinstance(value.get("since"), str):
            result[key] = {"since": value["since"]}
    return result


def main() -> None:
    args = parse_args()
    server_repo = args.server_repo.resolve()
    sdk_repo = args.sdk_repo.resolve()
    package_dir = sdk_repo / "backend" / "src" / "omniplayr" / "plugins"
    package_root = sdk_repo / "backend" / "src" / "omniplayr"
    config = json.loads((server_repo / "backend" / "config.json").read_text(encoding="utf-8"))
    version = str(config["version"])
    deprecations_path = sdk_repo / "backend" / "deprecations.json"
    deprecations = load_deprecations(deprecations_path)

    docs = collect_existing_docstrings(package_dir)

    if package_dir.exists():
        shutil.rmtree(package_dir)
    package_dir.mkdir(parents=True, exist_ok=True)
    package_root.mkdir(parents=True, exist_ok=True)
    (package_root / "__init__.py").write_text('"""Namespace package for OmniPlayr development SDKs."""\n', encoding="utf-8")
    write_static_files(package_dir)

    all_modules = {**HELPER_MODULES, **EXTRA_RUNTIME_MODULES}
    module_exports: dict[str, list[str]] = {}
    module_exports["api"] = ["PluginApi", "RouteDecorator", "RouteHandler", "api"]
    for module, relative in all_modules.items():
        content, exports = render_module(server_repo / relative, module, docs, deprecations, version)
        (package_dir / f"{module}.py").write_text(content, encoding="utf-8")
        module_exports[module] = exports

    init_lines = [
        '"""Public backend development SDK for OmniPlayr plugins."""',
        "",
        "from __future__ import annotations",
        "",
        "from typing import Any, Callable",
        "",
        "from ._runtime import OmniPlayrRuntimeUnavailableError",
        "from ._runtime import runtime_unavailable",
    ]
    exported = ["OmniPlayrRuntimeUnavailableError"]
    for module in sorted(module_exports):
        init_lines.append(f"from .{module} import *")
        exported.extend(module_exports[module])
    init_lines.extend(
        [
            "",
            "BackendPlugin = PluginBase",
            "call_plugin_function = call",
            "is_plugin_available = is_installed",
            "is_plugin_function_available = has_function",
            "",
            "def expose_function(function_name: str, function: Callable[..., Any] | None = None) -> Any:",
            '    """Expose a callable for the current backend plugin."""',
            '    raise runtime_unavailable("expose_function")',
            "",
            f"__all__ = {sorted(set(exported + ['BackendPlugin', 'call_plugin_function', 'expose_function', 'is_plugin_available', 'is_plugin_function_available']))!r}",
            "",
        ]
    )
    (package_dir / "__init__.py").write_text("\n".join(init_lines), encoding="utf-8")

    update_pyproject_version(sdk_repo / "backend" / "pyproject.toml", version)
    deprecations_path.write_text(json.dumps(deprecations, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
