"""Server side of the SourceWeb fidelity layer: keyword-expression search, Replace Files,
annotated references, file watching (Synchronize Files), and server-stored workspaces/layouts
so a session follows the user across devices."""

from __future__ import annotations

import json
import re
import shlex
import shutil
import subprocess
import threading
import time
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException

router = APIRouter()
CTX: dict = {}  # filled by init(): index, data dir, readonly flag

RG_BASE = ["rg", "--json", "--max-filesize", "1500K", "-g", "!*.min.js", "-g", "!*.map", "-g", "!package-lock.json",
           "-g", "!storybook-static", "-g", "!node_modules", "--max-columns", "400"]


def init(index, data_dir: Path, readonly: bool) -> None:
    CTX.update(index=index, data=data_dir, readonly=readonly, versions={}, watch_errors=0)
    (data_dir / "workspaces").mkdir(exist_ok=True)
    threading.Thread(target=_watch_loop, daemon=True).start()


def _rg(root: Path, args: list[str], limit: int = 20000) -> list[dict]:
    res = subprocess.run([*RG_BASE, *args], capture_output=True, text=True, cwd=root, timeout=90)
    out = []
    for line in res.stdout.splitlines():
        try:
            m = json.loads(line)
        except json.JSONDecodeError:
            continue
        if m.get("type") != "match":
            continue
        d = m["data"]
        out.append({
            "path": d["path"].get("text", "").removeprefix("./"), "line": d["line_number"],
            "text": (d["lines"].get("text") or "").rstrip("\n")[:400],
            "ranges": [[s["start"], s["end"]] for s in d.get("submatches", [])],
        })
        if len(out) >= limit:
            break
    return out


def _annotate(project: str, hits: list[dict]) -> list[dict]:
    """Add the enclosing function/class name to each hit (SW 'include container name' option)."""
    index = CTX["index"]
    cache: dict[str, list] = {}
    for h in hits[:4000]:
        syms = cache.get(h["path"])
        if syms is None:
            syms = [s for s in index.file_symbols(project, h["path"]) if s["end"] and s["end"] > s["line"]]
            cache[h["path"]] = syms
        best = None
        for s in syms:
            if s["line"] <= h["line"] <= s["end"] and (best is None or s["end"] - s["line"] < best["end"] - best["line"]):
                best = s
        if best:
            h["fn"] = best["name"]
    return hits


COMMENT_RE = re.compile(r"^\s*(#|//|/\*|\*|--|<!--)")


@router.get("/api/projects/{project}/references2")
def references2(project: str, name: str, workspace: bool = False, case: bool = True, word: bool = True,
                glob: str = "", skip_comments: bool = False, limit: int = 3000):
    """Lookup References with options; hits carry the enclosing function name."""
    index = CTX["index"]
    names = list(index.projects) if workspace else [project]
    hits = []
    for pname in names:
        args = ["-F", "-s" if case else "-i"]
        if word:
            args.append("-w")
        for g in filter(None, glob.split(",")):
            args += ["-g", g.strip()]
        args += ["-e", name, "."]
        for h in _rg(index.project(pname).root, args, limit):
            if skip_comments and COMMENT_RE.match(h["text"]):
                continue
            h["project"] = pname
            hits.append(h)
        if len(hits) >= limit:
            break
    for pname in names:
        _annotate(pname, [h for h in hits if h["project"] == pname])
    return {"hits": hits[:limit], "truncated": len(hits) >= limit}


# ------------------------------------------------------------ keyword search
def _parse_keywords(expr: str):
    """SW keyword expressions: terms separated by spaces are ANDed; OR / | alternates; NOT / - / ! negates;
    =term is case-sensitive; ?"regex" is a regex; "quoted phrases" stay together. Returns groups (OR of ANDs)."""
    tokens = shlex.split(expr.replace("|", " OR "), posix=True) if expr.count('"') % 2 == 0 else expr.split()
    groups, cur, neg = [], [], False
    for tok in tokens:
        if tok.upper() == "OR":
            if cur:
                groups.append(cur)
            cur = []
            continue
        if tok.upper() in ("AND", "+"):
            continue
        if tok.upper() == "NOT":
            neg = True
            continue
        t = {"neg": neg, "regex": False, "case": False, "text": tok}
        neg = False
        if t["text"][:1] in "-!" and len(t["text"]) > 1:
            t["neg"], t["text"] = True, t["text"][1:]
        if t["text"].startswith("="):
            t["case"], t["text"] = True, t["text"][1:]
        if t["text"].startswith("?"):
            t["regex"], t["text"] = True, t["text"][1:]
        if t["text"]:
            cur.append(t)
    if cur:
        groups.append(cur)
    return groups


@router.get("/api/ksearch")
def keyword_search(q: str, project: str | None = None, context: int = 0, fragments: bool = True, glob: str = "",
                   limit: int = 2000):
    """Search Project with keyword expressions and 'lines of context' (all AND terms within N lines)."""
    index = CTX["index"]
    groups = _parse_keywords(q)
    if not groups:
        return {"hits": [], "truncated": False, "terms": []}
    projs = [project] if project else list(index.projects)
    out: list[dict] = []
    for pname in projs:
        root = index.project(pname).root
        for group in groups:
            pos = [t for t in group if not t["neg"]]
            if not pos:
                continue
            per_term: list[dict[str, list[int]]] = []
            first_hits: list[dict] = []
            for i, t in enumerate(group):
                args = ["-s" if t["case"] else "-i"]
                if not t["regex"]:
                    args.append("-F")
                    if not fragments:
                        args.append("-w")
                for g in filter(None, glob.split(",")):
                    args += ["-g", g.strip()]
                args += ["-e", t["text"], "."]
                hits = _rg(root, args)
                m: dict[str, list[int]] = {}
                for h in hits:
                    m.setdefault(h["path"], []).append(h["line"])
                per_term.append(m)
                if t is pos[0]:
                    first_hits = hits
            for h in first_hits:
                ok = True
                for t, m in zip(group, per_term):
                    if t is pos[0]:
                        continue
                    near = any(abs(ln - h["line"]) <= context for ln in m.get(h["path"], []))
                    if near == t["neg"]:
                        ok = False
                        break
                if ok:
                    out.append({**h, "project": pname})
                    if len(out) >= limit:
                        break
        if len(out) >= limit:
            break
        _annotate(pname, [h for h in out if h["project"] == pname])
    seen, uniq = set(), []
    for h in out:
        k = (h["project"], h["path"], h["line"])
        if k not in seen:
            seen.add(k)
            uniq.append(h)
    return {"hits": uniq, "truncated": len(uniq) >= limit, "terms": [[t["text"] for t in g if not t["neg"]] for g in groups]}


# ------------------------------------------------------------ Replace Files
def _preserve_case(src: str, repl: str) -> str:
    if src.isupper():
        return repl.upper()
    if src.islower():
        return repl.lower()
    if src[:1].isupper():
        return repl[:1].upper() + repl[1:]
    return repl


@router.post("/api/replace")
def replace_files(body: dict = Body(...)):
    """Replace across files. body: project, find, replace, regex, case, word, preserve_case, glob, files (optional
    explicit list), dry_run. Returns per-file counts; writes only when dry_run is false."""
    if CTX["readonly"] and not body.get("dry_run", True):
        raise HTTPException(403, "server is read-only")
    index = CTX["index"]
    project, find, repl = body.get("project"), body.get("find", ""), body.get("replace", "")
    if not project or not find:
        raise HTTPException(400, "project and find are required")
    root = index.project(project).root
    pat = find if body.get("regex") else re.escape(find)
    if body.get("word"):
        pat = rf"(?<![\w$]){pat}(?![\w$])"
    flags = 0 if body.get("case") else re.IGNORECASE
    try:
        rx = re.compile(pat, flags)
    except re.error as exc:
        raise HTTPException(400, f"bad regex: {exc}")
    if body.get("files"):
        files = list(body["files"])
    else:
        args = ["-l", "-s" if body.get("case") else "-i"]
        if not body.get("regex"):
            args.append("-F")
        if body.get("word"):
            args.append("-w")
        for g in filter(None, (body.get("glob") or "").split(",")):
            args += ["-g", g.strip()]
        res = subprocess.run(["rg", *args[:1], *args[1:], "--max-filesize", "1500K", "-g", "!node_modules", "-e", find, "."],
                             capture_output=True, text=True, cwd=root, timeout=90)
        files = [f.removeprefix("./") for f in res.stdout.splitlines() if f]
    report, total = [], 0
    for rel in files[:2000]:
        full = index.safe_path(project, rel)
        try:
            text = full.read_text()
        except (OSError, UnicodeDecodeError):
            continue

        def sub(m):
            r = m.expand(repl) if body.get("regex") else repl
            return _preserve_case(m.group(0), r) if body.get("preserve_case") else r

        new, n = rx.subn(sub, text)
        if n:
            total += n
            report.append({"path": rel, "count": n})
            if not body.get("dry_run", True):
                full.write_text(new)
                index.reindex_file(project, rel)
    return {"files": report, "total": total, "applied": not body.get("dry_run", True)}


# ------------------------------------------------------- Synchronize Files
def _watch_loop() -> None:
    """Poll file mtimes; re-index changed files so edits made outside the browser (git pull, an IDE) show up."""
    while True:
        try:
            _watch()
        except Exception:
            import traceback
            traceback.print_exc()
            time.sleep(5)


def _watch() -> None:
    index = CTX["index"]
    mt: dict[tuple[str, str], float] = {}
    first = True
    while True:
        changed_any = False
        for pname, p in list(index.projects.items()):
            files = p.files
            if not files:
                continue
            changed = []
            for f in files:
                try:
                    m = (p.root / f).stat().st_mtime
                except OSError:
                    continue
                key = (pname, f)
                prev = mt.get(key)
                # unseen file: compare with the index build time so writes before our first look aren't missed
                if (prev is None and p.indexed_at and m > p.indexed_at + 0.5) or (prev is not None and prev != m):
                    changed.append(f)
                mt[key] = m
            for f in changed[:200]:
                try:
                    index.reindex_file(pname, f)
                except Exception:
                    CTX["watch_errors"] += 1
            if changed:
                changed_any = True
                v = CTX["versions"].setdefault(pname, {"version": 0, "files": {}})
                v["version"] += 1
                for f in changed:
                    v["files"][f] = time.time()
        first = False
        CTX["watch_passes"] = CTX.get("watch_passes", 0) + 1
        CTX["watch_files"] = len(mt)
        time.sleep(2)


@router.get("/api/changes")
def changes(since: float = 0):
    """Files changed on disk since `since` (epoch seconds), for auto-reloading open editors."""
    out = []
    for pname, v in CTX["versions"].items():
        for f, ts in v["files"].items():
            if ts > since:
                out.append({"project": pname, "path": f, "ts": ts})
    return {"now": time.time(), "changes": out, "passes": CTX.get("watch_passes", 0), "files": CTX.get("watch_files", 0)}


# ------------------------------------------------------- workspaces/layouts
NAME_RE = re.compile(r"^[\w .-]{1,60}$")


def _ws_dir(kind: str) -> Path:
    d = CTX["data"] / kind
    d.mkdir(exist_ok=True)
    return d


@router.get("/api/state/{kind}")
def list_state(kind: str):
    if kind not in ("workspaces", "layouts"):
        raise HTTPException(404)
    out = []
    for f in sorted(_ws_dir(kind).glob("*.json")):
        out.append({"name": f.stem, "mtime": f.stat().st_mtime})
    return out


@router.get("/api/state/{kind}/{name}")
def get_state(kind: str, name: str):
    if kind not in ("workspaces", "layouts") or not NAME_RE.match(name):
        raise HTTPException(400)
    f = _ws_dir(kind) / f"{name}.json"
    if not f.exists():
        raise HTTPException(404, "not found")
    return json.loads(f.read_text())


@router.put("/api/state/{kind}/{name}")
def put_state(kind: str, name: str, body: dict = Body(...)):
    if kind not in ("workspaces", "layouts") or not NAME_RE.match(name):
        raise HTTPException(400)
    (_ws_dir(kind) / f"{name}.json").write_text(json.dumps(body))
    return {"ok": True}


@router.delete("/api/state/{kind}/{name}")
def del_state(kind: str, name: str):
    if kind not in ("workspaces", "layouts") or not NAME_RE.match(name):
        raise HTTPException(400)
    (_ws_dir(kind) / f"{name}.json").unlink(missing_ok=True)
    return {"ok": True}


# ------------------------------------------------------------ beautifier
VENDOR_BIN = Path(__file__).resolve().parent.parent / "web" / "vendor" / "node_modules" / ".bin"
VENV_BIN = Path(__file__).resolve().parent.parent / ".venv" / "bin"
PRETTIER_EXT = {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".json", ".css", ".scss", ".less", ".md", ".yaml", ".yml", ".html", ".vue", ".graphql"}


def _formatter_for(path: str) -> list[str] | None:
    ext = Path(path).suffix.lower()
    if ext in (".py", ".pyi"):
        return [str(VENV_BIN / "ruff"), "format", "--stdin-filename", path, "-"]
    if ext in PRETTIER_EXT and (VENDOR_BIN / "prettier").exists():
        return [str(VENDOR_BIN / "prettier"), "--stdin-filepath", path]
    if ext in (".tf", ".tfvars", ".hcl") and shutil.which("terraform"):
        return ["terraform", "fmt", "-"]
    if ext == ".go" and shutil.which("gofmt"):
        return ["gofmt"]
    return None


@router.post("/api/format")
def format_source(body: dict = Body(...)):
    """Code Beautifier: run the language's standard formatter (ruff / prettier / terraform fmt / gofmt) on text."""
    path, content = body.get("path", ""), body.get("content", "")
    cmd = _formatter_for(path)
    if not cmd:
        raise HTTPException(415, f"no formatter available for {Path(path).suffix or path}")
    res = subprocess.run(cmd, input=content, capture_output=True, text=True, timeout=60)
    if res.returncode != 0:
        raise HTTPException(400, (res.stderr or res.stdout).strip()[:800])
    return {"content": res.stdout, "formatter": Path(cmd[0]).name}


@router.get("/api/formatters")
def formatters():
    return {
        "python": True, "prettier": (VENDOR_BIN / "prettier").exists(),
        "terraform": bool(shutil.which("terraform")), "go": bool(shutil.which("gofmt")),
    }


# --------------------------------------------------------- directory compare
def _tree(project: str, rev: str | None) -> dict[str, str]:
    """path -> blob sha for a revision, or for the working tree when rev is empty."""
    index = CTX["index"]
    root = index.project(project).root
    if rev:
        if not re.fullmatch(r"[\w./~^@{}-]+", rev):
            raise HTTPException(400, "bad rev")
        out = subprocess.run(["git", "-C", str(root), "ls-tree", "-r", rev], capture_output=True, text=True, timeout=60)
        if out.returncode:
            raise HTTPException(400, out.stderr.strip()[:300])
        tree = {}
        for line in out.stdout.splitlines():
            meta, path = line.split("\t", 1)
            tree[path] = meta.split()[2]
        return tree
    files = index.list_files(project)
    res = subprocess.run(["git", "-C", str(root), "hash-object", "--stdin-paths"], input="\n".join(files),
                         capture_output=True, text=True, timeout=120)
    return dict(zip(files, res.stdout.split()))


@router.get("/api/dircompare")
def dir_compare(left: str, right: str, left_rev: str = "", right_rev: str = ""):
    """Directory Compare between two projects and/or revisions (e.g. a repo vs one of its branches)."""
    lt, rt = _tree(left, left_rev or None), _tree(right, right_rev or None)
    rows = []
    for path in sorted(set(lt) | set(rt), key=str.lower):
        a, b = lt.get(path), rt.get(path)
        status = "same" if a == b else "left only" if b is None else "right only" if a is None else "different"
        rows.append({"path": path, "status": status})
    counts = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return {"rows": rows, "counts": counts}


# ------------------------------------------------------- Terraform resolver
TF_KIND = {"var": "variable", "local": "local", "module": "module", "data": "data"}


def _tf_lines(project: str, path: str) -> list[str]:
    try:
        return CTX["index"].safe_path(project, path).read_text(errors="replace").splitlines()
    except OSError:
        return []


def _tf_find(project: str, directory: str, kind: str, name: str, rtype: str | None = None) -> list[dict]:
    index = CTX["index"]
    with index.lock:
        rows = index.db.execute(
            f"SELECT {index.COLS} FROM symbols WHERE project=? AND kind=? AND name=? AND lang='Terraform'",
            (project, kind, name),
        ).fetchall()
    out = []
    for d in index._dicts(rows):
        if str(Path(d["path"]).parent) != (directory or "."):
            continue
        if rtype:
            lines = _tf_lines(project, d["path"])
            if d["line"] - 1 >= len(lines) or f'"{rtype}"' not in lines[d["line"] - 1]:
                continue
        out.append(d)
    return out


def _module_source_dir(project: str, mod: dict) -> str | None:
    lines = _tf_lines(project, mod["path"])
    for ln in lines[mod["line"] - 1: mod["line"] + 200]:
        if ln.startswith("}"):
            break
        m = re.match(r'\s*source\s*=\s*"([^"]+)"', ln)
        if m:
            src = m.group(1)
            if src.startswith("."):
                p = (Path(mod["path"]).parent / src)
                parts: list[str] = []
                for seg in p.parts:
                    if seg == "..":
                        parts.pop() if parts else None
                    elif seg != ".":
                        parts.append(seg)
                return "/".join(parts) or "."
            return None
    return None


@router.get("/api/projects/{project}/tfdef")
def tf_definition(project: str, path: str, expr: str):
    """Resolve a Terraform reference expression in the module (directory) of `path`:
    var.x, local.x, module.m, module.m.output, data.type.name, type.name[.attr]."""
    directory = str(Path(path).parent)
    parts = [p for p in re.split(r"\.", re.sub(r"\[[^\]]*\]", "", expr)) if p]
    if len(parts) < 2:
        return []
    head = parts[0]
    if head in ("var", "local"):
        return _tf_find(project, directory, TF_KIND[head], parts[1])
    if head == "module":
        mods = _tf_find(project, directory, "module", parts[1])
        if len(parts) >= 3 and mods:
            src = _module_source_dir(project, mods[0])
            if src:
                outs = _tf_find(project, src, "output", parts[2])
                if outs:
                    return outs
        return mods
    if head == "data" and len(parts) >= 3:
        return _tf_find(project, directory, "data", parts[2], parts[1])
    return _tf_find(project, directory, "resource", parts[1], head)


# --------------------------------------------------------- export to HTML
@router.post("/api/projects/{project}/export")
def export_html(project: str):
    """Export Project To HTML: a static, browsable copy with line anchors and a symbol index, written under
    data/export/<project>/ and served locally at /export/<project>/ (never leaves this machine)."""
    import html as H

    index = CTX["index"]
    p = index.project(project)
    out = CTX["data"] / "export" / project
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    files = [f for f in (p.files or index.list_files(project))]
    n = 0
    style = ("<style>body{font:13px/1.45 'DejaVu Sans Mono',monospace;margin:0}a{color:#2f6fd6}"
             "header{font:14px system-ui;padding:8px 12px;background:#dfe5ee;position:sticky;top:0}"
             "table{border-collapse:collapse}td.n{color:#999;text-align:right;padding:0 10px;user-select:none}"
             "td.n a{color:#999;text-decoration:none}pre{margin:0}.d{font-weight:700;color:#7a3e9d}</style>")
    for rel in files:
        full = p.root / rel
        try:
            if full.stat().st_size > 800_000:
                continue
            text = full.read_text()
        except (OSError, UnicodeDecodeError):
            continue
        decl = {s["line"] for s in index.file_symbols(project, rel)}
        rows = []
        for i, line in enumerate(text.splitlines(), 1):
            cls = ' class="d"' if i in decl else ""
            rows.append(f'<tr id="L{i}"><td class="n"><a href="#L{i}">{i}</a></td><td><pre{cls}>{H.escape(line) or " "}</pre></td></tr>')
        dest = out / (rel + ".html")
        dest.parent.mkdir(parents=True, exist_ok=True)
        depth = "../" * rel.count("/")
        dest.write_text(f"<!doctype html><meta charset=utf-8><title>{H.escape(rel)}</title>{style}"
                        f"<header><a href='{depth}index.html'>{H.escape(project)}</a> / {H.escape(rel)}</header><table>{''.join(rows)}</table>")
        n += 1
    syms = []
    with index.lock:
        syms = index.db.execute("SELECT name, kind, path, line FROM symbols WHERE project=? AND kind NOT IN ('local','parameter') ORDER BY name COLLATE NOCASE", (project,)).fetchall()
    file_list = "".join(f"<li><a href='{H.escape(f)}.html'>{H.escape(f)}</a></li>" for f in files)
    sym_list = "".join(f"<li><a href='{H.escape(pth)}.html#L{ln}'>{H.escape(nm)}</a> <small>{H.escape(k)} · {H.escape(pth)}:{ln}</small></li>" for nm, k, pth, ln in syms[:20000])
    (out / "index.html").write_text(f"<!doctype html><meta charset=utf-8><title>{H.escape(project)}</title>{style}"
                                     f"<header>{H.escape(project)} — exported by SourceWeb</header><div style='display:flex;gap:30px;padding:12px;font:13px system-ui'>"
                                     f"<div><h3>Files ({len(files)})</h3><ul>{file_list}</ul></div><div><h3>Symbols ({len(syms)})</h3><ul>{sym_list}</ul></div></div>")
    return {"files": n, "url": f"/export/{project}/index.html"}


# ------------------------------------------------- smart reference matching
# Python: jedi resolves the exact symbol (imports, scopes, attributes), like SW's "Smart Reference Matching".
_jedi_projects: dict[str, object] = {}


def _jedi_script(project: str, path: str):
    import jedi

    index = CTX["index"]
    root = index.project(project).root
    if project not in _jedi_projects:
        _jedi_projects[project] = jedi.Project(str(root))
    full = index.safe_path(project, path)
    return jedi.Script(path=str(full), project=_jedi_projects[project]), root


def _sym_at(project: str, rel: str, line: int) -> dict | None:
    for s in CTX["index"].file_symbols(project, rel):
        if s["line"] == line:
            return s
    return None


@router.get("/api/projects/{project}/smartdef")
def smart_definition(project: str, path: str, line: int, col: int):
    if not path.endswith((".py", ".pyi")):
        return []
    try:
        script, root = _jedi_script(project, path)
        names = script.goto(line, max(0, col - 1), follow_imports=True)
    except Exception:
        return []
    out = []
    for n in names:
        if not n.module_path or n.line is None:
            continue
        try:
            rel = str(Path(n.module_path).resolve().relative_to(root.resolve()))
        except ValueError:
            continue  # stdlib / site-packages
        s = _sym_at(project, rel, n.line) or {"name": n.name, "kind": n.type, "path": rel, "line": n.line, "end": n.line, "scope": "", "signature": "", "project": project}
        s = {**s, "project": project}
        out.append(s)
    return out


@router.get("/api/projects/{project}/smartrefs")
def smart_references(project: str, path: str, line: int, col: int):
    if not path.endswith((".py", ".pyi")):
        raise HTTPException(415, "smart references are available for Python files")
    script, root = _jedi_script(project, path)
    refs = script.get_references(line, max(0, col - 1), include_builtins=False)
    hits = []
    cache: dict[str, list[str]] = {}
    for r in refs:
        if not r.module_path:
            continue
        try:
            rel = str(Path(r.module_path).resolve().relative_to(root.resolve()))
        except ValueError:
            continue
        lines = cache.setdefault(rel, (root / rel).read_text(errors="replace").splitlines())
        text = lines[r.line - 1] if r.line - 1 < len(lines) else ""
        hits.append({"project": project, "path": rel, "line": r.line, "col": r.column, "text": text[:400],
                     "ranges": [[len(text[: r.column].encode()), len(text[: r.column].encode()) + len(r.name.encode())]]})
    _annotate(project, hits)
    return {"hits": hits, "truncated": False, "name": refs[0].name if refs else ""}


# ------------------------------------------------------------ project report
@router.get("/api/projects/{project}/report.rpt")
def project_report(project: str, symbols: bool = True, sort: str = "line"):
    """SourceWeb style Project Report: every file, optionally with its symbols (kind, line)."""
    from fastapi.responses import PlainTextResponse

    index = CTX["index"]
    p = index.project(project)
    files = p.files or index.list_files(project)
    out = [f"Project Report: {project}", f"Generated by SourceWeb {time.strftime('%Y-%m-%d %H:%M')}", f"{len(files)} files", ""]
    for f in files:
        out.append(f)
        if symbols:
            syms = [s for s in index.file_symbols(project, f) if s["kind"] not in ("local", "parameter")]
            if sort == "name":
                syms.sort(key=lambda s: s["name"].lower())
            for s in syms:
                out.append(f"    {s['line']:>6}  {s['kind']:<12} {(s['scope'] + '.') if s['scope'] else ''}{s['name']}")
    return PlainTextResponse("\n".join(out) + "\n", headers={"Content-Disposition": f'attachment; filename="{project}.RPT"'})
