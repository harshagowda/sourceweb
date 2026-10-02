"""SourceWeb smoke test: builds a tiny demo project in a temp folder, starts a private server on port 8790,
and checks the main APIs. Touches nothing outside the temp folder.  Run: .venv/bin/python tests/smoke.py"""
import json, os, shutil, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
PY = sys.executable
URL = "http://127.0.0.1:8790"
ok = True


def check(c, msg):
    global ok
    print(("PASS " if c else "FAIL ") + msg)
    ok &= bool(c)


def get(path):
    with urllib.request.urlopen(URL + path, timeout=30) as r:
        body = r.read().decode()
        return json.loads(body) if r.headers.get("content-type", "").startswith("application/json") else body


tmp = Path(tempfile.mkdtemp(prefix="sourceweb-smoke-"))
demo = tmp / "ws" / "demo"
(demo / "pkg").mkdir(parents=True)
(demo / "pkg" / "shapes.py").write_text("class Shape:\n    def area(self):\n        return 0\n\n\nclass Square(Shape):\n    def __init__(self, s):\n        self.s = s\n\n    def area(self):\n        return self.s * self.s\n")
(demo / "pkg" / "main.py").write_text("from pkg.shapes import Square\n\n\ndef total_area(items):\n    return sum(i.area() for i in items)\n\n\ndef run():\n    return total_area([Square(2), Square(3)])\n")
(demo / "web.ts").write_text("export function greet(name: string): string {\n  return `hi ${name}`;\n}\nexport const msg = greet('x');\n")
subprocess.run(["git", "init", "-q"], cwd=demo)
env = {**os.environ, "SW_WORKSPACE": str(tmp / "ws"), "SW_DATA": str(tmp / "data"), "SW_PORT": "8790", "SW_HOST": "127.0.0.1"}
srv = subprocess.Popen([PY, "-m", "server.app"], cwd=BASE, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
try:
    for _ in range(80):
        try:
            if get("/api/status")["index"]["done"] >= 1 and not get("/api/status")["index"]["running"]:
                break
        except Exception:
            pass
        time.sleep(0.25)
    for tool in ("git", "rg", "ctags"):
        check(shutil.which(tool), f"{tool} on PATH")
    projects = get("/api/projects")
    check(any(p["name"] == "demo" and p["symbols"] > 4 for p in projects), f"demo project indexed {projects}")
    check(any(s["name"] == "Square" for s in get("/api/symbols/search?q=Squ&project=demo")), "symbol search")
    check(get("/api/projects/demo/definition?name=total_area")[0]["path"] == "pkg/main.py", "jump to definition")
    check(len(get("/api/projects/demo/references?name=Square")) >= 3, "lookup references")
    check(any(c["name"] == "run" for c in get("/api/projects/demo/callers?name=total_area")), "relation: callers")
    check(any(c["name"] == "Shape" for c in get("/api/projects/demo/hierarchy?name=Square")["parents"]), "relation: class inheritance")
    check(len(get("/api/search?q=area&project=demo")["hits"]) >= 3, "search project")
    check("monaco" in get("/") or "SourceWeb" in get("/"), "web UI served")
    check("define" in get("/vendor/monaco/vs/loader.js"), "editor component bundled")
finally:
    srv.terminate()
    srv.wait(5)
    shutil.rmtree(tmp, ignore_errors=True)
print("\nALL GOOD" if ok else "\nSOME CHECKS FAILED")
sys.exit(0 if ok else 1)
