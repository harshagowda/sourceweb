"""Regenerate docs/screenshots/*.png from the DEMO workspace only (three.js, MIT), never from private projects.

  SW_WORKSPACE=~/SourceWeb-demo/projects SW_DATA=~/SourceWeb-demo/data SW_PORT=2728 .venv/bin/python -m server.app &
  .venv/bin/python tools/make_screenshots.py
"""

import json
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:2728"
OUT = Path(__file__).resolve().parent.parent / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)

projects = json.load(urllib.request.urlopen(URL + "/api/projects"))
if [p["name"] for p in projects] != ["three.js"]:
    sys.exit(f"refusing: screenshot server must serve only the three.js demo, got {[p['name'] for p in projects]}")


def put_cursor(page, needle, word, offset=3):
    """Move the cursor onto `word` inside the first line containing `needle`."""
    page.evaluate(
        """([n, w, off]) => { const t = editor.getModel().getValue().split('\\n'); const i = t.findIndex(l => l.includes(n));
        editor.setPosition({lineNumber: i + 1, column: t[i].indexOf(w) + off}); editor.revealLineInCenter(i + 1); editor.focus(); }""",
        [needle, word, offset],
    )


def open_file(page, path, theme="light"):
    page.goto(f"{URL}/?ws=screenshots&n={time.time()}#p=three.js&f={path}&l=1")  # query nonce forces a real reload
    page.wait_for_function("(p) => activeTab() && activeTab().path === p && S.symbols.length > 3", arg=path, timeout=30000)
    page.evaluate(f"applyTheme('{theme}')")
    time.sleep(1)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # 1. overview: Object3D with its class-inheritance graph
    page = browser.new_page(viewport={"width": 1600, "height": 950}, device_scale_factor=1)
    open_file(page, "src/core/Object3D.js")
    page.select_option("#relationMode", "hierarchy")
    page.select_option("#relationView", "graph")
    put_cursor(page, "class Object3D extends", "Object3D")
    page.evaluate("updateRelation(true)")
    page.wait_for_selector("#relationBody .g-node.root", timeout=20000)
    time.sleep(2.5)
    page.screenshot(path=str(OUT / "overview.png"))

    # 2. call graph: who calls updateMatrixWorld and what it calls (large view)
    page.select_option("#relationMode", "both")
    page.select_option("#relationLevels", "1")
    put_cursor(page, "updateMatrixWorld( force ) {", "updateMatrixWorld")
    page.evaluate("updateRelation(true)")
    page.wait_for_selector("#relationBody .g-node.root", timeout=20000)
    time.sleep(3)
    page.evaluate("runCmd('callGraph')")
    time.sleep(1.5)
    page.screenshot(path=str(OUT / "call-graph.png"))
    page.keyboard.press("Escape")

    # 3. references + context window
    put_cursor(page, "updateMatrixWorld( force ) {", "updateMatrixWorld")
    page.evaluate("runCmd('lookupReferences')")
    page.wait_for_function("document.querySelectorAll('#resultsBody .row[data-i]').length > 5", timeout=60000)
    page.evaluate("openResult(3)")
    time.sleep(1.5)
    page.screenshot(path=str(OUT / "references.png"))

    # 4. symbol categories: classes expand to their members
    page.click("#projectTabs button[data-ptab=categories]")
    page.wait_for_selector("#projectBody .row[data-key='cat:class']", timeout=15000)
    page.click("#projectBody .row[data-key='cat:class']")
    page.fill("#projectFilter", "Vector3")
    time.sleep(1.2)
    tw = page.locator("#projectBody .row[data-k='class'] .tw", has_text="▸").first
    if tw.count():
        tw.click()
    time.sleep(1)
    page.screenshot(path=str(OUT / "categories.png"))
    page.fill("#projectFilter", "")
    page.click("#projectTabs button[data-ptab=files]")

    # 5. right-click menu in the editor
    open_file(page, "src/math/Vector3.js")
    put_cursor(page, "applyMatrix4( m ) {", "applyMatrix4")
    time.sleep(0.6)
    page.evaluate("editor.revealLineInCenter(editor.getPosition().lineNumber)")
    time.sleep(0.4)
    pos = page.evaluate("""() => { const v = editor.getScrolledVisiblePosition(editor.getPosition()); const r = editor.getDomNode().getBoundingClientRect(); return {x: r.left + v.left + 10, y: r.top + v.top + 8}; }""")
    page.mouse.move(pos["x"] + 5, pos["y"] + 2)
    page.mouse.click(pos["x"], pos["y"], button="right")
    try:
        page.wait_for_selector(".sw-menu", timeout=5000)
    except Exception:
        page.screenshot(path="/tmp/claude-1000/ctx-debug.png")
        print("DEBUG", pos, page.evaluate("[activeTab().path, editor.getPosition(), document.activeElement.className]"),
              page.evaluate(f"(() => {{ let e = document.elementFromPoint({pos['x']}, {pos['y']}); const p=[]; while (e && p.length<5) {{ p.push(e.tagName+'#'+e.id+'.'+String(e.className).slice(0,30)); e=e.parentElement; }} return p; }})()"))
        raise
    time.sleep(0.5)
    page.screenshot(path=str(OUT / "context-menu.png"))
    page.keyboard.press("Escape")

    # 6. dark theme + browse project symbols (F7)
    open_file(page, "src/renderers/WebGLRenderer.js", theme="dark")
    put_cursor(page, "this.render = function", "render")
    page.keyboard.press("F7")
    page.fill("#paletteInput", "render")
    page.wait_for_function("document.querySelectorAll('#paletteList .row').length > 5", timeout=15000)
    time.sleep(1.2)
    page.screenshot(path=str(OUT / "dark-browse-symbols.png"))
    page.keyboard.press("Escape")
    page.evaluate("applyTheme('light')")
    page.close()

    # 7. phone
    m = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    m.goto(f"{URL}/?ws=screenshots-m#p=three.js&f=src/core/Object3D.js&l=1")
    m.wait_for_selector(".monaco-editor", timeout=30000)
    time.sleep(2)
    m.screenshot(path=str(OUT / "mobile.png"))
    browser.close()

import json as _json
(OUT / "MANIFEST.json").write_text(_json.dumps({"workspace": "three.js-demo-only", "projects": [p["name"] for p in projects],
    "source": "https://github.com/mrdoob/three.js (MIT)", "generated": time.strftime("%Y-%m-%d"),
    "files": sorted(f.name for f in OUT.glob("*.png"))}, indent=1))
for f in sorted(OUT.glob("*.png")):
    print(f.name, f.stat().st_size // 1024, "KB")
