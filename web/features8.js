/* SourceWeb — the remaining SourceWeb menu commands: split/tiled windows, macro recording,
 * snippet window, options dialog, symbol type filter, bookmark/clip management, git-backed backups,
 * text utilities, toolbar/panel toggles, dynamic menu lists, and Help from the locally mirrored manual. */
"use strict";

// ------------------------------------------------------------ split windows
let editor2 = null, splitLinked = false;
function ensureSplit(orientation = "v") {
  const wrap = $("#editorWrap");
  wrap.classList.toggle("split-h", orientation === "h");
  wrap.classList.toggle("split-v", orientation !== "h");
  if (!editor2) {
    const d = document.createElement("div");
    d.id = "editor2";
    wrap.append(d);
    editor2 = monaco.editor.create(d, { model: null, automaticLayout: true, minimap: { enabled: false }, fontFamily: editor.getOption(monaco.editor.EditorOption.fontFamily), fontSize: editor.getOption(monaco.editor.EditorOption.fontSize), theme: document.documentElement.dataset.theme === "dark" ? "sw-dark" : "sw-light", contextmenu: false });
    editor2.onDidScrollChange((e) => { if (splitLinked && e.scrollTopChanged && editor.getModel() === editor2.getModel()) editor.setScrollTop(e.scrollTop); });
    editor.onDidScrollChange((e) => { if (splitLinked && editor2 && e.scrollTopChanged && editor.getModel() === editor2.getModel()) editor2.setScrollTop(e.scrollTop); });
  }
  wrap.classList.add("split");
  const other = S.mru.map((k) => S.tabs.find((t) => t.key === k)).find((t) => t && t.key !== S.active) || activeTab();
  if (other) editor2.setModel(other.model);
  $("#editor2").hidden = false;
  setTimeout(() => { editor.layout(); editor2.layout(); }, 0);
}
function unsplit() {
  $("#editorWrap").classList.remove("split", "split-h", "split-v");
  if ($("#editor2")) $("#editor2").hidden = true;
  setTimeout(() => editor.layout(), 0);
}
let zoomed = false;
function zoomWindow() {
  zoomed = !zoomed;
  for (const s of ["#symbolPane", "#projectPane", "#bottom", "#workspace > .splitter", ".splitter.h"]) $$(s).forEach((el) => (el.style.visibility = zoomed ? "hidden" : ""));
  document.documentElement.style.setProperty("--symbol-w", zoomed ? "0px" : store.get("layout", {})["--symbol-w"] || "250px");
  document.documentElement.style.setProperty("--project-w", zoomed ? "0px" : store.get("layout", {})["--project-w"] || "300px");
  document.documentElement.style.setProperty("--bottom-h", zoomed ? "0px" : store.get("layout", {})["--bottom-h"] || "230px");
  setTimeout(() => editor.layout(), 0);
}

// --------------------------------------------------------- macro recording
S.recording = null;
S.macro = store.get("macro", []);
const _runCmd8 = window.runCmd;
window.runCmd = function (id, ...a) {
  if (S.recording && !["startRecording", "stopRecording", "playRecording"].includes(id)) S.recording.push({ cmd: id });
  return _runCmd8(id, ...a);
};
function startRecording() {
  S.recording = [];
  const sub = editor.onDidType((text) => S.recording?.push({ type: text }));
  S._recSub = sub;
  document.body.classList.add("recording");
  toast("Recording… (Tools ▸ Stop Recording)");
}
function stopRecording() {
  if (!S.recording) return;
  S._recSub?.dispose();
  // merge consecutive typed characters
  const out = [];
  for (const s of S.recording) { const last = out[out.length - 1]; if (s.type != null && last?.type != null) last.type += s.type; else out.push({ ...s }); }
  S.macro = out; store.set("macro", out); S.recording = null;
  document.body.classList.remove("recording");
  toast(`Recorded ${out.length} step(s)`);
}
async function playRecording() {
  if (!S.macro.length) return toast("Nothing recorded");
  for (const s of S.macro) {
    if (s.type != null) editor.trigger("macro", "type", { text: s.type });
    else await _runCmd8(s.cmd);
  }
}

// --------------------------------------------------------- snippet window
S.userSnippets = store.get("userSnippets", []);
function snippetsForLang() {
  const lang = editor.getModel()?.getLanguageId();
  const builtin = (SNIPPETS[lang] || []).map(([name, body]) => ({ name, body, builtin: true }));
  return [...S.userSnippets.filter((s) => !s.lang || s.lang === lang), ...builtin];
}
function insertSnippet(sn) {
  editor.focus();
  editor.getContribution("snippetController2")?.insert(expandVars(sn.body));
}
function snippetWindow() {
  palette({
    title: "Snippet Window", items: snippetsForLang(), placeholder: "snippet name…",
    filter: (s, v) => s.name.toLowerCase().includes(v.toLowerCase()),
    render: (s) => `✂ <span>${esc(s.name)}</span><span class="sub mono">${esc(s.body.replace(/\s+/g, " ").slice(0, 80))}</span><span class="right">${s.builtin ? "built-in" : "yours"}</span>`,
    pick: insertSnippet, hint: "Enter inserts · Tools ▸ New Snippet adds your own",
  });
}
function newSnippet() {
  const sel = editor.getModel()?.getValueInRange(editor.getSelection()) || "";
  const name = prompt("Snippet name:", "");
  if (!name) return;
  const body = sel || prompt("Snippet text ($date$, $file$, $user$, $symbol$, ${1:placeholder}):", "") || "";
  S.userSnippets.push({ name, body, lang: editor.getModel()?.getLanguageId() });
  store.set("userSnippets", S.userSnippets);
  toast(`Snippet "${name}" saved`);
}

// ------------------------------------------------------------ options dialog
function optionsDialog(section = "Editor") {
  const o = (k) => editor.getOption(monaco.editor.EditorOption[k]);
  const box = document.createElement("div");
  box.id = "optionsBox";
  box.innerHTML = `<div class="pane-head"><span>Options — ${esc(section)}</span><span class="spacer"></span><button class="mini" data-a="x">✕</button></div>
   <div class="report opts">
    <label>Font size <input type="number" id="oFont" min="8" max="32" value="${o("fontSize")}"></label>
    <label>Tab size <input type="number" id="oTab" min="1" max="8" value="${editor.getModel()?.getOptions().tabSize || 4}"></label>
    <label><input type="checkbox" id="oWrap" ${o("wordWrap") !== "off" ? "checked" : ""}> Word wrap</label>
    <label><input type="checkbox" id="oLines" ${o("lineNumbers").renderType !== 0 ? "checked" : ""}> Line numbers</label>
    <label><input type="checkbox" id="oMini" ${o("minimap").enabled ? "checked" : ""}> Overview (minimap)</label>
    <label><input type="checkbox" id="oWs" ${o("renderWhitespace") !== "selection" && o("renderWhitespace") !== "none" ? "checked" : ""}> Visible tabs and spaces</label>
    <label><input type="checkbox" id="oLig" ${store.get("ligatures", false) ? "checked" : ""}> Syntax decorations (operator glyphs)</label>
    <label><input type="checkbox" id="oSmart" ${S.refOpts.smart ? "checked" : ""}> Smart reference matching (Python)</label>
    <label><input type="checkbox" id="oPrev" ${S.previewOnSelect ? "checked" : ""}> Preview files when selected in lists</label>
    <label>Context window tracks <select id="oCtx"><option value="symbol">selected symbol</option><option value="function">enclosing function</option><option value="off">nothing (off)</option></select></label>
    <label>Relation levels <select id="oLv">${[1, 2, 3, 4].map((n) => `<option>${n}</option>`).join("")}</select></label>
   </div><div class="pane-foot"><span class="spacer"></span><button class="mini" data-a="ok">OK</button></div>`;
  document.body.append(box);
  $("#oCtx").value = S.ctxTrack; $("#oLv").value = String(S.relLevels);
  const close = () => box.remove();
  box.querySelector("[data-a=x]").onclick = close;
  box.querySelector("[data-a=ok]").onclick = () => {
    const fs = +$("#oFont").value; editor.updateOptions({ fontSize: fs, wordWrap: $("#oWrap").checked ? "on" : "off", lineNumbers: $("#oLines").checked ? "on" : "off", minimap: { enabled: $("#oMini").checked }, renderWhitespace: $("#oWs").checked ? "all" : "selection" });
    store.set("fontSize", fs); store.set("minimap", $("#oMini").checked);
    editor.getModel()?.updateOptions({ tabSize: +$("#oTab").value });
    if ($("#oLig").checked !== store.get("ligatures", false)) runCmd("syntaxDecorations");
    S.refOpts.smart = $("#oSmart").checked; store.set("refOpts", S.refOpts);
    S.previewOnSelect = $("#oPrev").checked; store.set("previewOnSelect", S.previewOnSelect);
    S.ctxTrack = $("#oCtx").value; store.set("ctxTrack", S.ctxTrack);
    S.relLevels = +$("#oLv").value; store.set("relLevels", S.relLevels); $("#relationLevels").value = String(S.relLevels);
    close(); toast("Options saved");
  };
}

// -------------------------------------------------------- symbol type filter
S.symKindFilter = new Set(store.get("symKindFilter", []));
function symbolTypeFilter() {
  const kinds = [...new Set(S.symbols.map((s) => s.kind))].sort();
  palette({
    title: "Symbol Type Filter — click to show/hide a type", items: kinds,
    render: (k) => `<span class="mcheck">${S.symKindFilter.has(k) ? "☐" : "☑"}</span>${kindIcon(k)}<span>${esc(k)}</span>`,
    filter: (k, v) => k.includes(v),
    pick: (k) => { S.symKindFilter.has(k) ? S.symKindFilter.delete(k) : S.symKindFilter.add(k); store.set("symKindFilter", [...S.symKindFilter]); renderSymbols(); symbolTypeFilter(); },
    hint: "Hidden types are unticked",
  });
}
const _renderSymbols8 = window.renderSymbols;
window.renderSymbols = function () {
  if (!S.symKindFilter.size) return _renderSymbols8();
  const all = S.symbols;
  S.symbols = all.filter((s) => !S.symKindFilter.has(s.kind));
  try { _renderSymbols8(); } finally { S.symbols = all; }
  // rows carry indexes into the filtered list; remap them to the full list
  const shown = all.filter((s) => !S.symKindFilter.has(s.kind));
  $$("#symbolList .row").forEach((r) => { const s = shown[+r.dataset.i]; if (s) r.dataset.i = String(all.indexOf(s)); });
};

// ------------------------------------------------------ text utilities
function editSel(fn) {
  const s = editor.getSelection();
  const m = editor.getModel();
  if (!m) return;
  const range = s.isEmpty() ? new monaco.Range(s.startLineNumber, 1, s.startLineNumber, m.getLineMaxColumn(s.startLineNumber)) : s;
  editor.executeEdits("si", [{ range, text: fn(m.getValueInRange(range)) }]);
}
function reformParagraph(width = 80) {
  editSel((t) => {
    const indent = t.match(/^\s*/)[0];
    const words = t.trim().split(/\s+/);
    const lines = [];
    let cur = indent;
    for (const w of words) { if ((cur + w).length > width && cur.trim()) { lines.push(cur.trimEnd()); cur = indent; } cur += w + " "; }
    lines.push(cur.trimEnd());
    return lines.join("\n");
  });
}
function renumber() {
  const start = +prompt("Renumber starting at:", "1");
  if (Number.isNaN(start)) return;
  let n = start;
  editSel((t) => t.split("\n").map((l) => l.replace(/\d+/, () => String(n++))).join("\n"));
}
function calculate() {
  editSel((t) => {
    if (!/^[\d\s+\-*/().%]+$/.test(t)) { toast("Calculate works on arithmetic like 3*(4+5)"); return t; }
    try { return String(Function(`"use strict"; return (${t})`)()); } catch { toast("Not a valid expression"); return t; }
  });
}
async function insertFile() {
  const path = prompt(`Insert file from ${S.project} (path):`, "");
  if (!path) return;
  try { const txt = await api(`/api/projects/${encodeURIComponent(S.project)}/file?${q({ path })}`); editor.executeEdits("ins", [{ range: editor.getSelection(), text: txt }]); }
  catch (e) { toast(e.message); }
}
function downloadText(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name;
  a.click();
}

// ------------------------------------------------------ bookmarks & clips
function selectedIndex(sel) { return +($(sel + " .row.sel")?.dataset.i ?? -1); }

// ------------------------------------------------------ dynamic menu lists
window.expandMenuItems = function (items) {
  const out = [];
  for (const it of items) {
    const l = String(it.label || "");
    if (/recent files/i.test(l) && !it.submenu) {
      const recent = S.mru.map((k) => S.tabs.find((t) => t.key === k)).filter(Boolean).slice(0, 9);
      const hist = store.get("openTabs", []).map(([p, f]) => ({ project: p, path: f }));
      const seen = new Set();
      const list = [...recent, ...hist].filter((t) => { const k = t.project + "/" + t.path; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 9);
      list.forEach((t, i) => out.push({ label: `${i + 1} ${t.project}/${t.path}`, run: () => openFile(t.project, t.path), cmd: "openFileDialog" }));
      if (!list.length) out.push({ label: "(no recent files)", cmd: "__none" });
    } else if (/^<open file windows list>/i.test(l)) {
      S.tabs.forEach((t, i) => out.push({ label: `${i + 1} ${baseName(t.path)}${t.dirty ? " *" : ""}`, run: () => activateTab(t.key), cmd: "windowList", checked: () => t.key === S.active }));
    } else if (/^<theme names>/i.test(l)) {
      Object.entries(THEMES).forEach(([id, th]) => out.push({ label: th.label, run: () => setTheme(id), cmd: "themeDialog", checked: () => store.get("themeId", "sw-light") === id }));
    } else if (/^<snippet names>/i.test(l)) {
      if (editor?.getModel()) snippetsForLang().forEach((sn) => out.push({ label: sn.name, run: () => insertSnippet(sn), cmd: "snippetWindow" }));
      else out.push({ label: "(open a file)", cmd: "__none" });
    } else if (/inherits editor context menu/i.test(l)) {
      out.push(...(MENUDEF?.context?.editor || []));
    } else if (/<preset>/i.test(l)) {
      ["ruff (Python)", "prettier (JS/TS/JSON/YAML/MD)"].forEach((p) => out.push({ label: `Reformat Source Code with ${p}`, cmd: "formatDocument" }));
    } else out.push(it);
  }
  return out;
};

// ----------------------------------------------------------------- hooks
const SW_MAP_MORE = {
  "open as encoding": "reloadFile", "browse files": "browseFiles", "load file": "openFileDialog", "reload modified files": "reloadModified",
  "save as encoding": "saveAs", "save a copy": "saveACopy", "save all quietly": "saveAll", "save selection": "saveSelection", "new clip": "newClip",
  "open backup file": "openBackup", "save new backup file": "saveFile", "restore file": "restoreFile", "checkpoint": "saveFile", "checkpoint all": "saveAll",
  "copy file path": "copyPath", "load workspace": "openWorkspace", "export file as html": "exportFileHtml", "page setup": "printFile", "exit and suspend": "exitApp",
  "redo all": "redoAll", "repeat typing": "playRecording", "cut word": "cutWord", "cut selection or paste": "cutOrPaste", "select function or symbol": "selectSymbol",
  "select sentence": "selectSentence", "toggle extend mode": "selectBlock", "expand text variables": "expandTextVars", "insert file": "insertFile", "insert ascii": "insertAscii",
  "insert guid": "insertGuid", "tabs to spaces": "tabsToSpaces", "reform paragraph": "reformParagraph", "renumber": "renumber", "calculate": "calculate",
  "toggle insert mode": "toggleWrapInsertDisabled", "load search string": "loadSearchString", "copy project": "copyProjectDisabled", "add file": "newFile",
  "add file list": "addRemoveFiles", "open project master file list": "masterFileList", "export project file list": "exportFileList",
  "import external symbols for current project": "importSymbolsDisabled", "file type options": "optionsDialog", "style properties": "optionsDialog",
  "manage visual themes": "themeDialog", "custom commands": "customCommandsDisabled", "bookmark options": "optionsDialog", "search engines": "searchWebDisabled",
  "enable event handlers": "macrosDisabled", "advanced options": "optionsDialog", "project window command": "toggleProjectWindow", "project symbol list": "activateProjectSymbolList",
  "project file list": "activateFileList", "project folder browser": "browseFiles", "project symbol categories": "showCategories", "project file types": "showFileTypes",
  "snippet window": "snippetWindow", "ftp browser": "ftpDisabled", "main toolbar": "toggleToolbar", "standard toolbar": "toggleToolbar", "browse toolbar": "toggleToolbar",
  "view toolbar": "toggleToolbar", "arrangement toolbar": "toggleToolbar", "layout toolbar": "toggleToolbar", "outline toolbar": "toggleToolbar", "source control toolbar": "toggleToolbar",
  "project search bar": "toggleSearchBar", "file search bar": "activateFileSearchBar", "window tabs": "toggleTabs", "tab tray": "toggleTabs", "symbol window command": "toggleSymbolWindow",
  "visible tabs": "visibleWhitespace", "visible tabs and spaces": "visibleWhitespace", "vertical scroll bar": "toggleScrollbars", "horizontal scroll bar": "toggleScrollbars",
  "show clipboard": "showClipboard", "redraw screen": "redraw", "reformat source code options": "optionsDialog", "command shell": "customCommandsDisabled",
  "check in": "gitStatus", "check out": "gitBranches", "undo check out": "restoreFile", "sync to source control project": "reindexProject", "sync file to source control project": "reloadFile",
  "activate snippet window": "snippetWindow", "start recording": "startRecording", "stop recording": "stopRecording", "play recording": "playRecording",
  "create key list": "createKeyList", "create command list": "createCommandList", "ftp site list": "ftpDisabled", "cascade windows": "tileOne", "tile horizontal": "tileHorizontal",
  "tile vertical": "tileVertical", "tile one window": "tileOne", "tile two windows": "tileVertical", "arrange windows": "tileOne", "zoom window": "zoomWindow",
  "link window": "linkWindow", "link all windows": "linkWindow", "sync file windows": "syncFileWindows", "select next window": "nextTab", "pick window": "windowList",
  "window options": "optionsDialog", "window tab options": "optionsDialog", "help mode": "showKeys", "html help": "swHelp",
 
  "edit condition": "conditionsDisabled", "language properties": "optionsDialog", "symbol type filter": "symbolTypeFilter", "symbol window options": "optionsDialog", "save settings": "saveSettings",
  "project file list options": "optionsDialog", "project symbol list options": "optionsDialog", "project folder browser options": "optionsDialog",
  "project symbol category window options": "optionsDialog", "project file type list properties": "optionsDialog", "context window options": "optionsDialog",
  "view relation outline": "relViewOutline", "relation window graph options": "graphOptions", "search results options": "optionsDialog",
  "(inherits editor context menu)": "__none", "delete bookmark": "deleteBookmark", "delete all bookmarks": "deleteAllBookmarks", "go to bookmark": "gotoBookmark",
  "load bookmarks": "loadBookmarks", "save bookmarks": "saveBookmarks", "view clip": "viewClip", "edit clip": "viewClip", "clip properties": "renameClip",
  "delete clip": "deleteClip", "delete all clips": "deleteAllClips", "clip window options": "optionsDialog", "new snippet": "newSnippet", "snippet properties": "snippetWindow",
  "edit snippet text in editor": "snippetWindow", "delete snippet": "deleteSnippet", "load snippets": "loadSnippets", "save snippets": "saveSnippets", "snippet window options": "optionsDialog",
  "activate window": "windowList", "window list options": "optionsDialog", "edit file": "compareEditFile", "copy to clipboard": "copy", "nesting lines": "toggleGuides",
  "show difference list": "toggleDiffList", "file compare window options": "optionsDialog", "difference list": "toggleDiffList", "compare selected file": "directoryCompare",
  "refresh": "directoryCompare", "previous difference": "prevDiff", "next difference": "nextDiff", "copy file left to right": "dirCopyDisabled", "copy file right to left": "dirCopyDisabled",
  "delete left file": "dirCopyDisabled", "delete right file": "dirCopyDisabled", "directory compare options": "optionsDialog", "scroll bar options": "optionsDialog", "overview options": "optionsDialog",
  "options": "optionsDialog", "preferences": "optionsDialog",
};
Object.assign(SW_MAP, SW_MAP_MORE);
Object.assign(SW_UNAVAILABLE, {
  toggleWrapInsertDisabled: "Overtype mode is not supported by the browser editor component.",
  copyProjectDisabled: "Projects are git repositories; copy one with git clone.",
  customCommandsDisabled: "Running shell commands from the browser is deliberately not offered (any device on the network could run them).",
  macrosDisabled: "SourceWeb macro language event handlers are not supported; use Tools ▸ Start/Play Recording.",
  ftpDisabled: "FTP is not supported; SourceWeb works on the repositories on this machine.",
  networkDisabled: "SourceWeb never contacts external sites.",
  conditionsDisabled: "Edit Condition applies to C preprocessor parsing; these repositories are Python/TypeScript/Terraform/Go.",
  dirCopyDisabled: "Copy files between repositories with git so the change is reviewable.",
});

const _u1 = window.extendCommands, _u3 = window.afterBoot;
window.extendCommands = function () {
  _u1?.();
  const ed = (a) => () => editor.getAction(a)?.run();
  cmd("__none", "(none)", () => {});
  cmd("browseFiles", "Browse Files…", () => setPtab("workspace"));
  cmd("reloadModified", "Reload Modified Files", async () => { for (const t of S.tabs.filter((x) => !x.dirty && !x.rev)) { const txt = await api(`/api/projects/${encodeURIComponent(t.project)}/file?${q({ path: t.path })}`).catch(() => null); if (txt != null && txt !== t.model.getValue()) { t.model.setValue(txt); t.savedVersion = t.model.getAlternativeVersionId(); } } renderTabs(); toast("Reloaded"); });
  cmd("saveACopy", "Save A Copy…", async () => { const t = activeTab(); if (!t) return; const name = prompt("Save a copy as:", t.path.replace(/(\.\w+)?$/, ".copy$1")); if (!name) return; await api(`/api/projects/${encodeURIComponent(t.project)}/file?${q({ path: name })}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: t.model.getValue() }) }); toast(`Copy saved as ${name}`); });
  cmd("saveSelection", "Save Selection…", async () => { const t = activeTab(); const txt = editor.getModel()?.getValueInRange(editor.getSelection()); if (!t || !txt) return toast("Select text first"); const name = prompt("Save selection as:", "selection.txt"); if (!name) return; await api(`/api/projects/${encodeURIComponent(t.project)}/file?${q({ path: name })}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: txt }) }); toast(`Saved ${name}`); });
  cmd("newClip", "New Clip…", () => { const name = prompt("Clip name:"); if (!name) return; const text = prompt("Clip text:", editor.getModel()?.getValueInRange(editor.getSelection()) || "") ?? ""; S.clips.unshift({ name, text }); store.set("clips", S.clips); renderClips(); setLtab("clip"); });
  cmd("openBackup", "Open Backup File", () => { const t = activeTab(); if (t) openFile(t.project, t.path, { rev: "HEAD" }); });
  cmd("restoreFile", "Restore File", async () => { const t = activeTab(); if (!t || !confirm(`Restore ${t.path} to the last committed version? (undoable until you save)`)) return; const head = await api(`/api/projects/${encodeURIComponent(t.project)}/file?${q({ path: t.path, rev: "HEAD" })}`).catch(() => null); if (head == null) return toast("No committed version"); t.model.pushEditOperations([], [{ range: t.model.getFullModelRange(), text: head }], () => null); });
  cmd("exportFileHtml", "Export File as HTML", () => { const t = activeTab(); if (!t) return; const lines = t.model.getLinesContent().map((l, i) => `<tr><td style="color:#999;text-align:right;padding-right:8px">${i + 1}</td><td><pre style="margin:0">${esc(l) || " "}</pre></td></tr>`).join(""); downloadText(baseName(t.path) + ".html", `<!doctype html><meta charset=utf-8><title>${esc(t.path)}</title><table style="font:12px monospace;border-collapse:collapse">${lines}</table>`); });
  cmd("redoAll", "Redo All", () => { const m = editor.getModel(); while (m?.canRedo()) m.redo(); });
  cmd("cutWord", "Cut Word", () => { const p = editor.getPosition(); const w = editor.getModel().getWordAtPosition(p); if (!w) return; const r = new monaco.Range(p.lineNumber, w.startColumn, p.lineNumber, w.endColumn); navigator.clipboard?.writeText(w.word); editor.executeEdits("cw", [{ range: r, text: "" }]); });
  cmd("cutOrPaste", "Cut Selection or Paste", () => (editor.getSelection().isEmpty() ? runCmd("paste") : runCmd("cut")));
  cmd("selectSentence", "Select Sentence", ed("editor.action.smartSelect.expand"), "Shift+F7");
  cmd("expandTextVars", "Expand Text Variables", () => editSel((t) => expandVars(t)));
  cmd("insertFile", "Insert File…", insertFile);
  cmd("insertAscii", "Insert ASCII…", () => { const c = prompt("ASCII / Unicode code (decimal or 0x hex):", "65"); if (c) editor.trigger("k", "type", { text: String.fromCodePoint(Number(c)) }); });
  cmd("insertGuid", "Insert GUID", () => editor.trigger("k", "type", { text: crypto.randomUUID() }));
  cmd("tabsToSpaces", "Tabs to Spaces", ed("editor.action.indentationToSpaces"));
  cmd("reformParagraph", "Reform Paragraph", () => reformParagraph());
  cmd("renumber", "Renumber…", renumber);
  cmd("calculate", "Calculate", calculate);
  cmd("loadSearchString", "Load Search String", () => { editor.getAction("actions.find").run(); });
  cmd("masterFileList", "Open Project Master File List", () => showTextTab(`${S.project} file list`, S.files.join("\n")));
  cmd("exportFileList", "Export Project File List", () => downloadText(`${S.project}-files.txt`, S.files.join("\n") + "\n"));
  cmd("optionsDialog", "Options…", () => optionsDialog(), "Ctrl+Alt+Q");
  cmd("showCategories", "Project Symbol Categories", () => setPtab("categories"));
  cmd("showFileTypes", "Project File Types", () => setPtab("report"));
  cmd("snippetWindow", "Snippet Window", snippetWindow, "Ctrl+Alt+S");
  cmd("newSnippet", "New Snippet…", newSnippet);
  cmd("deleteSnippet", "Delete Snippet…", () => palette({ title: "Delete snippet", items: S.userSnippets, render: (s) => `<span>${esc(s.name)}</span>`, filter: (s, v) => s.name.includes(v), pick: (s) => { S.userSnippets.splice(S.userSnippets.indexOf(s), 1); store.set("userSnippets", S.userSnippets); toast("Deleted"); } }));
  cmd("saveSnippets", "Save Snippets", () => downloadText("snippets.json", JSON.stringify(S.userSnippets, null, 1)));
  cmd("loadSnippets", "Load Snippets…", () => pickJson((d) => { S.userSnippets = d; store.set("userSnippets", d); toast(`${d.length} snippets loaded`); }));
  cmd("toggleToolbar", "Toolbar", () => { const t = $("#toolbar"); t.hidden = !t.hidden; t.style.display = t.hidden ? "none" : ""; setTimeout(() => editor.layout(), 0); });
  cmd("toggleSearchBar", "Project Search Bar", () => { const b = $("#projectSearchBar"); b.style.display = b.style.display === "none" ? "" : "none"; });
  cmd("toggleTabs", "Window Tabs", () => { const t = $("#tabs"); t.style.display = t.style.display === "none" ? "" : "none"; setTimeout(() => editor.layout(), 0); });
  cmd("visibleWhitespace", "Visible Tabs and Spaces", () => editor.updateOptions({ renderWhitespace: editor.getOption(monaco.editor.EditorOption.renderWhitespace) === "all" ? "selection" : "all" }));
  cmd("toggleScrollbars", "Scroll Bars", () => { S.noScroll = !S.noScroll; editor.updateOptions({ scrollbar: { vertical: S.noScroll ? "hidden" : "auto", horizontal: S.noScroll ? "hidden" : "auto" } }); });
  cmd("showClipboard", "Show Clipboard", async () => { try { showTextTab("Clipboard", await navigator.clipboard.readText()); } catch { toast("The browser blocked clipboard access"); } });
  cmd("redraw", "Redraw Screen", () => { editor.layout(); ctxEditor.layout(); decorate(); });
  cmd("startRecording", "Start Recording", startRecording);
  cmd("stopRecording", "Stop Recording", stopRecording);
  cmd("playRecording", "Play Recording", playRecording);
  cmd("createKeyList", "Create Key List", () => showTextTab("Key List", Object.values(COMMANDS).filter((c) => c.key).map((c) => `${c.key.padEnd(34)} ${c.label}`).sort().join("\n")));
  cmd("createCommandList", "Create Command List", () => showTextTab("Command List", Object.values(COMMANDS).map((c) => c.label).filter((l) => !l.startsWith("(")).sort().join("\n")));
  cmd("tileVertical", "Tile Vertical", () => ensureSplit("v"));
  cmd("tileHorizontal", "Tile Horizontal", () => ensureSplit("h"));
  cmd("tileOne", "Tile One Window", unsplit);
  cmd("zoomWindow", "Zoom Window", zoomWindow);
  cmd("linkWindow", "Link Window", () => { if (!editor2 || $("#editor2").hidden) ensureSplit("v"); splitLinked = !splitLinked; toast(`Windows ${splitLinked ? "linked: they scroll together" : "unlinked"}`); });
  cmd("syncFileWindows", "Sync File Windows", () => { ensureSplit("v"); editor2.setModel(editor.getModel()); splitLinked = true; });
  cmd("swHelp", "SourceWeb Help", () => window.open("/help", "_blank", "noopener"));
  cmd("symbolTypeFilter", "Symbol Type Filter…", symbolTypeFilter);
  cmd("saveSettings", "Save Settings", () => { store.set("symSort", S.symSort); store.set("layout", Object.fromEntries(["--symbol-w", "--project-w", "--bottom-h", "--context-w"].map((v) => [v, document.documentElement.style.getPropertyValue(v)]).filter(([, x]) => x))); toast("Settings saved as defaults"); });
  cmd("deleteBookmark", "Delete Bookmark", () => { const i = selectedIndex("#bookmarksBody"); if (i < 0) return toast("Select a bookmark"); S.bookmarks.splice(i, 1); store.set("bookmarks", S.bookmarks); renderBookmarks(); decorateBookmarks(); });
  cmd("deleteAllBookmarks", "Delete All Bookmarks", () => { if (!confirm("Delete all bookmarks?")) return; S.bookmarks = []; store.set("bookmarks", []); renderBookmarks(); decorateBookmarks(); });
  cmd("gotoBookmark", "Go To Bookmark", () => { const i = selectedIndex("#bookmarksBody"); if (i >= 0) goTo(S.bookmarks[i]); else runCmd("bookmarkList"); });
  cmd("saveBookmarks", "Save Bookmarks", () => downloadText("bookmarks.json", JSON.stringify(S.bookmarks, null, 1)));
  cmd("loadBookmarks", "Load Bookmarks…", () => pickJson((d) => { S.bookmarks = d; store.set("bookmarks", d); renderBookmarks(); decorateBookmarks(); }));
  cmd("viewClip", "View Clip", () => { const i = selectedIndex("#clipBody"); const c = S.clips[i]; if (c) showTextTab(`clip: ${c.name}`, c.text); });
  cmd("renameClip", "Clip Properties…", () => { const i = selectedIndex("#clipBody"); const c = S.clips[i]; if (!c) return; const n = prompt("Clip name:", c.name); if (n) { c.name = n; store.set("clips", S.clips); renderClips(); } });
  cmd("deleteClip", "Delete Clip", () => { const i = selectedIndex("#clipBody"); if (i < 0) return; S.clips.splice(i, 1); store.set("clips", S.clips); renderClips(); });
  cmd("deleteAllClips", "Delete All Clips", () => { if (!confirm("Delete all clips?")) return; S.clips = []; store.set("clips", []); renderClips(); });
  cmd("compareEditFile", "Edit File", () => { $("#cmpClose")?.click(); });
  cmd("toggleGuides", "Nesting Lines", () => editor.updateOptions({ guides: { indentation: !editor.getOption(monaco.editor.EditorOption.guides).indentation } }));
  cmd("toggleDiffList", "Show Difference List", () => { const d = $("#diffList"); if (d) { d.style.display = d.style.display === "none" ? "" : "none"; $("#compareBody").style.gridTemplateColumns = d.style.display === "none" ? "1fr" : ""; } });
  cmd("prevDiff", "Previous Difference", () => $("#cmpPrev")?.click());
  cmd("nextDiff", "Next Difference", () => $("#cmpNext")?.click());
  for (const id of Object.keys(SW_UNAVAILABLE)) if (!COMMANDS[id]) cmd(id, "(unavailable)", () => toast(SW_UNAVAILABLE[id], 6000));
};
function pickJson(cb) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".json,application/json";
  inp.onchange = async () => { try { cb(JSON.parse(await inp.files[0].text())); } catch { toast("Not a valid JSON file"); } };
  inp.click();
}
window.afterBoot = async function () { await _u3?.(); };
