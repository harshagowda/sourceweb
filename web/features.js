/* SourceWeb — SourceWeb fidelity layer.
 * Loaded after app.js; uses its globals (S, editor, monaco, cmd, runCmd, api, q, …) and the
 * extendCommands / extendEditor / afterBoot hooks. Implements docs/SPEC.md batches A–C. */
"use strict";

// ---------------------------------------------------------------- key names
// SourceWeb binds the numeric keypad (Function Up/Down, Go To Next Change), so keep those distinct.
window.keyString = function keyString(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  let k = e.key;
  const code = e.code || "";
  if (["Control", "Shift", "Alt", "Meta"].includes(k)) return "";
  if (code.startsWith("Numpad") && /^[-+*/]$/.test(k)) k = "Num" + k;
  else if (code.startsWith("Digit")) k = code.slice(5);
  else if (code === "Comma") k = ",";
  else if (code === "Period") k = ".";
  else if (code === "Slash") k = "/";
  else if (code === "Equal") k = "=";
  else if (code === "Minus") k = "-";
  else if (code === "Quote") k = "'";
  else if (code === "BracketLeft") k = "[";
  else if (code === "BracketRight") k = "]";
  else if (code === "Space") k = "Space";
  else if (k.length === 1) k = k.toUpperCase();
  parts.push(k);
  return parts.join("+");
};

// --------------------------------------------------------- function up/down
function functionMove(dir) {
  const line = editor.getPosition().lineNumber;
  const fns = S.symbols.filter((s) => ["function", "method", "member", "func", "constructor", "class"].includes(s.kind)).map((s) => s.line).sort((a, b) => a - b);
  const target = dir > 0 ? fns.find((l) => l > line) : [...fns].reverse().find((l) => l < line);
  if (!target) return toast(dir > 0 ? "No next function" : "No previous function");
  goTo({ project: activeTab().project, path: activeTab().path, line: target }, { focus: true });
}

// ------------------------------------------------------------- go back toggle
function goBackToggle() {
  if (S.history.length < 2) return;
  const cur = currentLocation();
  const prev = [...S.history].reverse().find((h) => !cur || h.path !== cur.path || Math.abs(h.line - cur.line) > 2);
  if (prev) goTo(prev);
}

// --------------------------------------------------------- selection history
function selectionHistoryDialog() {
  const items = [...S.history].reverse();
  palette({
    title: "Selection History", items,
    filter: (h, v) => (h.path + (h.fn || "")).toLowerCase().includes(v.toLowerCase()),
    render: (h) => `<span>${esc(baseName(h.path))}:${h.line}</span><span class="sub">${esc(h.fn || "")}</span><span class="right">${esc(h.project)}/${esc(dirName(h.path))}</span>`,
    pick: (h) => goTo(h), hint: "Most recent first · Enter = Go To",
  });
}
// record the enclosing function in history entries (SW shows it in the Selection History list)
const _pushHistory = window.pushHistory;
window.pushHistory = function (loc) {
  if (loc && !loc.fn && activeTab() && loc.path === activeTab().path) loc.fn = symbolAtLine(loc.line)?.name || "";
  return _pushHistory(loc);
};

// ------------------------------------------------------------- browser mode
S.browserMode = false;
function toggleBrowserMode() {
  S.browserMode = !S.browserMode;
  editor.updateOptions({ readOnly: S.browserMode || !!activeTab()?.rev || S.readonly });
  document.body.classList.toggle("browser-mode", S.browserMode);
  toast(`Browser Mode ${S.browserMode ? "on — click a symbol to jump, Backspace = back, Space = jump" : "off"}`, 3500);
}

// ---------------------------------------------------------- revision marks
// Lines edited since the file was opened get a margin mark; after a save they turn to "saved change" marks.
function trackChanges(tab) {
  if (tab._tracked) return;
  tab._tracked = true;
  tab.changeIds = [];
  tab.model.onDidChangeContent((ev) => {
    const decos = [];
    for (const c of ev.changes) {
      const startLine = c.range.startLineNumber;
      const added = c.text.split("\n").length - 1;
      decos.push({ range: new monaco.Range(startLine, 1, startLine + added, 1), options: { isWholeLine: true, linesDecorationsClassName: "sw-change", overviewRuler: { color: "#e2b100", position: 7 }, minimap: { color: "#e2b100", position: 2 }, stickiness: 1 } });
    }
    tab.changeIds.push(...tab.model.deltaDecorations([], decos));
  });
}
function markSaved(tab) {
  if (!tab?.changeIds?.length) return;
  const ranges = tab.changeIds.map((id) => tab.model.getDecorationRange(id)).filter(Boolean);
  tab.model.deltaDecorations(tab.changeIds, []);
  tab.changeIds = tab.model.deltaDecorations([], ranges.map((r) => ({ range: r, options: { isWholeLine: true, linesDecorationsClassName: "sw-change-saved", overviewRuler: { color: "#4caf50", position: 7 }, stickiness: 1 } })));
}
function gotoChange(dir) {
  const t = activeTab();
  if (!t?.changeIds?.length) return toast("No changes in this file");
  const lines = [...new Set(t.changeIds.map((id) => t.model.getDecorationRange(id)?.startLineNumber).filter(Boolean))].sort((a, b) => a - b);
  const cur = editor.getPosition().lineNumber;
  const target = dir > 0 ? lines.find((l) => l > cur) ?? lines[0] : [...lines].reverse().find((l) => l < cur) ?? lines[lines.length - 1];
  editor.setPosition({ lineNumber: target, column: 1 });
  editor.revealLineInCenter(target);
}
const _saveTab = window.saveTab;
window.saveTab = async function (tab = activeTab()) {
  const before = tab?.dirty;
  await _saveTab(tab);
  if (tab && before && !tab.dirty) markSaved(tab);
};

// ---------------------------------------------------- current function in overview
let fnBoundaryIds = [];
function updateFunctionBoundary() {
  if (!editor?.getModel()) return;
  const line = editor.getPosition().lineNumber;
  const s = [...S.symbols].filter((x) => ["function", "method", "member", "func", "class", "constructor"].includes(x.kind) && x.line <= line && x.end >= line).sort((a, b) => (a.end - a.line) - (b.end - b.line))[0];
  fnBoundaryIds = editor.deltaDecorations(fnBoundaryIds, s ? [{
    range: new monaco.Range(s.line, 1, s.end, 1),
    options: { isWholeLine: true, minimap: { color: "#2f6fd62e", position: 1 }, overviewRuler: { color: "#2f6fd680", position: 2 }, linesDecorationsClassName: "sw-fn-scope" },
  }] : []);
}

// ------------------------------------------------------------ popup toolbar
function initPopupToolbar() {
  const bar = document.createElement("div");
  bar.id = "popupBar";
  bar.hidden = true;
  bar.innerHTML = `<button data-c="jumpToDefinition" title="Jump To Definition">⤳ Def</button><button data-c="jumpToCaller" title="Jump To Caller">↖ Caller</button><button data-c="lookupReferences" title="Find References">⇶ Refs</button><button data-c="symbolInfo" title="Symbol Info">ⓘ</button>`;
  document.getElementById("editorWrap").append(bar);
  bar.querySelectorAll("button").forEach((b) => (b.onmousedown = (e) => { e.preventDefault(); bar.hidden = true; runCmd(b.dataset.c); }));
  const show = debounce(() => {
    const m = editor.getModel();
    const sel = editor.getSelection();
    if (!m || !sel || sel.isEmpty() || sel.startLineNumber !== sel.endLineNumber) { bar.hidden = true; return; }
    const w = m.getWordAtPosition(sel.getStartPosition().with(undefined, sel.startColumn + 1));
    if (!w || w.startColumn !== sel.startColumn || w.endColumn !== sel.endColumn || !S.names[w.word]) { bar.hidden = true; return; }
    const pos = editor.getScrolledVisiblePosition(sel.getEndPosition());
    if (!pos) { bar.hidden = true; return; }
    bar.style.left = Math.min(pos.left + 60, editor.getLayoutInfo().width - 260) + "px";
    bar.style.top = Math.max(0, pos.top - 30) + "px";
    bar.hidden = false;
  }, 350);
  editor.onDidChangeCursorSelection(show);
  editor.onDidScrollChange(() => (bar.hidden = true));
}

// --------------------------------------------------------- symbol window v2
S.symSort = store.get("symSort", "line");
S.symCollapsed = new Set();
const CONTAINERS = new Set(["class", "struct", "interface", "trait", "enum", "namespace", "module", "component", "object"]);
window.renderSymbols = function renderSymbols() {
  const f = $("#symbolFilter").value.trim();
  const list = $("#symbolList");
  const t = activeTab();
  const fnLens = S.symbols.filter((s) => ["function", "method", "member", "func"].includes(s.kind) && s.end > s.line).map((s) => s.end - s.line);
  const avg = fnLens.length ? fnLens.reduce((a, b) => a + b, 0) / fnLens.length : Infinity;
  const isBold = (s) => CONTAINERS.has(s.kind) || (["function", "method", "member", "func"].includes(s.kind) && s.end - s.line > avg);
  let syms = S.symbols.map((s, i) => ({ s, i }));
  if (f) syms = syms.filter(({ s }) => fragmentMatch(s.name, f));
  const depthOf = (s) => (s.scope ? s.scope.split(/\.|::/).length : 0);
  if (S.symSort === "name") syms.sort((a, b) => a.s.name.localeCompare(b.s.name));
  else if (S.symSort === "type") syms.sort((a, b) => a.s.kind.localeCompare(b.s.kind) || a.s.name.localeCompare(b.s.name));
  const flat = S.symSort !== "line" || !!f;
  const hiddenUnder = (s) => s.scope && s.scope.split(/\.|::/).some((_, i, arr) => S.symCollapsed.has(arr.slice(0, i + 1).join(".")));
  const rows = syms.filter(({ s }) => flat || !hiddenUnder(s)).map(({ s, i }) => {
    const depth = flat ? 0 : depthOf(s);
    const key = (s.scope ? s.scope + "." : "") + s.name;
    const hasKids = !flat && CONTAINERS.has(s.kind) && S.symbols.some((x) => x.scope && (x.scope === key || x.scope.endsWith("." + s.name) && x.line > s.line && x.line <= s.end));
    return `<div class="row" data-i="${i}" style="padding-left:${4 + depth * 12}px" title="${esc(s.kind + " " + s.name + (s.signature || "") + "  —  line " + s.line)}">
      <span class="tw" data-key="${esc(key)}">${hasKids ? (S.symCollapsed.has(key) ? "▸" : "▾") : ""}</span>${kindIcon(s.kind)}<span class="${isBold(s) ? "b" : ""}">${esc(s.name)}</span><span class="sub">${esc(s.signature || "")}</span></div>`;
  });
  list.innerHTML = rows.join("") || `<div class="report muted">${t ? (f ? "No match." : "No symbols in this file.") : "Open a file to see its symbols."}</div>`;
  list.querySelectorAll(".row").forEach((r) => {
    const s = S.symbols[+r.dataset.i];
    r.querySelector(".tw").onclick = (e) => {
      const k = e.target.dataset.key;
      if (!e.target.textContent) return;
      e.stopPropagation();
      S.symCollapsed.has(k) ? S.symCollapsed.delete(k) : S.symCollapsed.add(k);
      renderSymbols();
    };
    r.onclick = () => { goTo({ project: activeTab().project, path: s.path, line: s.line }, { focus: false }); showContextFor({ ...s, project: activeTab().project }); };
    r.ondblclick = () => { editor.setSelection(new monaco.Selection(s.line, 1, (s.end || s.line) + 1, 1)); editor.focus(); };
  });
  $("#symSortBtns")?.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.sort === S.symSort));
  syncSymbolSelection();
};
function initSymbolWindowChrome() {
  const pane = $("#symbolPane");
  const foot = document.createElement("div");
  foot.id = "symSortBtns";
  foot.className = "pane-foot";
  foot.innerHTML = `<span class="muted">Sort:</span><button class="mini" data-sort="name" title="Sort by name">Name</button><button class="mini" data-sort="line" title="Sort by line (outline)">Line</button><button class="mini" data-sort="type" title="Sort by type, then name">Type</button>`;
  pane.append(foot);
  foot.querySelectorAll("button").forEach((b) => (b.onclick = () => { S.symSort = b.dataset.sort; store.set("symSort", S.symSort); renderSymbols(); }));
  $("#symbolFilter").onkeydown = (e) => {
    if (e.key === "Enter") { const r = $("#symbolList .row"); r?.click(); editor.focus(); }
    if (e.key === "Escape") { e.target.value = ""; renderSymbols(); editor.focus(); }
  };
}

// ---------------------------------------------- SourceWeb name fragments
// "cre win" matches CreateWindow and WindowCreate; "?regex" is a regex; trailing "(" = functions only.
function fragmentMatch(name, query) {
  query = query.trim();
  if (!query) return true;
  if (query.startsWith("?")) { try { return new RegExp(query.slice(1), "i").test(name); } catch { return false; } }
  const n = name.toLowerCase();
  return query.toLowerCase().replace(/\($/, "").split(/\s+/).filter(Boolean).every((frag) => n.includes(frag));
}
window.fragmentMatch = fragmentMatch;

// ------------------------------------------------- project file list v2
S.fileGlob = null;
function globToRe(g) { return new RegExp("^" + g.split("*").map((x) => x.replace(/[.+^${}()|[\]\\?]/g, "\\$&")).join(".*") + "$", "i"); }
const baseRenderProjectPane = window._renderProjectPane;
window._renderProjectPane = async function () {
  const body = $("#projectBody");
  const filter = $("#projectFilter").value.trim();
  if (S.ptab === "files") {
    let files = S.files;
    if (S.fileGlob) { const re = globToRe(S.fileGlob); files = files.filter((f) => re.test(baseName(f))); }
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    let items = files.filter((f) => !words.length || words.every((w) => f.toLowerCase().includes(w)) || fuzzyScore(f, filter) >= 0)
      .map((f) => ({ f, s: words.length ? (words.every((w) => baseName(f).toLowerCase().includes(w)) ? 0 : fuzzyScore(f, filter) < 0 ? 5 : fuzzyScore(f, filter)) : 0 }));
    items.sort((a, b) => a.s - b.s || (filter ? a.f.length - b.f.length : baseName(a.f).localeCompare(baseName(b.f))));
    items = items.slice(0, 3000);
    body.innerHTML = `<div class="group">${items.length} of ${S.files.length} files${S.fileGlob ? ` · filter <b>${esc(S.fileGlob)}</b> <span class="muted">(* Enter clears)</span>` : ""}</div>` + items.map(({ f }) =>
      `<div class="row" data-path="${esc(f)}" title="${esc(f)}">${kindIcon("file")}<span>${esc(baseName(f))}</span><span class="sub">${esc(dirName(f))}</span></div>`).join("");
    body.querySelectorAll(".row[data-path]").forEach((r) => {
      r.onclick = () => {
        if (window.innerWidth <= 900 || !S.previewOnSelect) return openFile(S.project, r.dataset.path);
        body.querySelectorAll(".row").forEach((x) => x.classList.toggle("sel", x === r));
        previewFile(S.project, r.dataset.path);
      };
      r.ondblclick = () => openFile(S.project, r.dataset.path);
    });
    highlightInProjectList();
    return;
  }
  if (S.ptab === "psymbols") {
    if (!filter) { body.innerHTML = `<div class="report muted">Type to list project symbols. Fragments: <span class="kbd">cre win</span> · regex: <span class="kbd">?^get_.*id$</span> · functions only: <span class="kbd">name(</span> · members: <span class="kbd">.field</span></div>`; return; }
    let qq = filter, kinds, member = false;
    if (qq.endsWith("(")) { kinds = "function,method,member,func"; qq = qq.slice(0, -1); }
    if (qq.startsWith(".")) { member = true; qq = qq.slice(1); }
    const isRegex = qq.startsWith("?");
    const frags = qq.replace(/^\?/, "").split(/\s+/).filter(Boolean);
    const seed = isRegex ? (qq.slice(1).match(/[A-Za-z_]{3,}/)?.[0] || qq.slice(1).replace(/[^\w]/g, "").slice(0, 3)) : frags.sort((a, b) => b.length - a.length)[0] || "";
    let res = seed ? await api(`/api/symbols/search?${q({ q: seed, project: S.project, limit: 1000, kinds })}`) : [];
    if ($("#projectFilter").value.trim() !== filter) return;
    res = res.filter((s) => fragmentMatch(s.name, isRegex ? qq : frags.join(" ")) && (!member || s.scope)).slice(0, 400);
    body.innerHTML = res.map((s, i) => `<div class="row" data-i="${i}" title="${esc(s.path + ":" + s.line)}">${kindIcon(s.kind)}<span>${esc(s.name)}</span><span class="sub">${esc(s.scope ? s.scope + " · " : "")}${esc(baseName(s.path))}</span></div>`).join("") || `<div class="report muted">No symbols match.</div>`;
    body.querySelectorAll(".row").forEach((r) => {
      const s = res[+r.dataset.i];
      r.onclick = () => { body.querySelectorAll(".row").forEach((x) => x.classList.toggle("sel", x === r)); showContextFor(s); S.relLocked || relationFor(s); };
      r.ondblclick = () => goTo({ project: s.project, path: s.path, line: s.line });
    });
    return;
  }
  if (S.ptab === "categories") return renderCategories(body, filter);
  if (S.ptab === "workspace") return renderWorkspaceTree(body, filter);
  return baseRenderProjectPane();
};
S.previewOnSelect = store.get("previewOnSelect", true);

async function previewFile(project, path) {
  let txt;
  try { txt = await api(`/api/projects/${encodeURIComponent(project)}/file?${q({ path })}`); } catch (e) { return toast(e.message); }
  const lines = txt.split("\n");
  showContextResult({ def: { kind: "file", name: baseName(path), project, path, line: 1, end: lines.length }, defs: [], start: 1, source: lines.slice(0, 400).join("\n") });
}
window.previewFile = previewFile;

function relationFor(sym) {
  S.relSymbol = { name: sym.name, project: sym.project, path: sym.path, line: sym.line, end: sym.end, kind: sym.kind, mode: $("#relationMode").value };
  renderRelation();
}

// ------------------------------------------------ project symbol categories
async function renderCategories(body, filter) {
  // Tree: category ▸ container (class/struct/module) ▸ members. Members of a class fold under it, and class
  // entries themselves expand to show their members — the "structured types expand" behaviour.
  if (!S.catData || S.catData.project !== S.project) {
    body.innerHTML = `<div class="report muted">Loading categories…</div>`;
    S.catData = { project: S.project, cats: await api(`/api/projects/${encodeURIComponent(S.project)}/categories`) };
  }
  const cats = S.catData.cats;
  S.catOpen ||= new Set();
  const all = cats.flatMap((c) => c.items);
  const leafScope = (sc) => (sc || "").split(/\.|::/).pop();
  const membersOf = (cls) => all.filter((m) => m.path === cls.path && m.line > cls.line && m.line <= (cls.end || cls.line) && leafScope(m.scope) === cls.name);
  const isOpen = (k) => S.catOpen.has(k) || !!filter;
  const row = (s, depth, key, expandable) => `<div class="row" data-key="${esc(key)}" data-n="${esc(s.name)}" data-p="${esc(s.path)}" data-l="${s.line}" data-k="${esc(s.kind)}" style="padding-left:${8 + depth * 16}px">
      <span class="tw">${expandable ? (isOpen(key) ? "▾" : "▸") : ""}</span>${kindIcon(s.kind)}<span>${esc(s.name)}</span><span class="sub">${esc(baseName(s.path))}:${s.line}</span></div>`;
  const out = [];
  for (const c of cats) {
    let items = filter ? c.items.filter((s) => fragmentMatch(s.name, filter)) : c.items;
    if (filter && !items.length) continue;
    const ck = "cat:" + c.kind;
    out.push(`<div class="row" data-key="${esc(ck)}"><span class="tw">${isOpen(ck) ? "▾" : "▸"}</span>${kindIcon(c.kind)}<b>${esc(c.kind)}</b><span class="right">${items.length}</span></div>`);
    if (!isOpen(ck)) continue;
    const top = items.filter((s) => !s.scope);
    const groups = new Map();
    for (const s of items.filter((x) => x.scope)) {
      const g = `${s.path}::${s.scope}`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(s);
    }
    const CONTAINER = new Set(["class", "struct", "interface", "trait", "enum", "module", "namespace", "component", "object"]);
    // scoped members, grouped under their container
    for (const [g, list] of [...groups.entries()].sort((a, b) => a[0].split("::").pop().localeCompare(b[0].split("::").pop()))) {
      const gk = `${ck}|${g}`;
      const [path, scope] = g.split("::");
      out.push(`<div class="row" data-key="${esc(gk)}" style="padding-left:24px"><span class="tw">${isOpen(gk) ? "▾" : "▸"}</span>${kindIcon("class")}<span>${esc(scope)}</span><span class="sub">${esc(baseName(path))}</span><span class="right">${list.length}</span></div>`);
      if (isOpen(gk)) list.slice(0, 500).forEach((s) => out.push(row(s, 3, `${gk}|${s.name}`, false)));
    }
    // top-level symbols; containers expand to their members
    for (const s of top.slice(0, 1500)) {
      const sk = `${ck}|${s.path}:${s.line}`;
      const kids = CONTAINER.has(s.kind) ? membersOf(s) : [];
      out.push(row(s, 1.5, sk, kids.length > 0));
      if (kids.length && isOpen(sk)) kids.forEach((m) => out.push(row(m, 3, `${sk}|${m.name}:${m.line}`, false)));
    }
  }
  body.innerHTML = out.join("") || `<div class="report muted">No symbols.</div>`;
  body.querySelectorAll(".row[data-key]").forEach((r) => {
    const k = r.dataset.key;
    const toggle = () => { S.catOpen.has(k) ? S.catOpen.delete(k) : S.catOpen.add(k); renderCategories(body, filter); };
    if (!r.dataset.n) { r.onclick = toggle; return; }
    const s = { name: r.dataset.n, path: r.dataset.p, line: +r.dataset.l, project: S.project, kind: r.dataset.k };
    r.querySelector(".tw").onclick = (e) => { if (e.target.textContent) { e.stopPropagation(); toggle(); } };
    r.onclick = () => { body.querySelectorAll(".row.sel").forEach((x) => x.classList.remove("sel")); r.classList.add("sel"); showContextFor(s); S.relLocked || relationFor(s); };
    r.ondblclick = () => goTo(s);
  });
}

// --------------------------------------------- workspace (all repos) browser
S.wsOpen = new Set(store.get("wsOpen", []));
S.wsFiles = {};
async function renderWorkspaceTree(body, filter) {
  const rows = [];
  for (const p of S.projects) {
    const open = S.wsOpen.has(p.name);
    rows.push(`<div class="row" data-proj="${esc(p.name)}"><span class="tw">${open ? "▾" : "▸"}</span>📦 <b>${esc(p.name)}</b><span class="right">${p.symbols} sym</span></div>`);
    if (!open) continue;
    S.wsFiles[p.name] ||= await api(`/api/projects/${encodeURIComponent(p.name)}/files`);
    const files = S.wsFiles[p.name].filter((f) => !filter || fuzzyScore(f, filter) >= 0);
    const dirs = new Map();
    for (const f of files) { const d = dirName(f) || "."; if (!dirs.has(d)) dirs.set(d, []); dirs.get(d).push(f); }
    for (const [d, fs] of [...dirs.entries()].sort()) {
      const dk = p.name + "::" + d;
      const dOpen = S.wsOpen.has(dk) || !!filter;
      rows.push(`<div class="row" data-dir="${esc(dk)}" style="padding-left:22px"><span class="tw">${dOpen ? "▾" : "▸"}</span>${kindIcon("dir")}<span>${esc(d)}</span><span class="right">${fs.length}</span></div>`);
      if (dOpen) for (const f of fs) rows.push(`<div class="row" data-wp="${esc(p.name)}" data-path="${esc(f)}" style="padding-left:46px">${kindIcon("file")}<span>${esc(baseName(f))}</span></div>`);
    }
  }
  body.innerHTML = rows.join("");
  const toggle = (k) => { S.wsOpen.has(k) ? S.wsOpen.delete(k) : S.wsOpen.add(k); store.set("wsOpen", [...S.wsOpen]); renderWorkspaceTree(body, filter); };
  body.querySelectorAll(".row[data-proj]").forEach((r) => (r.onclick = () => toggle(r.dataset.proj)));
  body.querySelectorAll(".row[data-dir]").forEach((r) => (r.onclick = () => toggle(r.dataset.dir)));
  body.querySelectorAll(".row[data-wp]").forEach((r) => {
    r.onclick = () => (window.innerWidth <= 900 ? openFile(r.dataset.wp, r.dataset.path) : previewFile(r.dataset.wp, r.dataset.path));
    r.ondblclick = () => openFile(r.dataset.wp, r.dataset.path);
  });
}

// -------------------------------------------------- context window: matches
const _showContextResult = window.showContextResult;
window.showContextResult = function (r) {
  _showContextResult(r);
  const sel = $("#contextMatches");
  if (!sel) return;
  const defs = r.defs || [];
  sel.hidden = defs.length < 2;
  sel.innerHTML = defs.map((d, i) => `<option value="${i}">${esc(d.kind)} ${esc(d.name)} — ${esc(d.project !== r.def.project ? d.project + ": " : "")}${esc(d.path)}:${d.line}</option>`).join("");
  const cur = defs.findIndex((d) => d.path === r.def.path && d.line === r.def.line && d.project === r.def.project);
  if (cur >= 0) sel.value = String(cur);
  sel._defs = defs;
};
function initContextChrome() {
  const head = $("#contextPane .pane-head");
  const sel = document.createElement("select");
  sel.id = "contextMatches";
  sel.hidden = true;
  sel.title = "Multiple matches";
  sel.style.maxWidth = "45%";
  head.insertBefore(sel, head.querySelector(".spacer"));
  sel.onchange = () => { const d = sel._defs[+sel.value]; if (d) showContextFor(d); };
  const go = document.createElement("button");
  go.className = "mini"; go.textContent = "↗"; go.title = "Jump to the symbol shown (or double-click the context window)";
  go.onclick = () => ctxEditor._def && goTo({ project: ctxEditor._def.project, path: ctxEditor._def.path, line: ctxEditor._def.line });
  head.insertBefore(go, $("#contextLock"));
}

// ------------------------------------------ relation window: levels, rules
S.relLevels = store.get("relLevels", 1);
const _relationChildren = window.relationChildren;
window.relationChildren = async function (node, mode) {
  // Per-symbol-type rules (SW "Relationship rules"): when mode is "auto", functions show calls, classes show inheritance.
  if (mode === "auto") mode = ["class", "interface", "struct", "trait"].includes(node.kind) ? "hierarchy" : "callees";
  if (mode === "both") {
    const [callers, callees] = await Promise.all([_relationChildren(node, "callers"), _relationChildren(node, "callees")]);
    return [...callers.map((c) => ({ ...c, label: "← " + c.label, relMode: "callers" })), ...callees.map((c) => ({ ...c, label: "→ " + c.label, relMode: "callees" }))];
  }
  return _relationChildren(node, node.relMode || mode);
};
const _renderRelation = window.renderRelation;
window.renderRelation = async function () {
  await _renderRelation();
  if (!S.relTree || S.relLevels <= 1) return;
  // auto-expand N levels; duplicate branches are left collapsed (SW default) to avoid infinite recursion
  const seen = new Set([S.relTree.name]);
  const expand = async (n, depth) => {
    if (depth >= S.relLevels || !n.children) return;
    for (const c of n.children.slice(0, 40)) {
      if (c.leaf || seen.has(c.name)) { c.dup = seen.has(c.name); continue; }
      seen.add(c.name);
      c.open = true;
      c.children = await relationChildren(c, c.relMode || $("#relationMode").value);
      await expand(c, depth + 1);
    }
  };
  const root = S.relTree;
  await expand(root, 1);
  if (S.relTree !== root) return;
  ($("#relationView").value === "graph" ? drawRelationGraph : drawRelationOutline)();
};
function initRelationChrome() {
  const mode = $("#relationMode");
  mode.insertAdjacentHTML("afterbegin", `<option value="auto">Auto (by symbol type)</option>`);
  mode.insertAdjacentHTML("beforeend", `<option value="both">Calls and Callers</option>`);
  mode.value = store.get("relMode", "callers");
  mode.addEventListener("change", () => store.set("relMode", mode.value));
  const lv = document.createElement("select");
  lv.id = "relationLevels";
  lv.title = "Levels to expand automatically";
  lv.innerHTML = [1, 2, 3, 4].map((n) => `<option value="${n}">${n} level${n > 1 ? "s" : ""}</option>`).join("");
  lv.value = String(S.relLevels);
  lv.onchange = () => { S.relLevels = +lv.value; store.set("relLevels", S.relLevels); updateRelation(true); };
  $("#relationView").after(lv);
}

// ------------------------------------------------------ decorations: members
const _decorate = window.decorate;
window.decorate = function () {
  if (S.monoView) { decoIds = editor.deltaDecorations(decoIds, []); decorateBookmarks(); applyHighlights(); return; }
  _decorate();
  // SW shows references to class members in italics ("Ref to Member").
  const m = editor.getModel();
  if (!m || m.getValueLength() > 600_000) return;
  const extra = [];
  const lines = m.getLinesContent();
  for (let i = 0; i < lines.length; i++) {
    const re = /\.([A-Za-z_$][\w$]*)/g;
    let mm;
    while ((mm = re.exec(lines[i]))) {
      const k = S.names[mm[1]];
      if (k === "method" || k === "member" || k === "function") extra.push({ range: new monaco.Range(i + 1, mm.index + 2, i + 1, mm.index + 2 + mm[1].length), options: { inlineClassName: "sw-ref-member" } });
    }
  }
  S._memberIds = editor.deltaDecorations(S._memberIds || [], extra);
};
function toggleMonoView() {
  S.monoView = !S.monoView;
  if (S.monoView) S._memberIds = editor.deltaDecorations(S._memberIds || [], []);
  decorate();
  toast(`Mono Font View ${S.monoView ? "on" : "off"}`);
}

// --------------------------------------------------- project search bar
function initSearchBar() {
  const qs = $("#quickSymbol");
  const bar = document.createElement("input");
  bar.id = "projectSearchBar";
  bar.placeholder = "Search project… (Alt+Shift+P)";
  bar.autocomplete = "off";
  bar.spellcheck = false;
  qs.before(bar);
  bar.onkeydown = async (e) => {
    if (e.key === "Escape") { bar.blur(); editor.focus(); }
    if (e.key !== "Enter" || !bar.value) return;
    const o = store.get("lastSearch", { regex: false, case: false, word: false, glob: "", all: false });
    try {
      const run = (project) => api(`/api/search?${q({ q: bar.value, project, regex: o.regex, case: o.case, word: o.word, glob: o.glob })}`);
      const project = o.all ? undefined : S.project;
      let r = await run(project), title = `Search "${bar.value}"`;
      if (!r.hits.length && project) { r = await run(undefined); title += r.hits.length ? ` — not in ${project}; found in other projects` : ` — no matches in any project`; }
      showResults(title, r.hits, { truncated: r.truncated });
    } catch (err) { toast(err.message); }
  };
}

// ------------------------------------------------------------ fullscreen
function toggleFullScreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => toast("Full screen not allowed here"));
}

// ------------------------------------------------------------ jump to link
function jumpToLink() {
  if (S.ltab === "results" && results.length) return openResult(Math.max(0, resultIdx));
  setLtab("results");
  if (results.length) openResult(Math.max(0, resultIdx));
}

// ------------------------------------------------------------- hooks
window.extendCommands = function () {
  cmd("jumpToDefinition", "Jump To Definition", () => jumpToDefinition(), "Alt+= | Ctrl+= | F12");
  cmd("goToLine", "Go To Line…", () => editor.getAction("editor.action.gotoLine").run(), "F5 | Ctrl+G");
  cmd("searchForward", "Search Forward", () => editor.getAction("editor.action.nextMatchFindAction").run(), "F4");
  cmd("searchBackward", "Search Backward", () => editor.getAction("editor.action.previousMatchFindAction").run(), "F3");
  cmd("searchSelectionForward", "Search Forward For Selection", () => editor.getAction("editor.action.nextSelectionMatchFindAction").run(), "Shift+F4");
  cmd("nextResult", "Go To Next Link", () => openResult(resultIdx + 1), "Shift+F9");
  cmd("prevResult", "Go To Previous Link", () => openResult(resultIdx - 1), "Shift+F8");
  cmd("firstLink", "Go To First Link", () => openResult(0), "Ctrl+Shift+L");
  cmd("jumpToLink", "Jump To Link", jumpToLink, "Ctrl+L");
  cmd("selectionHistory", "Selection History…", selectionHistoryDialog, "Ctrl+Shift+M");
  cmd("highlightWord", "Highlight Word", toggleHighlightWord, "Ctrl+Shift+8");
  cmd("clearHighlights", "Clear Highlights", () => { S.highlights = []; applyHighlights(); }, "Ctrl+Shift+9");
  cmd("activateSearchBar", "Activate Project Search Bar", () => $("#projectSearchBar").focus(), "Alt+Shift+P");
  cmd("activateFileSearchBar", "Activate File Search Bar", () => editor.getAction("actions.find").run(), "Alt+Shift+F | Alt+F");
  cmd("functionUp", "Function Up", () => functionMove(-1), "Num-");
  cmd("functionDown", "Function Down", () => functionMove(1), "Num+");
  cmd("prevChange", "Go To Previous Change", () => gotoChange(-1), "Alt+Num-");
  cmd("nextChange", "Go To Next Change", () => gotoChange(1), "Alt+Num+");
  cmd("copyToClip", "Copy To Clip", copyToClip, "Ctrl+Shift+Delete | Ctrl+Alt+C");
  cmd("cutToClip", "Cut To Clip", () => { const sel = editor.getSelection(); copyToClip(); if (S.clips[0]?.text === editor.getModel().getValueInRange(sel)) editor.executeEdits("clip", [{ range: sel, text: "" }]); }, "Ctrl+Shift+X");
  cmd("fullScreen", "Full Screen", toggleFullScreen, "F11");
  cmd("browseLocalSymbols", "Browse Local File Symbols…", goToSymbolInFile, "F8 | Ctrl+Shift+O");
  cmd("goToSymbolInFile", "Go To Symbol In File…", goToSymbolInFile);
  cmd("goBackToggle", "Go Back Toggle", goBackToggle, "Ctrl+Alt+,");
  cmd("browserMode", "Browser Mode", toggleBrowserMode, "Ctrl+Shift+B");
  cmd("monoView", "Mono Font View", toggleMonoView, "Ctrl+Alt+M");
  cmd("nextRefHighlight", "Go To Next Reference Highlight", () => editor.getAction("editor.action.wordHighlight.next")?.run(), "Ctrl+Alt+Down");
  cmd("prevRefHighlight", "Go To Previous Reference Highlight", () => editor.getAction("editor.action.wordHighlight.prev")?.run(), "Ctrl+Alt+Up");
  cmd("symbolInfo", "Symbol Info", () => editor.getAction("editor.action.showDefinitionPreviewHover")?.run() || editor.getAction("editor.action.showHover").run(), "Ctrl+Shift+I | Alt+F1");
  cmd("jumpToCallerKey", "Jump To Caller", () => runCmd("jumpToCaller"), "Alt+Shift+=");
  cmd("activateSymbolWindow", "Activate Symbol Window", () => $("#symbolFilter").focus(), "Ctrl+Alt+Y");
  cmd("activateProjectSymbolList", "Activate Project Symbol List", () => { setPtab("psymbols"); $("#projectFilter").focus(); }, "Ctrl+Alt+P");
  cmd("activateFileList", "Activate Project File List", () => { setPtab("files"); $("#projectFilter").focus(); }, "Ctrl+Alt+O");
  cmd("togglePreview", "Preview Files On Select", () => { S.previewOnSelect = !S.previewOnSelect; store.set("previewOnSelect", S.previewOnSelect); toast(`Preview on select ${S.previewOnSelect ? "on" : "off"}`); });
  cmd("relationAuto", "Relation: Auto (by symbol type)", () => { $("#relationMode").value = "auto"; setLtab("relation"); updateRelation(true); });
  cmd("relationBoth", "Relation: Calls and Callers", () => { $("#relationMode").value = "both"; setLtab("relation"); updateRelation(true); });
  cmd("relationNextView", "Next Relation Window View", () => runCmd("relationGraph"));
  // menus
  MENUS.Search.splice(MENUS.Search.indexOf("nextResult"), 2, "searchForward", "searchBackward", "searchSelectionForward", "-", "jumpToLink", "firstLink", "nextResult", "prevResult", "-", "activateSearchBar", "activateFileSearchBar", "nextRefHighlight", "prevRefHighlight");
  MENUS.Navigate.push("-", "functionUp", "functionDown", "prevChange", "nextChange", "-", "goBackToggle", "selectionHistory", "browseLocalSymbols", "browserMode");
  MENUS.Edit.splice(MENUS.Edit.indexOf("pasteFromClip"), 0, "cutToClip");
  MENUS.View.push("-", "monoView", "fullScreen", "togglePreview", "relationAuto", "relationBoth", "relationNextView", "-", "activateSymbolWindow", "activateProjectSymbolList", "activateFileList");
};

window.extendEditor = function () {
  editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.Equal, () => runCmd("jumpToDefinition"));
  editor.addCommand(monaco.KeyCode.F5, () => runCmd("goToLine"));
  editor.addCommand(monaco.KeyCode.F8, () => runCmd("browseLocalSymbols"));
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL, () => runCmd("jumpToLink"));
  initPopupToolbar();
  editor.onDidChangeCursorPosition(debounce(updateFunctionBoundary, 120));
  editor.onDidChangeModel(() => { const t = activeTab(); if (t && !t.rev) trackChanges(t); setTimeout(updateFunctionBoundary, 50); });
  // Browser Mode: click on a symbol jumps, Backspace goes back, Space jumps.
  editor.onMouseUp((e) => {
    if (!S.browserMode || e.event.detail !== 1 || !e.target.position) return;
    const w = editor.getModel().getWordAtPosition(e.target.position);
    if (w && S.names[w.word]) jumpToDefinition(w.word);
  });
  editor.onKeyDown((e) => {
    if (!S.browserMode) return;
    if (e.keyCode === monaco.KeyCode.Backspace) { e.preventDefault(); navHistory(-1); }
    if (e.keyCode === monaco.KeyCode.Space) { e.preventDefault(); jumpToDefinition(); }
  });
};

window.afterBoot = function () {
  const pt = $("#projectTabs");
  pt.querySelector('[data-ptab="tree"]').insertAdjacentHTML("afterend", `<button data-ptab="workspace" title="All repositories (Project Folder Browser)">Repos</button>`);
  pt.querySelector('[data-ptab="psymbols"]').insertAdjacentHTML("afterend", `<button data-ptab="categories" title="Project Symbol Categories">Categories</button>`);
  pt.querySelectorAll("button").forEach((b) => (b.onclick = () => setPtab(b.dataset.ptab)));
  initSymbolWindowChrome();
  initContextChrome();
  initRelationChrome();
  initSearchBar();
  renderSymbols();
  const t = activeTab();
  if (t && !t.rev) trackChanges(t);
};
