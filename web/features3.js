/* SourceWeb — P1 features from docs/SPEC.md: File Compare, Directory Compare, Symbol Info, auto-complete,
 * line editing, Window List (MRU), Code Beautifier, visual themes, context tracking options,
 * vertical relation graph. Chains onto the features.js / features2.js hooks. */
"use strict";

// ------------------------------------------------------------- MRU windows
S.mru = [];
const _activateTab = window.activateTab;
window.activateTab = function (key) {
  _activateTab(key);
  if (key) { S.mru = [key, ...S.mru.filter((k) => k !== key)]; }
};
function windowList() {
  const items = S.mru.map((k) => S.tabs.find((t) => t.key === k)).filter(Boolean).concat(S.tabs.filter((t) => !S.mru.includes(t.key)));
  palette({
    title: "Window List (most recent first)", items,
    filter: (t, v) => fuzzyScore(t.project + "/" + t.path, v) >= 0,
    render: (t) => `${kindIcon("file")}<span>${esc(baseName(t.path))}${t.dirty ? " ●" : ""}</span><span class="sub">${esc(t.project)}/${esc(dirName(t.path))}</span>`,
    pick: (t) => activateTab(t.key), hint: "Enter activates · Ctrl+Shift+W closes all",
    initialSel: 1, // like Ctrl+Tab: preselect the previous window
  });
}
function lastWindow() { const k = S.mru[1]; if (k) activateTab(k); }

// ------------------------------------------------------------- File Compare
let diffEditor = null, cmp = null;
function compareView() {
  let v = $("#compareView");
  if (v) return v;
  v = document.createElement("div");
  v.id = "compareView";
  v.hidden = true;
  v.innerHTML = `<div class="pane-head" id="compareHead">
      <span>File Compare</span><span id="compareTitle" class="muted ellipsis"></span><span class="spacer"></span>
      <label class="muted">Left: <select id="compareBase"></select></label>
      <button class="mini" id="cmpPrev" title="Previous difference (Ctrl+Up)">▲</button>
      <button class="mini" id="cmpNext" title="Next difference (Ctrl+Down)">▼</button>
      <button class="mini" id="cmpCopyRight" title="Copy block left → right (Alt+Right)">⇒</button>
      <button class="mini" id="cmpInline" title="Toggle inline / side-by-side">⇆</button>
      <button class="mini" id="cmpClose" title="Close (Esc)">✕</button></div>
    <div id="compareBody"><div id="diffList" class="list"></div><div id="diffHost"></div></div>`;
  $("#editorWrap").append(v);
  $("#cmpClose").onclick = closeCompare;
  $("#cmpNext").onclick = () => diffNav(1);
  $("#cmpPrev").onclick = () => diffNav(-1);
  $("#cmpCopyRight").onclick = copyBlockRight;
  $("#cmpInline").onclick = () => { const s = !diffEditor.getOption(monaco.editor.EditorOption.renderSideBySide); diffEditor.updateOptions({ renderSideBySide: s }); };
  $("#compareBase").onchange = () => cmp && openCompare(cmp.tab, $("#compareBase").value);
  return v;
}
async function openCompare(tab = activeTab(), base) {
  if (!tab || tab.rev) return toast("Open a working-tree file to compare");
  const v = compareView();
  const p = encodeURIComponent(tab.project);
  if (!base) {
    const br = await api(`/api/projects/${p}/git/branches`);
    const sel = $("#compareBase");
    sel.innerHTML = `<option value="HEAD">HEAD (last commit)</option>` + br.branches.slice(0, 80).map((b) => `<option value="${esc(b.name)}">${esc(b.name)} — ${esc(b.date)}</option>`).join("") + `<option value="?">Commit hash…</option>`;
    base = "HEAD";
    sel.value = base;
  }
  if (base === "?") { base = prompt("Commit hash or ref to compare with:", "HEAD~1"); if (!base) return; }
  let left = "";
  try { left = await api(`/api/projects/${p}/file?${q({ path: tab.path, rev: base })}`); }
  catch { left = ""; toast(`${tab.path} does not exist at ${base} — showing as added`); }
  v.hidden = false;
  if (!diffEditor) {
    diffEditor = monaco.editor.createDiffEditor($("#diffHost"), { automaticLayout: true, readOnly: false, originalEditable: false, renderSideBySide: window.innerWidth > 900, fontSize: editor.getOption(monaco.editor.EditorOption.fontSize), theme: document.documentElement.dataset.theme === "dark" ? "sw-dark" : "sw-light" });
    diffEditor.onDidUpdateDiff(renderDiffList);
  }
  const orig = monaco.editor.createModel(left, tab.model.getLanguageId());
  const old = cmp?.orig;
  cmp = { tab, base, orig, idx: -1 };
  diffEditor.setModel({ original: orig, modified: tab.model });
  old?.dispose(); // only after the diff editor let go of it
  $("#compareTitle").textContent = `${tab.project}/${tab.path}  ·  ${base}  ↔  working copy`;
  log(`compare ${tab.path} with ${base}`);
}
function renderDiffList() {
  const changes = diffEditor.getLineChanges() || [];
  cmp.changes = changes;
  const syms = S.symbols;
  const encl = (line) => { let best = null; for (const s of syms) if (s.line <= line && s.end >= line && (!best || s.end - s.line < best.end - best.line)) best = s; return best?.name || ""; };
  $("#diffList").innerHTML = `<div class="group">${changes.length} difference(s)</div>` + changes.map((c, i) => {
    const kind = c.originalEndLineNumber === 0 ? "added" : c.modifiedEndLineNumber === 0 ? "deleted" : "changed";
    const line = c.modifiedStartLineNumber || c.originalStartLineNumber;
    return `<div class="row ${i === cmp.idx ? "sel" : ""}" data-i="${i}"><span class="dk ${kind}">${kind[0].toUpperCase()}</span><span>${line}</span><span class="sub">${esc(encl(line))}</span></div>`;
  }).join("");
  $$("#diffList .row[data-i]").forEach((r) => (r.onclick = () => gotoDiff(+r.dataset.i)));
}
function gotoDiff(i) {
  const ch = cmp?.changes || [];
  if (!ch.length) return;
  cmp.idx = (i + ch.length) % ch.length;
  const c = ch[cmp.idx];
  const ln = Math.max(1, c.modifiedStartLineNumber || c.modifiedEndLineNumber || 1);
  diffEditor.getModifiedEditor().revealLineInCenter(ln);
  diffEditor.getModifiedEditor().setPosition({ lineNumber: ln, column: 1 });
  $$("#diffList .row[data-i]").forEach((r) => r.classList.toggle("sel", +r.dataset.i === cmp.idx));
}
const diffNav = (d) => gotoDiff((cmp?.idx ?? -1) + d);
function copyBlockRight() {
  // revert the current difference block in the working copy to the left side's text
  const c = cmp?.changes?.[cmp.idx];
  if (!c) return toast("Select a difference first (Ctrl+Down)");
  const origText = c.originalEndLineNumber === 0 ? "" : cmp.orig.getValueInRange(new monaco.Range(c.originalStartLineNumber, 1, c.originalEndLineNumber, cmp.orig.getLineMaxColumn(c.originalEndLineNumber)));
  const m = cmp.tab.model;
  let range;
  if (c.modifiedEndLineNumber === 0) range = new monaco.Range(c.modifiedStartLineNumber + 1, 1, c.modifiedStartLineNumber + 1, 1);
  else range = new monaco.Range(c.modifiedStartLineNumber, 1, c.modifiedEndLineNumber, m.getLineMaxColumn(c.modifiedEndLineNumber));
  const text = c.modifiedEndLineNumber === 0 ? origText + "\n" : c.originalEndLineNumber === 0 ? "" : origText;
  m.pushEditOperations([], [{ range, text }], () => null);
}
function closeCompare() { const v = $("#compareView"); if (v) v.hidden = true; editor.layout(); editor.focus(); }

// ------------------------------------------------------- Directory Compare
async function directoryCompare() {
  const projs = S.projects.map((p) => p.name);
  const left = prompt(`Left side — project[@rev] (e.g. ${S.project}@origin/main):`, `${S.project}@HEAD`);
  if (!left) return;
  const right = prompt("Right side — project[@rev] (empty rev = working tree):", S.project);
  if (!right) return;
  const [lp, lr = ""] = left.split("@"), [rp, rr = ""] = right.split("@");
  if (!projs.includes(lp) || !projs.includes(rp)) return toast("Unknown project");
  toast("Comparing directories…");
  const r = await api(`/api/dircompare?${q({ left: lp, right: rp, left_rev: lr, right_rev: rr })}`);
  const rows = r.rows.filter((x) => x.status !== "same");
  palette({
    title: `Directory Compare: ${left} ↔ ${right} — ${Object.entries(r.counts).map(([k, n]) => `${n} ${k}`).join(", ")}`,
    items: rows, filter: (x, v) => x.path.toLowerCase().includes(v.toLowerCase()) || x.status.includes(v),
    render: (x) => `<span class="dk ${x.status === "different" ? "changed" : x.status === "left only" ? "deleted" : "added"}">${x.status === "different" ? "≠" : x.status === "left only" ? "L" : "R"}</span><span>${esc(x.path)}</span><span class="right">${esc(x.status)}</span>`,
    pick: async (x) => {
      if (x.status === "left only") return openFile(lp, x.path, { rev: lr || "HEAD" });
      const tab = await openFile(rp, x.path, { rev: rr || undefined });
      if (!tab) return;
      if (rr) return toast("Right side is a revision — opened read-only");
      if (lp === rp) return openCompare(tab, lr || "HEAD");
      // different projects: compare against the other project's file content
      const v = compareView();
      const leftText = await api(`/api/projects/${encodeURIComponent(lp)}/file?${q({ path: x.path, rev: lr || undefined })}`);
      await openCompare(tab, "HEAD");
      const orig = monaco.editor.createModel(leftText, tab.model.getLanguageId());
      const prev = cmp.orig; cmp.orig = orig; cmp.base = left;
      diffEditor.setModel({ original: orig, modified: tab.model });
      prev.dispose();
      $("#compareTitle").textContent = `${left}/${x.path} ↔ ${right}/${x.path}`;
      v.hidden = false;
    },
    hint: "Enter opens File Compare for the selected file",
  });
}

// ------------------------------------------------------------- Symbol Info
async function symbolInfo(name = wordAtCursor()) {
  const t = activeTab();
  if (!name || !t) return toast("Put the cursor on a symbol");
  const r = await api(`/api/projects/${encodeURIComponent(t.project)}/context?${q({ name, path: t.path })}`);
  if (!r.def) return toast(`Symbol not found: ${name}`);
  const d = r.def;
  let box = $("#symbolInfoBox");
  if (!box) { box = document.createElement("div"); box.id = "symbolInfoBox"; document.body.append(box); }
  box.innerHTML = `<div class="pane-head"><span>Symbol Info</span><span class="spacer"></span><button class="mini" data-a="close">✕</button></div>
    <div class="report"><div>${kindIcon(d.kind)} <b>${esc(d.scope ? d.scope + "." : "")}${esc(d.name)}</b>${esc(d.signature || "")}${d.typeref ? ` : ${esc(d.typeref)}` : ""}</div>
    <div class="muted">${esc(d.kind)} · ${esc(d.project)}/${esc(d.path)}:${d.line} · ${d.end > d.line ? d.end - d.line + 1 + " lines" : "1 line"}${r.defs.length > 1 ? ` · ${r.defs.length} definitions` : ""}</div></div>
    <div id="symbolInfoSrc"></div>
    <div class="pane-foot"><button class="mini" data-a="jump">Jump</button><button class="mini" data-a="refs">References</button><button class="mini" data-a="rel">Relation</button></div>`;
  box.hidden = false;
  const ed = monaco.editor.create($("#symbolInfoSrc"), { value: r.source, language: langFor(d.path), readOnly: true, minimap: { enabled: false }, lineNumbers: (n) => String(n + r.start - 1), fontSize: 12, automaticLayout: true, theme: document.documentElement.dataset.theme === "dark" ? "sw-dark" : "sw-light" });
  const close = () => { ed.dispose(); box.hidden = true; editor.focus(); };
  box.querySelector('[data-a=close]').onclick = close;
  box.querySelector('[data-a=jump]').onclick = () => { close(); goTo(d); };
  box.querySelector('[data-a=refs]').onclick = () => { close(); lookupReferences(false, d.name); };
  box.querySelector('[data-a=rel]').onclick = () => { close(); setLtab("relation"); S.relSymbol = { ...d, mode: $("#relationMode").value }; renderRelation(); };
  box.onkeydown = (e) => { if (e.key === "Escape") close(); };
  ed.focus();
}

// ------------------------------------------------------------ auto-complete
function registerCompletion() {
  const KIND = monaco.languages.CompletionItemKind;
  const map = { function: KIND.Function, method: KIND.Method, member: KIND.Method, class: KIND.Class, interface: KIND.Interface, struct: KIND.Struct, variable: KIND.Variable, field: KIND.Field, property: KIND.Property, constant: KIND.Constant, enum: KIND.Enum, enumerator: KIND.EnumMember, module: KIND.Module, namespace: KIND.Module, type: KIND.TypeParameter, typedef: KIND.TypeParameter };
  for (const lang of [...new Set(Object.values(EXT_LANG))]) {
    monaco.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: ["."],
      provideCompletionItems: async (model, pos) => {
        const t = S.tabs.find((x) => x.model === model);
        const w = model.getWordUntilPosition(pos);
        if (!t || w.word.length < 2) return { suggestions: [] };
        const res = await api(`/api/symbols/search?${q({ q: w.word, project: t.project, limit: 60 })}`);
        const range = new monaco.Range(pos.lineNumber, w.startColumn, pos.lineNumber, w.endColumn);
        const seen = new Set();
        return {
          suggestions: res.filter((s) => !["local", "parameter"].includes(s.kind) && !seen.has(s.name + s.kind) && seen.add(s.name + s.kind)).map((s) => ({
            label: s.name, kind: map[s.kind] ?? KIND.Text, insertText: s.name, range,
            detail: `${s.kind}${s.signature ? " " + s.signature : ""}`, documentation: `${s.project}/${s.path}:${s.line}`,
            sortText: (s.name.startsWith(w.word) ? "0" : "1") + s.name,
          })),
        };
      },
    });
  }
}

// ------------------------------------------------------------ beautifier
async function reformat() {
  const t = activeTab();
  if (!t || t.rev) return;
  const sel = editor.getSelection();
  const whole = sel.isEmpty();
  try {
    const r = await api("/api/format", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: t.path, content: whole ? t.model.getValue() : t.model.getValueInRange(sel) }) });
    const range = whole ? t.model.getFullModelRange() : sel;
    editor.executeEdits("beautifier", [{ range, text: r.content }]);
    toast(`Reformatted with ${r.formatter}${whole ? "" : " (selection)"} — Ctrl+Z to undo`);
  } catch (e) { toast(`Reformat: ${e.message}`, 5000); }
}

// -------------------------------------------------------------- themes
const THEMES = {
  "sw-light": { label: "SourceWeb Light", dark: false, vars: {} },
  "sw-black": { label: "SourceWeb Dark", dark: true, vars: {} },
  "classic": { label: "Classic (blue-grey)", dark: false, vars: { "--menubar": "#d4d0c8", "--toolbar": "#d4d0c8", "--head": "#c3d3ea", "--status": "#0a246a", "--bg": "#d4d0c8", "--tab": "#d4d0c8", "--panel-2": "#eaeaea", "--accent": "#0a246a", "--sel": "#b6c8ee" } },
  "solar": { label: "Solarized Light", dark: false, vars: { "--panel": "#fdf6e3", "--panel-2": "#eee8d5", "--head": "#eee8d5", "--bg": "#eee8d5", "--tab": "#eee8d5", "--tab-active": "#fdf6e3", "--menubar": "#eee8d5", "--toolbar": "#f5efdc", "--status": "#268bd2", "--accent": "#268bd2", "--sel": "#e3dcc4", "--hover": "#efe9d6" } },
};
function setTheme(id) {
  const th = THEMES[id] || THEMES["sw-light"];
  const root = document.documentElement;
  for (const th2 of Object.values(THEMES)) for (const k of Object.keys(th2.vars)) root.style.removeProperty(k);
  applyTheme(th.dark ? "dark" : "light");
  for (const [k, v] of Object.entries(th.vars)) root.style.setProperty(k, v);
  if (id === "solar") monaco.editor.setTheme("sw-solar");
  store.set("themeId", id);
}
function themeDialog() {
  palette({ title: "Visual Theme", items: Object.entries(THEMES), render: ([id, t]) => `<span>${esc(t.label)}</span><span class="right">${store.get("themeId", "") === id ? "✓" : ""}</span>`, filter: ([, t], v) => t.label.toLowerCase().includes(v.toLowerCase()), pick: ([id]) => setTheme(id), preview: ([id]) => setTheme(id) });
}

// ------------------------------------------------- context window tracking
S.ctxTrack = store.get("ctxTrack", "symbol"); // off | symbol | function
const _updateContext = window.updateContext;
window.updateContext = function (name) {
  if (S.ctxTrack === "off") return;
  if (S.ctxTrack === "function") {
    const s = symbolAtLine(editor.getPosition().lineNumber);
    if (s && s !== S._ctxFn) { S._ctxFn = s; showContextFor({ ...s, project: activeTab().project }); }
    return;
  }
  return _updateContext(name);
};

// ------------------------------------------------- relation: vertical graph
function drawRelationGraphVertical() {
  const body = $("#relationBody");
  const root = S.relTree;
  const W = 150, H = 24, GX = 10, GY = 46;
  const nodes = [], edges = [];
  let x = 0;
  const place = (n, depth) => {
    const kids = n.open && n.children ? n.children.slice(0, 40) : [];
    let cx;
    if (!kids.length) { cx = x; x += W + GX; }
    else { const xs = kids.map((k) => place(k, depth + 1)); cx = (xs[0] + xs[xs.length - 1]) / 2; kids.forEach((k, i) => edges.push([cx, depth, xs[i], depth + 1])); }
    nodes.push({ n, x: cx, y: depth * (H + GY) });
    return cx;
  };
  place(root, 0);
  const width = x + 10, height = Math.max(...nodes.map((o) => o.y)) + H + 10;
  body.innerHTML = `<svg width="${width}" height="${height}" font-size="11">
    ${edges.map(([x1, d1, x2, d2]) => `<path d="M${x1 + W / 2},${d1 * (H + GY) + H} C${x1 + W / 2},${d1 * (H + GY) + H + GY / 2} ${x2 + W / 2},${d2 * (H + GY) - GY / 2} ${x2 + W / 2},${d2 * (H + GY)}" fill="none" stroke="var(--muted)" marker-end="url(#arr)"/>`).join("")}
    <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--muted)"/></marker></defs>
    ${nodes.map((o, i) => `<g data-i="${i}" style="cursor:pointer"><rect x="${o.x}" y="${o.y}" width="${W}" height="${H}" rx="4" fill="var(--panel-2)" stroke="var(--accent)"/><text x="${o.x + 6}" y="${o.y + 16}" fill="var(--text)">${esc((o.n.label || "").slice(0, 21))}</text></g>`).join("")}
  </svg>`;
  body.querySelectorAll("g[data-i]").forEach((g) => {
    const n = nodes[+g.dataset.i].n;
    g.onclick = async () => { if (n.path) showContextFor(n); if (!n.leaf && n !== root) { n.open = !n.open; if (n.open && !n.children) n.children = await relationChildren(n, n.relMode || $("#relationMode").value); drawRelationGraphVertical(); } };
    g.ondblclick = () => n.path && goTo({ project: n.project, path: n.path, line: n.hitLine || n.line });
  });
}
function redrawRelation() {
  if (!S.relTree) return;
  const v = $("#relationView").value;
  (v === "graph" ? drawRelationGraph : v === "vgraph" ? drawRelationGraphVertical : drawRelationOutline)();
}
window.redrawRelation = redrawRelation;
const _drawGraph = window.drawRelationGraph;
// renderRelation picks graph vs outline; route "vgraph" to the vertical layout
window.drawRelationGraph = function () { return $("#relationView").value === "vgraph" ? drawRelationGraphVertical() : _drawGraph(); };
const _drawOutline = window.drawRelationOutline;
window.drawRelationOutline = function () { return $("#relationView").value === "vgraph" ? drawRelationGraphVertical() : _drawOutline(); };

// ------------------------------------------------------------- line editing
function scrollLine(d) { editor.setScrollTop(editor.getScrollTop() + d * editor.getOption(monaco.editor.EditorOption.lineHeight)); }

// ---------------------------------------------------------------- hooks
const _x1 = window.extendCommands, _x2 = window.extendEditor, _x3 = window.afterBoot;
window.extendCommands = function () {
  _x1?.();
  cmd("fileCompare", "File Compare…", () => openCompare(), "Ctrl+Alt+D");
  cmd("compareWithHead", "Compare With HEAD", () => openCompare());
  cmd("directoryCompare", "Directory Compare…", directoryCompare);
  cmd("symbolInfo", "Symbol Info", () => symbolInfo(), "Ctrl+Shift+I | Alt+F1");
  cmd("windowList", "Window List…", windowList, "Ctrl+Alt+W | Ctrl+E");
  cmd("lastWindow", "Last Window", lastWindow, "Ctrl+Tab | Alt+`");
  cmd("formatDocument", "Reformat Source Code (Beautify)", reformat, "Ctrl+Alt+F");
  cmd("themeDialog", "Visual Theme…", themeDialog);
  cmd("duplicateLine", "Duplicate Line", () => editor.getAction("editor.action.copyLinesDownAction").run(), "Ctrl+Shift+D");
  cmd("dragLineUp", "Drag Line Up", () => editor.getAction("editor.action.moveLinesUpAction").run(), "Ctrl+Shift+ArrowUp");
  cmd("dragLineDown", "Drag Line Down", () => editor.getAction("editor.action.moveLinesDownAction").run(), "Ctrl+Shift+ArrowDown");
  cmd("joinLines", "Join Lines", () => editor.getAction("editor.action.joinLines").run(), "Ctrl+J");
  cmd("copyLine", "Copy Line", () => { const ln = editor.getPosition().lineNumber; navigator.clipboard?.writeText(editor.getModel().getLineContent(ln) + "\n"); toast("Line copied"); });
  cmd("cutLine", "Cut Line", () => editor.getAction("editor.action.clipboardCutAction").run());
  cmd("deleteLine", "Delete Line", () => editor.getAction("editor.action.deleteLines").run(), "Ctrl+Shift+K");
  cmd("indentRight", "Indent Right", () => editor.getAction("editor.action.indentLines").run(), "Ctrl+]");
  cmd("indentLeft", "Indent Left", () => editor.getAction("editor.action.outdentLines").run(), "Ctrl+[");
  cmd("scrollLineUp", "Scroll Line Up", () => scrollLine(-1), "Alt+ArrowUp");
  cmd("scrollLineDown", "Scroll Line Down", () => scrollLine(1), "Alt+ArrowDown");
  cmd("selectSymbol", "Select Symbol", () => { const s = symbolAtLine(editor.getPosition().lineNumber); if (s) editor.setSelection(new monaco.Selection(s.line, 1, s.end + 1, 1)); });
  cmd("ctxTrackOff", "Context Window: Tracking Off", () => { S.ctxTrack = "off"; store.set("ctxTrack", "off"); toast("Context tracking off"); });
  cmd("ctxTrackSymbol", "Context Window: Track Selected Symbol", () => { S.ctxTrack = "symbol"; store.set("ctxTrack", "symbol"); toast("Context tracks the selected symbol"); });
  cmd("ctxTrackFunction", "Context Window: Track Enclosing Function", () => { S.ctxTrack = "function"; store.set("ctxTrack", "function"); toast("Context tracks the enclosing function"); });
  cmd("jumpToBaseType", "Jump To Base Type", async () => {
    // follow a variable's annotated type (typeref) to its class definition
    const name = wordAtCursor(); const t = activeTab(); if (!name || !t) return;
    const defs = await api(`/api/projects/${encodeURIComponent(t.project)}/definition?${q({ name, path: t.path })}`);
    const typed = defs.find((d) => d.typeref);
    const typeName = typed?.typeref?.match(/[A-Za-z_]\w*/g)?.find((w) => S.names[w]);
    if (!typeName) return toast("No known type for this symbol");
    jumpToDefinition(typeName);
  });
  MENUS.File.push("-", "fileCompare", "directoryCompare");
  MENUS.Edit.push("-", "duplicateLine", "dragLineUp", "dragLineDown", "joinLines", "copyLine", "cutLine", "deleteLine", "indentLeft", "indentRight", "selectSymbol");
  MENUS.Search.push("-", "jumpToBaseType");
  MENUS.View.push("-", "windowList", "lastWindow", "themeDialog", "ctxTrackOff", "ctxTrackSymbol", "ctxTrackFunction");
  const help = MENUS.Help; delete MENUS.Help; // keep Help last, like SourceWeb's menu bar
  MENUS.Options = ["themeDialog", "togglePreview", "ctxTrackOff", "ctxTrackSymbol", "ctxTrackFunction", "-", "toggleMinimap", "toggleWrap", "monoView", "zoomIn", "zoomOut", "-", "showKeys"];
  MENUS.Help = help;
};
window.extendEditor = function () {
  _x2?.();
  monaco.editor.defineTheme("sw-solar", { base: "vs", inherit: true, rules: [{ token: "comment", foreground: "93a1a1", fontStyle: "italic" }, { token: "keyword", foreground: "859900", fontStyle: "bold" }, { token: "string", foreground: "2aa198" }], colors: { "editor.background": "#fdf6e3", "editor.lineHighlightBackground": "#eee8d5" } });
  registerCompletion();
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyI, () => runCmd("symbolInfo"));
  document.addEventListener("keydown", (e) => {
    if ($("#compareView")?.hidden !== false) return;
    if (e.key === "Escape") { e.preventDefault(); closeCompare(); }
    else if (e.ctrlKey && e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); diffNav(1); }
    else if (e.ctrlKey && e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); diffNav(-1); }
    else if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); copyBlockRight(); }
  }, true);
};
window.afterBoot = async function () {
  await _x3?.();
  // phones: give the code the full width
  const narrow = matchMedia("(max-width: 900px)");
  const fit = () => editor.updateOptions({ minimap: { enabled: !narrow.matches && store.get("minimap", true) }, lineNumbersMinChars: narrow.matches ? 3 : 5, folding: !narrow.matches });
  narrow.addEventListener("change", fit); fit();
  $("#relationView").insertAdjacentHTML("beforeend", `<option value="vgraph">Vertical graph</option>`);
  $("#relationView").onchange = redrawRelation;
  const tid = store.get("themeId", null);
  if (tid && tid !== "sw-light" && tid !== "sw-black") setTheme(tid);
};
