"""Symbol index for SourceWeb.

Each project is a directory (normally a git repo). Symbols come from
universal-ctags and live in SQLite; references are found on demand with
ripgrep and attributed to the innermost enclosing symbol, which is how the
Relation window builds call trees.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

EXCLUDE_DIRS = {
    ".git", "node_modules", "dist", "build", ".venv", "venv", "__pycache__",
    "storybook-static", ".next", ".terraform", "coverage", ".mypy_cache",
    ".pytest_cache", ".ruff_cache", "vendor",
}
MAX_FILE_BYTES = 1_500_000
BINARY_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".zip", ".gz", ".woff",
    ".woff2", ".ttf", ".otf", ".eot", ".mp4", ".mov", ".webp", ".lock",
    ".pyc", ".so", ".dylib", ".jar", ".class", ".bin", ".tsbuildinfo",
}
CALLABLE_KINDS = {
    "function", "method", "member", "constructor", "procedure", "subroutine",
    "func", "macro", "getter", "setter", "generator", "accessor",
}
CONTAINER_KINDS = CALLABLE_KINDS | {
    "class", "struct", "interface", "module", "namespace", "enum", "type",
    "resource", "data", "trait", "impl", "object", "component",
}
IDENT_RE = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")
KEYWORDS = set("""
if else elif for while return def class import from as with try except finally
raise pass break continue lambda yield async await not and or in is None True
False self cls const let var function new this super typeof instanceof switch
case default throw catch void delete export extends implements interface type
enum public private protected static readonly package func go defer chan map
struct range select fallthrough nil true false null undefined print len str int
float bool dict list set tuple object any string number boolean
""".split())


def is_indexable(path: Path) -> bool:
    if path.suffix.lower() in BINARY_EXT:
        return False
    name = path.name
    if name.endswith((".min.js", ".min.css", ".map")) or name in {"package-lock.json", "uv.lock", "poetry.lock", "yarn.lock", "pnpm-lock.yaml"}:
        return False
    try:
        return path.stat().st_size <= MAX_FILE_BYTES
    except OSError:
        return False


@dataclass
class Project:
    name: str
    root: Path
    files: list[str] = field(default_factory=list)
    indexed_at: float = 0.0
    symbol_count: int = 0


class Index:
    def __init__(self, workspace: Path, db_path: Path):
        self.workspace = workspace
        self.db_path = db_path
        self.projects: dict[str, Project] = {}
        self.lock = threading.RLock()
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS symbols (
              project TEXT, name TEXT, kind TEXT, path TEXT, line INT, end INT,
              scope TEXT, scope_kind TEXT, signature TEXT, lang TEXT,
              typeref TEXT, inherits TEXT, access TEXT
            );
            CREATE INDEX IF NOT EXISTS ix_sym_name ON symbols(project, name);
            CREATE INDEX IF NOT EXISTS ix_sym_lname ON symbols(project, name COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS ix_sym_path ON symbols(project, path);
            CREATE TABLE IF NOT EXISTS meta (project TEXT PRIMARY KEY, indexed_at REAL, head TEXT);
            """
        )
        self.discover()

    # ------------------------------------------------------------ projects
    # ------------------------------------------------------------ registry
    # Projects are the folders inside the workspace directory plus any folders the user adds
    # (stored in <data>/projects.json). Removing a project only unregisters it; files are never deleted.
    @property
    def registry_path(self) -> Path:
        return self.db_path.parent / "projects.json"

    def _registry(self) -> dict:
        try:
            return json.loads(self.registry_path.read_text())
        except (OSError, json.JSONDecodeError):
            return {"added": {}, "hidden": []}

    def _save_registry(self, reg: dict) -> None:
        self.registry_path.write_text(json.dumps(reg, indent=1))

    def discover(self) -> None:
        reg = self._registry()
        with self.lock:
            if self.workspace.is_dir():
                for d in sorted(self.workspace.iterdir()):
                    if d.is_dir() and not d.name.startswith(".") and d.name not in reg.get("hidden", []):
                        self.projects.setdefault(d.name, Project(d.name, d))
            for name, path in reg.get("added", {}).items():
                if Path(path).is_dir():
                    self.projects.setdefault(name, Project(name, Path(path)))

    def add_project(self, path: Path, name: str | None = None) -> Project:
        path = path.expanduser().resolve()
        if not path.is_dir():
            raise FileNotFoundError(str(path))
        name = re.sub(r"[^\w.-]+", "-", name or path.name).strip("-") or "project"
        base, i = name, 2
        while name in self.projects and self.projects[name].root.resolve() != path:
            name, i = f"{base}-{i}", i + 1
        reg = self._registry()
        if path.parent != self.workspace.resolve():
            reg.setdefault("added", {})[name] = str(path)
        if name in reg.get("hidden", []):
            reg["hidden"].remove(name)
        self._save_registry(reg)
        with self.lock:
            self.projects[name] = Project(name, path)
        return self.projects[name]

    def remove_project(self, name: str) -> None:
        reg = self._registry()
        p = self.project(name)
        if name in reg.get("added", {}):
            del reg["added"][name]
        elif p.root.parent.resolve() == self.workspace.resolve():
            reg.setdefault("hidden", []).append(name)
        self._save_registry(reg)
        with self.lock:
            self.projects.pop(name, None)
            self.db.execute("DELETE FROM symbols WHERE project=?", (name,))
            self.db.execute("DELETE FROM meta WHERE project=?", (name,))
            self.db.commit()

    def project(self, name: str) -> Project:
        p = self.projects.get(name)
        if not p:
            raise KeyError(name)
        return p

    def safe_path(self, project: str, rel: str) -> Path:
        root = self.project(project).root.resolve()
        full = (root / rel).resolve()
        if full != root and root not in full.parents:
            raise PermissionError(rel)
        return full

    def list_files(self, project: str) -> list[str]:
        p = self.project(project)
        out: list[str] = []
        try:
            res = subprocess.run(
                ["git", "-C", str(p.root), "ls-files", "-co", "--exclude-standard"],
                capture_output=True, text=True, timeout=30,
            )
            if res.returncode == 0:
                out = [f for f in res.stdout.splitlines() if f]
        except (OSError, subprocess.TimeoutExpired):
            pass
        if not out:
            for dirpath, dirnames, filenames in os.walk(p.root):
                dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
                for f in filenames:
                    out.append(os.path.relpath(os.path.join(dirpath, f), p.root))
        out = [f for f in out if not (set(Path(f).parts) & EXCLUDE_DIRS) and (p.root / f).is_file()]
        out.sort(key=str.lower)
        p.files = out
        return out

    def git_head(self, project: str) -> str:
        p = self.project(project)
        res = subprocess.run(["git", "-C", str(p.root), "rev-parse", "HEAD"], capture_output=True, text=True)
        return res.stdout.strip()

    # ------------------------------------------------------------- indexing
    def _ctags(self, root: Path, files: list[str]) -> list[dict]:
        if not files:
            return []
        cmd = [
            "ctags", "--output-format=json", "--fields=+neKSZlia", "--extras=-F",
            "--sort=no", "-L", "-", "-f", "-",
        ]
        res = subprocess.run(cmd, input="\n".join(files), capture_output=True, text=True, cwd=root, timeout=300)
        tags = []
        for line in res.stdout.splitlines():
            try:
                t = json.loads(line)
            except json.JSONDecodeError:
                continue
            if t.get("_type") == "tag" and t.get("name"):
                tags.append(t)
        return tags

    def _rows(self, project: str, tags: list[dict]):
        for t in tags:
            yield (
                project, t["name"], t.get("kind", ""), t["path"], t.get("line", 0),
                t.get("end") or t.get("line", 0), t.get("scope", ""), t.get("scopeKind", ""),
                t.get("signature", ""), t.get("language", ""),
                (t.get("typeref") or "").removeprefix("typename:"), ("" if str(t.get("inherits", "")) in ("0", "False") else str(t.get("inherits", ""))),
                t.get("access", ""),
            )

    def index_project(self, project: str, force: bool = False) -> Project:
        p = self.project(project)
        head = self.git_head(project)
        with self.lock:
            row = self.db.execute("SELECT indexed_at, head FROM meta WHERE project=?", (project,)).fetchone()
        files = self.list_files(project)
        if row and not force and row[1] == head and row[0] > self._latest_mtime(p, files):
            p.indexed_at = row[0]
            p.symbol_count = self.db.execute("SELECT COUNT(*) FROM symbols WHERE project=?", (project,)).fetchone()[0]
            return p
        idx_files = [f for f in files if is_indexable(p.root / f)]
        tags = self._ctags(p.root, idx_files)
        with self.lock:
            self.db.execute("DELETE FROM symbols WHERE project=?", (project,))
            self.db.executemany("INSERT INTO symbols VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", self._rows(project, tags))
            now = time.time()
            self.db.execute("INSERT OR REPLACE INTO meta VALUES (?,?,?)", (project, now, head))
            self.db.commit()
        p.indexed_at = now
        p.symbol_count = len(tags)
        return p

    def _latest_mtime(self, p: Project, files: list[str]) -> float:
        latest = 0.0
        for f in files:
            try:
                latest = max(latest, (p.root / f).stat().st_mtime)
            except OSError:
                pass
        return latest

    def reindex_file(self, project: str, rel: str) -> None:
        p = self.project(project)
        tags = self._ctags(p.root, [rel]) if is_indexable(p.root / rel) else []
        with self.lock:
            self.db.execute("DELETE FROM symbols WHERE project=? AND path=?", (project, rel))
            self.db.executemany("INSERT INTO symbols VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", self._rows(project, tags))
            self.db.commit()

    def index_all(self) -> None:
        for name in list(self.projects):
            try:
                self.index_project(name)
            except Exception as exc:  # keep going; one broken repo must not stop the rest
                print(f"[index] {name}: {exc}")

    # -------------------------------------------------------------- queries
    COLS = "name, kind, path, line, end, scope, scope_kind, signature, lang, typeref, inherits, access, project"

    def _dicts(self, rows) -> list[dict]:
        keys = [c.strip() for c in self.COLS.split(",")]
        return [dict(zip(keys, r)) for r in rows]

    def file_symbols(self, project: str, path: str) -> list[dict]:
        with self.lock:
            rows = self.db.execute(
                f"SELECT {self.COLS} FROM symbols WHERE project=? AND path=? ORDER BY line", (project, path)
            ).fetchall()
        return self._dicts(rows)

    def search_symbols(self, project: str | None, query: str, limit: int = 200, kinds: list[str] | None = None) -> list[dict]:
        """Prefix matches first, then substring, then camel/underscore initials."""
        q = query.strip()
        if not q:
            return []
        where_proj = "project=? AND " if project else ""
        args_proj = [project] if project else []
        kind_sql = ""
        if kinds:
            kind_sql = f" AND kind IN ({','.join('?' * len(kinds))})"
        results: list[dict] = []
        seen = set()
        patterns = [(q.replace("%", r"\%") + "%"), ("%" + q.replace("%", r"\%") + "%")]
        with self.lock:
            for pat in patterns:
                rows = self.db.execute(
                    f"SELECT {self.COLS} FROM symbols WHERE {where_proj} name LIKE ? ESCAPE '\\' {kind_sql} "
                    f"ORDER BY length(name), name LIMIT ?",
                    [*args_proj, pat, *(kinds or []), limit],
                ).fetchall()
                for d in self._dicts(rows):
                    key = (d["project"], d["path"], d["line"], d["name"])
                    if key not in seen:
                        seen.add(key)
                        results.append(d)
                if len(results) >= limit:
                    break
        if len(results) < limit and len(q) >= 2 and " " not in q:
            # fuzzy subsequence (e.g. "gpd" -> get_patient_data)
            rx = re.compile(".*?".join(map(re.escape, q)), re.I)
            with self.lock:
                rows = self.db.execute(
                    f"SELECT {self.COLS} FROM symbols WHERE {where_proj} name LIKE ? {kind_sql} LIMIT 20000",
                    [*args_proj, f"%{q[0]}%", *(kinds or [])],
                ).fetchall()
            for d in self._dicts(rows):
                key = (d["project"], d["path"], d["line"], d["name"])
                if key not in seen and rx.search(d["name"]):
                    seen.add(key)
                    results.append(d)
                    if len(results) >= limit:
                        break
        return results[:limit]

    def definitions(self, project: str, name: str, from_path: str | None = None) -> list[dict]:
        with self.lock:
            rows = self.db.execute(f"SELECT {self.COLS} FROM symbols WHERE project=? AND name=?", (project, name)).fetchall()
        defs = self._dicts(rows)
        if not defs:
            with self.lock:
                rows = self.db.execute(
                    f"SELECT {self.COLS} FROM symbols WHERE name=? LIMIT 50", (name,)
                ).fetchall()
            defs = self._dicts(rows)

        def rank(d: dict):
            same_file = d["path"] == from_path and d["project"] == project
            same_dir = from_path and Path(d["path"]).parent == Path(from_path).parent
            callable_ = d["kind"] in CONTAINER_KINDS
            return (not same_file, not same_dir, not callable_, d["kind"] in {"variable", "parameter", "local"}, d["path"], d["line"])

        defs.sort(key=rank)
        return defs

    def enclosing(self, project: str, path: str, line: int) -> dict | None:
        with self.lock:
            rows = self.db.execute(
                f"SELECT {self.COLS} FROM symbols WHERE project=? AND path=? AND line<=? AND end>=? AND end>line",
                (project, path, line, line),
            ).fetchall()
        cands = [d for d in self._dicts(rows) if d["kind"] in CONTAINER_KINDS]
        if not cands:
            return None
        cands.sort(key=lambda d: (d["end"] - d["line"]))
        return cands[0]

    # --------------------------------------------------------- references
    def references(self, project: str | None, name: str, limit: int = 2000, whole_workspace: bool = False) -> list[dict]:
        roots = [(n, self.project(n).root) for n in (self.projects if (whole_workspace or not project) else [project])]
        hits: list[dict] = []
        for pname, root in roots:
            cmd = [
                "rg", "--json", "-w", "-F", "--max-filesize", "1500K", "-g", "!*.min.js", "-g", "!*.map",
                "-g", "!package-lock.json", "-g", "!storybook-static", "-g", "!node_modules", name, ".",
            ]
            try:
                res = subprocess.run(cmd, capture_output=True, text=True, cwd=root, timeout=60)
            except subprocess.TimeoutExpired:
                continue
            for line in res.stdout.splitlines():
                try:
                    m = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if m.get("type") != "match":
                    continue
                data = m["data"]
                path = data["path"].get("text", "").removeprefix("./")
                text = data["lines"].get("text", "").rstrip("\n")
                cols = [s["start"] for s in data.get("submatches", [])]
                hits.append({
                    "project": pname, "path": path, "line": data["line_number"],
                    "col": cols[0] if cols else 0, "text": text[:400],
                })
                if len(hits) >= limit:
                    return hits
        return hits

    def callers(self, project: str, name: str, limit: int = 300) -> list[dict]:
        """Functions whose body references `name` (Relation window: References tree)."""
        defs = {(d["path"], d["line"]) for d in self.definitions(project, name)}
        groups: dict[tuple, dict] = {}
        for h in self.references(project, name, limit=limit * 5):
            if (h["path"], h["line"]) in defs:
                continue
            enc = self.enclosing(h["project"], h["path"], h["line"])
            if enc and enc["name"] == name and (enc["path"], enc["line"]) in defs:
                continue  # recursion / self
            key = (h["path"], enc["line"] if enc else 0, enc["name"] if enc else "")
            g = groups.setdefault(key, {
                "name": enc["name"] if enc else Path(h["path"]).name,
                "kind": enc["kind"] if enc else "file",
                "path": h["path"], "line": enc["line"] if enc else h["line"],
                "end": enc["end"] if enc else h["line"], "scope": enc["scope"] if enc else "",
                "project": h["project"], "hits": [],
            })
            g["hits"].append({"line": h["line"], "text": h["text"].strip()[:200]})
        out = list(groups.values())
        out.sort(key=lambda g: (g["path"], g["line"]))
        return out[:limit]

    def callees(self, project: str, path: str, line: int, end: int | None = None) -> list[dict]:
        """Project symbols referenced inside a function body (Relation window: Calls tree)."""
        full = self.safe_path(project, path)
        try:
            lines = full.read_text(errors="replace").splitlines()
        except OSError:
            return []
        if not end or end < line:
            enc = self.enclosing(project, path, line)
            end = enc["end"] if enc else min(len(lines), line + 60)
        body = "\n".join(lines[line: end])  # skip the declaration line itself
        names: list[str] = []
        seen = set()
        for m in re.finditer(r"([A-Za-z_$][A-Za-z0-9_$]*)\s*(\(|<[^>()]*>\s*\()", body):
            n = m.group(1)
            if n in KEYWORDS or n in seen:
                continue
            seen.add(n)
            names.append(n)
        if not names:
            return []
        with self.lock:
            rows = self.db.execute(
                f"SELECT {self.COLS} FROM symbols WHERE project=? AND name IN ({','.join('?' * len(names))})",
                [project, *names],
            ).fetchall()
        by_name: dict[str, dict] = {}
        for d in self._dicts(rows):
            if d["kind"] not in CONTAINER_KINDS:
                continue
            cur = by_name.get(d["name"])
            if cur is None or (d["path"] == path and cur["path"] != path):
                by_name[d["name"]] = d
        return [by_name[n] for n in names if n in by_name]

    def hierarchy(self, project: str, name: str) -> dict:
        defs = [d for d in self.definitions(project, name) if d["kind"] in {"class", "interface", "struct", "trait"}]
        parents = []
        for d in defs:
            for base in filter(None, re.split(r"[,\s]+", d.get("inherits") or "")):
                base = base.split(".")[-1].split("[")[0]
                pd = [x for x in self.definitions(project, base) if x["kind"] in {"class", "interface", "struct", "trait"}]
                parents.append(pd[0] if pd else {"name": base, "kind": "class", "path": "", "line": 0, "project": project, "external": True})
        with self.lock:
            rows = self.db.execute(
                f"SELECT {self.COLS} FROM symbols WHERE project=? AND inherits LIKE ? AND kind IN ('class','interface','struct')",
                (project, f"%{name}%"),
            ).fetchall()
        children = [
            d for d in self._dicts(rows)
            if name in [b.split(".")[-1].split("[")[0] for b in re.split(r"[,\s]+", d["inherits"] or "")]
        ]
        return {"defs": defs, "parents": parents, "children": children}

    def project_names(self, project: str) -> dict[str, str]:
        """Distinct callable/type names, used by the editor to colour references to project symbols."""
        with self.lock:
            rows = self.db.execute(
                "SELECT name, kind FROM symbols WHERE project=? AND kind IN "
                "('function','method','member','class','interface','struct','type','enum','constant','macro','component')",
                (project,),
            ).fetchall()
        out: dict[str, str] = {}
        for n, k in rows:
            if len(n) > 2:
                out.setdefault(n, k)
        return out
