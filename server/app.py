"""SourceWeb: a browser-based, SourceWeb style code browser.

Run:  SW_WORKSPACE=~/SourceWeb/projects .venv/bin/python -m server.app   (or ./run.sh)
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import re
import secrets
import subprocess
import threading
from pathlib import Path

import uvicorn
from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import features
from .indexer import Index

BASE = Path(__file__).resolve().parent.parent
WEB = BASE / "web"
DATA = Path(os.environ.get("SW_DATA", BASE / "data")).expanduser()
DATA.mkdir(exist_ok=True)
WORKSPACE = Path(os.environ.get("SW_WORKSPACE", Path.home() / "SourceWeb" / "projects")).expanduser()
WORKSPACE.mkdir(parents=True, exist_ok=True)
TOKEN_FILE = DATA / "token"
if not TOKEN_FILE.exists():
    TOKEN_FILE.write_text(secrets.token_urlsafe(18))
    TOKEN_FILE.chmod(0o600)
TOKEN = os.environ.get("SW_TOKEN") or TOKEN_FILE.read_text().strip()
COOKIE = "sw_session"
SESSION = hashlib.sha256(("sw:" + TOKEN).encode()).hexdigest()
READONLY = os.environ.get("SW_READONLY") == "1"

index = Index(WORKSPACE, DATA / "index.db")
app = FastAPI(title="SourceWeb", docs_url=None, redoc_url=None)
_index_state = {"running": False, "done": 0, "total": 0, "current": ""}


def _background_index() -> None:
    _index_state.update(running=True, total=len(index.projects), done=0)
    for name in list(index.projects):
        _index_state["current"] = name
        try:
            index.index_project(name)
        except Exception as exc:
            print(f"[index] {name}: {exc}")
        _index_state["done"] += 1
    _index_state.update(running=False, current="")


threading.Thread(target=_background_index, daemon=True).start()
features.init(index, DATA, READONLY)


# ------------------------------------------------------------------ auth
LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}


@app.middleware("http")
async def auth(request: Request, call_next):
    tok = request.query_params.get("token")
    if tok and secrets.compare_digest(tok, TOKEN):
        resp = RedirectResponse(str(request.url.remove_query_params("token")))
        resp.set_cookie(COOKIE, SESSION, httponly=True, samesite="strict", max_age=60 * 60 * 24 * 30)
        return resp
    client = request.client.host if request.client else ""
    ok = request.cookies.get(COOKIE) == SESSION or (client in LOCAL_HOSTS and os.environ.get("SW_LOCAL_NOAUTH", "1") == "1")
    if not ok:
        if request.url.path.startswith("/api/"):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return HTMLResponse(LOGIN_HTML, status_code=401)
    return await call_next(request)


LOGIN_HTML = """<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>SourceWeb</title><body style="font:15px system-ui;background:#1e1f22;color:#ddd;display:grid;place-items:center;height:100vh;margin:0">
<form onsubmit="location.search='?token='+encodeURIComponent(t.value);return false" style="display:grid;gap:10px;width:min(320px,90vw)">
<b style="font-size:20px">SourceWeb</b><span style="opacity:.7">Enter the access token printed by the server (data/token).</span>
<input id=t autofocus placeholder="access token" style="padding:10px;border-radius:6px;border:1px solid #555;background:#2b2d30;color:#eee">
<button style="padding:10px;border-radius:6px;border:0;background:#3574f0;color:#fff">Open</button></form>"""


def _err(exc: Exception):
    if isinstance(exc, KeyError):
        raise HTTPException(404, f"unknown project {exc}")
    if isinstance(exc, PermissionError):
        raise HTTPException(403, "path outside project")
    raise exc


def git(project: str, *args: str, check: bool = False, timeout: int = 30) -> str:
    root = index.project(project).root
    res = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, timeout=timeout)
    if check and res.returncode != 0:
        raise HTTPException(400, res.stderr.strip()[:500])
    return res.stdout


# ------------------------------------------------------------- projects
@app.get("/api/status")
def status():
    import getpass
    return {"workspace": str(WORKSPACE), "index": _index_state, "readonly": READONLY, "user": getpass.getuser()}


@app.post("/api/projects/add")
def add_project(body: dict = Body(...)):
    """New Project: register a local folder, or clone a git URL into the workspace. Symbols are built in the
    background and kept in sync by the file watcher."""
    if READONLY:
        raise HTTPException(403, "server is read-only")
    src = (body.get("path") or "").strip()
    name = (body.get("name") or "").strip() or None
    if not src:
        raise HTTPException(400, "path or git URL required")
    if re.match(r"^(https?://|git@|ssh://)", src):
        target = WORKSPACE / (name or re.sub(r"\.git$", "", src.rstrip("/").split("/")[-1].split(":")[-1]))
        if target.exists():
            raise HTTPException(409, f"{target.name} already exists in the workspace")
        res = subprocess.run(["git", "clone", "--quiet", src, str(target)], capture_output=True, text=True, timeout=1800)
        if res.returncode:
            raise HTTPException(400, res.stderr.strip()[:500] or "git clone failed")
        src = str(target)
    try:
        p = index.add_project(Path(src), name)
    except FileNotFoundError:
        raise HTTPException(404, f"folder not found on the server: {src}")

    def build():
        try:
            index.index_project(p.name, force=True)
        except Exception as exc:
            print(f"[index] {p.name}: {exc}")

    threading.Thread(target=build, daemon=True).start()
    return {"name": p.name, "path": str(p.root)}


@app.delete("/api/projects/{project}")
def remove_project(project: str):
    """Remove Project: unregister it and drop its symbols. Files on disk are never touched."""
    if READONLY:
        raise HTTPException(403, "server is read-only")
    try:
        index.remove_project(project)
    except KeyError:
        raise HTTPException(404, "unknown project")
    return {"ok": True}


@app.get("/api/projects")
def projects():
    out = []
    for name, p in index.projects.items():
        out.append({"name": name, "indexed": bool(p.indexed_at), "symbols": p.symbol_count, "files": len(p.files)})
    return out


@app.post("/api/projects/{project}/reindex")
def reindex(project: str):
    try:
        p = index.index_project(project, force=True)
    except Exception as exc:
        _err(exc)
    return {"symbols": p.symbol_count, "files": len(p.files)}


@app.get("/api/projects/{project}/files")
def files(project: str):
    try:
        p = index.project(project)
        return p.files or index.list_files(project)
    except Exception as exc:
        _err(exc)


@app.get("/api/projects/{project}/summary")
def summary(project: str):
    """Project report: languages, sizes, symbol kinds, contributors, branches."""
    try:
        p = index.project(project)
    except Exception as exc:
        _err(exc)
    fl = p.files or index.list_files(project)
    langs: dict[str, int] = {}
    lines_total = 0
    for f in fl:
        ext = Path(f).suffix.lower() or Path(f).name
        langs[ext] = langs.get(ext, 0) + 1
    with index.lock:
        kinds = index.db.execute(
            "SELECT kind, COUNT(*) FROM symbols WHERE project=? GROUP BY kind ORDER BY 2 DESC", (project,)
        ).fetchall()
    authors = [l.strip().split(None, 1) for l in git(project, "shortlog", "-sn", "--all", "--no-merges").splitlines() if l.strip()]
    branches = [b.strip() for b in git(project, "branch", "-a", "--format=%(refname:short)|%(committerdate:short)").splitlines() if b.strip()]
    readme = ""
    for cand in ("README.md", "readme.md", "README.rst", "README.txt", "README"):
        rp = p.root / cand
        if rp.exists():
            readme = rp.read_text(errors="replace")[:20000]
            break
    return {
        "name": project, "files": len(fl), "languages": sorted(langs.items(), key=lambda x: -x[1])[:12],
        "kinds": kinds, "authors": authors[:15], "branches": [b.split("|") for b in branches][:300],
        "commits": git(project, "rev-list", "--all", "--count").strip(),
        "last_commit": git(project, "log", "-1", "--all", "--format=%cs %an: %s").strip(),
        "head": git(project, "rev-parse", "--abbrev-ref", "HEAD").strip(),
        "readme": readme, "lines": lines_total,
    }


# ----------------------------------------------------------------- files
@app.get("/api/projects/{project}/file")
def read_file(project: str, path: str, rev: str | None = None):
    try:
        full = index.safe_path(project, path)
    except Exception as exc:
        _err(exc)
    if rev:
        if not re.fullmatch(r"[\w./~^@{}-]+", rev):
            raise HTTPException(400, "bad rev")
        return PlainTextResponse(git(project, "show", f"{rev}:{path}", check=True))
    if not full.is_file():
        raise HTTPException(404, "not found")
    if full.stat().st_size > 5_000_000:
        raise HTTPException(413, "file too large to open")
    raw = full.read_bytes()
    if b"\0" in raw[:8000]:
        mt = mimetypes.guess_type(full.name)[0] or ""
        if mt.startswith("image/"):
            return FileResponse(full)
        raise HTTPException(415, "binary file")
    return PlainTextResponse(raw.decode("utf-8", errors="replace"))


@app.get("/api/projects/{project}/raw")
def raw_file(project: str, path: str):
    try:
        full = index.safe_path(project, path)
    except Exception as exc:
        _err(exc)
    return FileResponse(full)


@app.put("/api/projects/{project}/file")
def write_file(project: str, path: str, body: dict = Body(...)):
    if READONLY:
        raise HTTPException(403, "server is read-only")
    try:
        full = index.safe_path(project, path)
    except Exception as exc:
        _err(exc)
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(body.get("content", ""))
    index.reindex_file(project, path)
    p = index.project(project)
    if path not in p.files:
        p.files.append(path)
        p.files.sort(key=str.lower)
    return {"ok": True}


# --------------------------------------------------------------- symbols
@app.get("/api/projects/{project}/symbols")
def file_symbols(project: str, path: str):
    try:
        return index.file_symbols(project, path)
    except Exception as exc:
        _err(exc)


@app.get("/api/symbols/search")
def symbol_search(q: str, project: str | None = None, limit: int = 200, kinds: str | None = None):
    return index.search_symbols(project or None, q, min(limit, 1000), kinds.split(",") if kinds else None)


@app.get("/api/projects/{project}/definition")
def definition(project: str, name: str, path: str | None = None):
    try:
        return index.definitions(project, name, path)[:50]
    except Exception as exc:
        _err(exc)


@app.get("/api/projects/{project}/context")
def context(project: str, name: str, path: str | None = None, line: int | None = None):
    """Context window: definition of the symbol under the cursor, with its source text."""
    try:
        defs = index.definitions(project, name, path)
    except Exception as exc:
        _err(exc)
    # A local hit on the very line we are on is the declaration itself; prefer showing it anyway.
    if not defs:
        return {"defs": [], "source": "", "def": None}
    d = defs[0]
    try:
        full = index.safe_path(d["project"], d["path"])
        lines = full.read_text(errors="replace").splitlines()
    except Exception:
        lines = []
    start = max(1, d["line"] - 2)
    end = d["end"] if d["end"] and d["end"] >= d["line"] else d["line"] + 25
    end = min(len(lines), end, d["line"] + 200)
    return {"def": d, "defs": defs[:20], "start": start, "source": "\n".join(lines[start - 1: end])}


@app.get("/api/projects/{project}/references")
def references(project: str, name: str, workspace: bool = False, limit: int = 2000):
    try:
        return index.references(project, name, min(limit, 5000), whole_workspace=workspace)
    except Exception as exc:
        _err(exc)


@app.get("/api/projects/{project}/callers")
def callers(project: str, name: str):
    try:
        return index.callers(project, name)
    except Exception as exc:
        _err(exc)


@app.get("/api/projects/{project}/callees")
def callees(project: str, path: str, line: int, end: int | None = None):
    try:
        return index.callees(project, path, line, end)
    except Exception as exc:
        _err(exc)


@app.get("/api/projects/{project}/hierarchy")
def hierarchy(project: str, name: str):
    try:
        return index.hierarchy(project, name)
    except Exception as exc:
        _err(exc)


@app.get("/api/projects/{project}/categories")
def categories(project: str):
    """Project Symbol Categories: symbols grouped by kind (locals/params excluded)."""
    try:
        index.project(project)
    except Exception as exc:
        _err(exc)
    with index.lock:
        rows = index.db.execute(
            "SELECT kind, name, path, line, end, scope FROM symbols WHERE project=? AND kind NOT IN ('local','parameter') "
            "ORDER BY kind, name COLLATE NOCASE", (project,)
        ).fetchall()
    cats: dict[str, list] = {}
    for kind, name, path, line, end, scope in rows:
        cats.setdefault(kind, []).append({"name": name, "path": path, "line": line, "end": end, "scope": scope, "kind": kind})
    out = [{"kind": k, "count": len(v), "items": v[:3000]} for k, v in cats.items()]
    out.sort(key=lambda c: -c["count"])
    return out


@app.get("/api/projects/{project}/names")
def names(project: str):
    try:
        return index.project_names(project)
    except Exception as exc:
        _err(exc)


# ---------------------------------------------------------------- search
@app.get("/api/search")
def search(
    q: str, project: str | None = None, regex: bool = False, case: bool = False, word: bool = False,
    glob: str | None = None, limit: int = 3000,
):
    if not q:
        return {"hits": [], "truncated": False}
    projs = [project] if project else list(index.projects)
    hits = []
    truncated = False
    for pname in projs:
        try:
            root = index.project(pname).root
        except KeyError:
            raise HTTPException(404, "unknown project")
        cmd = ["rg", "--json", "--max-filesize", "1500K", "-g", "!*.min.js", "-g", "!*.map", "-g", "!package-lock.json",
               "-g", "!storybook-static", "--max-columns", "400"]
        if not regex:
            cmd.append("-F")
        cmd.append("-s" if case else "-i")
        if word:
            cmd.append("-w")
        for g in filter(None, (glob or "").split(",")):
            cmd += ["-g", g.strip()]
        cmd += ["-e", q, "."]
        res = subprocess.run(cmd, capture_output=True, text=True, cwd=root, timeout=60)
        for line in res.stdout.splitlines():
            try:
                m = json.loads(line)
            except json.JSONDecodeError:
                continue
            if m.get("type") != "match":
                continue
            d = m["data"]
            hits.append({
                "project": pname, "path": d["path"].get("text", "").removeprefix("./"), "line": d["line_number"],
                "text": (d["lines"].get("text") or "").rstrip("\n")[:400],
                "ranges": [[s["start"], s["end"]] for s in d.get("submatches", [])],
            })
            if len(hits) >= limit:
                truncated = True
                break
        if truncated:
            break
    return {"hits": hits, "truncated": truncated}


# ------------------------------------------------------------------- git
@app.get("/api/projects/{project}/git/branches")
def branches(project: str):
    out = git(project, "for-each-ref", "--sort=-committerdate",
              "--format=%(refname:short)|%(committerdate:short)|%(authorname)|%(subject)", "refs/heads", "refs/remotes")
    cur = git(project, "rev-parse", "--abbrev-ref", "HEAD").strip()
    rows = []
    for l in out.splitlines():
        parts = l.split("|", 3)
        if len(parts) == 4 and not parts[0].endswith("/HEAD"):
            rows.append(dict(zip(["name", "date", "author", "subject"], parts)))
    return {"current": cur, "branches": rows}


@app.post("/api/projects/{project}/git/checkout")
def checkout(project: str, body: dict = Body(...)):
    if READONLY:
        raise HTTPException(403, "server is read-only")
    ref = body.get("ref", "")
    if not re.fullmatch(r"[\w./-]+", ref):
        raise HTTPException(400, "bad ref")
    if git(project, "status", "--porcelain").strip():
        raise HTTPException(409, "working tree has uncommitted changes; commit or stash first")
    local = ref.split("/", 1)[1] if ref.startswith("origin/") else ref
    if ref.startswith("origin/") and not git(project, "rev-parse", "--verify", "--quiet", f"refs/heads/{local}").strip():
        git(project, "checkout", "-b", local, "--track", ref, check=True)
    else:
        git(project, "checkout", local, check=True)
    p = index.index_project(project, force=True)
    return {"ok": True, "current": local, "symbols": p.symbol_count}


@app.get("/api/projects/{project}/git/log")
def log(project: str, path: str | None = None, limit: int = 200, all: bool = False):
    args = ["log", f"-n{min(limit, 2000)}", "--date=short", "--format=%H|%h|%ad|%an|%s"]
    if all:
        args.append("--all")
    if path:
        args += ["--follow", "--", path]
    rows = []
    for l in git(project, *args).splitlines():
        p = l.split("|", 4)
        if len(p) == 5:
            rows.append(dict(zip(["hash", "short", "date", "author", "subject"], p)))
    return rows


@app.get("/api/projects/{project}/git/show")
def show(project: str, rev: str):
    if not re.fullmatch(r"[0-9a-fA-F]{4,40}", rev):
        raise HTTPException(400, "bad rev")
    return PlainTextResponse(git(project, "show", "--stat", "--patch", "--format=commit %H%nAuthor: %an <%ae>%nDate:   %ad%n%n%B", rev))


@app.get("/api/projects/{project}/git/blame")
def blame(project: str, path: str):
    try:
        index.safe_path(project, path)
    except Exception as exc:
        _err(exc)
    out = git(project, "blame", "--line-porcelain", "--", path, timeout=60)
    rows, cur = [], {}
    for l in out.splitlines():
        if re.match(r"^[0-9a-f]{40} ", l):
            parts = l.split()
            cur = {"hash": parts[0][:8], "line": int(parts[2])}
        elif l.startswith("author "):
            cur["author"] = l[7:]
        elif l.startswith("author-time "):
            cur["time"] = int(l[12:])
        elif l.startswith("summary "):
            cur["summary"] = l[8:]
        elif l.startswith("\t"):
            rows.append(cur)
    return rows


@app.get("/api/projects/{project}/git/status")
def gstatus(project: str):
    rows = []
    for l in git(project, "status", "--porcelain=v1").splitlines():
        rows.append({"code": l[:2], "path": l[3:]})
    return {"branch": git(project, "rev-parse", "--abbrev-ref", "HEAD").strip(), "changes": rows}


@app.get("/api/projects/{project}/git/diff")
def gdiff(project: str, path: str | None = None):
    args = ["diff", "HEAD"]
    if path:
        args += ["--", path]
    return PlainTextResponse(git(project, *args))


# --------------------------------------------------------------- findings
@app.get("/api/menus")
def si_menus():
    f = BASE / "docs" / "menus.json"
    return json.loads(f.read_text()) if f.exists() else {}


@app.get("/help", response_class=HTMLResponse)
def help_page():
    """SourceWeb's own user guide (README + INSTALL), rendered locally."""
    import html as H
    parts = []
    for name in ("README.md", "INSTALL.md"):
        f = BASE / name
        if f.exists():
            parts.append(f"<section><pre>{H.escape(f.read_text())}</pre></section>")
    body = "".join(parts) or "<p>See the Key Assignments list (F1) for every command.</p>"
    return ("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>SourceWeb help</title>"
            "<style>body{font:14px/1.5 system-ui;margin:0;padding:16px;max-width:980px;margin:auto}pre{white-space:pre-wrap;font:13px/1.5 ui-monospace,monospace}</style>"
            f"<h1>SourceWeb (Sw) help</h1>{body}")


@app.get("/api/findings")
def findings():
    f = DATA / "findings.json"
    return json.loads(f.read_text()) if f.exists() else []


app.include_router(features.router)

# ---------------------------------------------------------------- static
(DATA / "export").mkdir(exist_ok=True)
app.mount("/export", StaticFiles(directory=DATA / "export", html=True), name="export")
# bundled assets: packaged builds keep them in web/vendor/{monaco,fonts}; dev checkouts use node_modules
_fonts = next((p for p in (WEB / "vendor" / "fonts", WEB / "vendor" / "node_modules" / "@fontsource" / "jetbrains-mono" / "files") if p.exists()), None)
_monaco = next((p for p in (WEB / "vendor" / "monaco", WEB / "vendor" / "node_modules" / "monaco-editor" / "min") if p.exists()), None)
if _monaco is None:
    raise SystemExit("SourceWeb: the bundled editor (web/vendor/monaco) is missing — re-extract the package")
if _fonts:
    app.mount("/vendor/fonts", StaticFiles(directory=_fonts), name="fonts")
app.mount("/vendor/monaco", StaticFiles(directory=_monaco), name="monaco")
app.mount("/", StaticFiles(directory=WEB, html=True), name="web")


def main():
    host = os.environ.get("SW_HOST", "0.0.0.0")
    port = int(os.environ.get("SW_PORT", "8765"))
    print(f"SourceWeb on http://{host}:{port}  workspace={WORKSPACE}")
    print(f"Remote access: http://<this-machine-ip>:{port}/?token={TOKEN}")
    uvicorn.run(app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
