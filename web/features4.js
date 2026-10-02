/* SourceWeb — Terraform-aware navigation, pinned Relation windows, Jump To Prototype, and P2 features
 * (comment heading styles, Parse Source Links, snippets, Export to HTML). Chains onto earlier hooks. */
"use strict";

// --------------------------------------------------------------- Terraform
const isTf = (t) => t && /\.(tf|tfvars|hcl)$/i.test(t.path);
function tfExprAt(model, pos) {
  const line = model.getLineContent(pos.lineNumber);
  const re = /[A-Za-z_][\w-]*(?:\[[^\]]*\])?(?:\.[A-Za-z_*][\w-]*(?:\[[^\]]*\])?)+/g;
  let m;
  while ((m = re.exec(line))) {
    const s = m.index + 1, e = s + m[0].length;
    if (pos.column >= s && pos.column <= e) return m[0];
  }
  return null;
}
async function tfResolve(t, expr) {
  if (!expr || !/^(var|local|module|data|[a-z][\w-]*_[\w-]+)\./.test(expr)) return [];
  try { return await api(`/api/projects/${encodeURIComponent(t.project)}/tfdef?${q({ path: t.path, expr })}`); } catch { return []; }
}
window.languageDefinition = async (model, pos, t) => {
  if (!isTf(t)) return null;
  const defs = await tfResolve(t, tfExprAt(model, pos));
  return defs.length ? defs.map((d) => ({ uri: monaco.Uri.parse(`sw://${d.project}/${d.path}`), range: new monaco.Range(d.line, 1, d.line, 1) })) : null;
};
const _jumpToDefinition = window.jumpToDefinition;
window.jumpToDefinition = async function (name) {
  const t = activeTab();
  if (isTf(t) && name === undefined) {
    const defs = await tfResolve(t, tfExprAt(editor.getModel(), editor.getPosition()));
    if (defs.length) return goTo(defs[0]);
  }
  return _jumpToDefinition(name ?? wordAtCursor());
};
const _updateContext4 = window.updateContext;
window.updateContext = async function (name) {
  const t = activeTab();
  if (isTf(t) && S.ctxTrack !== "off" && !S.ctxLocked) {
    const defs = await tfResolve(t, tfExprAt(editor.getModel(), editor.getPosition()));
    if (defs.length) return showContextFor(defs[0]);
  }
  return _updateContext4(name);
};

// ------------------------------------------------------ jump to prototype
async function jumpToPrototype() {
  const t = activeTab();
  const name = wordAtCursor();
  if (!name || !t) return;
  const defs = await api(`/api/projects/${encodeURIComponent(t.project)}/definition?${q({ name, path: t.path })}`);
  // prototypes: declarations in stubs/headers/type files, interface members, abstract signatures
  const protos = defs.filter((d) => /\.(pyi|d\.ts|h|hpp)$/.test(d.path) || ["prototype", "interface", "signature", "abstract"].includes(d.kind) || /interface/i.test(d.scope_kind || ""));
  if (!protos.length) return toast(`No prototype found for ${name}`);
  goTo(protos[0]);
}

// ------------------------------------------------- pinned relation windows
// SW supports several Relation windows with independent settings; here a relation can be pinned into its own tab.
let pinCount = 0;
function pinRelation() {
  if (!S.relTree) return toast("Nothing in the Relation window to pin");
  const id = `pin${++pinCount}`;
  const tree = S.relTree;
  const mode = $("#relationMode").value;
  const btn = document.createElement("button");
  btn.dataset.ltab = id;
  btn.innerHTML = `📌 ${esc(tree.name)} <span class="x" title="Close">×</span>`;
  $("#lowerTabs").append(btn);
  const panel = document.createElement("div");
  panel.className = "lpanel";
  panel.dataset.lpanel = id;
  panel.innerHTML = `<div class="pane-head"><span>${esc(tree.name)}</span><span class="muted">${esc($("#relationMode").selectedOptions[0].text)}</span></div><div class="list tree"></div>`;
  $("#lowerBody").append(panel);
  btn.onclick = (e) => {
    if (e.target.classList.contains("x")) { btn.remove(); panel.remove(); setLtab("relation"); return; }
    setLtab(id);
  };
  const body = panel.querySelector(".list");
  const draw = () => {
    const rows = [];
    const walk = (n, depth, path) => { rows.push({ n, depth, path }); if (n.open && n.children) n.children.forEach((c, i) => walk(c, depth + 1, path + "." + i)); };
    walk(tree, 0, "0");
    body.innerHTML = rows.map(({ n, depth, path }) => `<div class="row" data-path="${path}" style="padding-left:${4 + depth * 16}px"><span class="tw">${n.leaf ? "" : n.open ? "▾" : "▸"}</span>${kindIcon(n.kind || "function")}<span>${esc(n.label)}</span><span class="sub">${esc(n.sub || "")}</span></div>`).join("");
    const nodeAt = (p) => p.split(".").slice(1).reduce((n, i) => n.children[+i], tree);
    body.querySelectorAll(".row").forEach((r) => {
      const n = nodeAt(r.dataset.path);
      r.querySelector(".tw").onclick = async (e) => { e.stopPropagation(); if (n.leaf) return; n.open = !n.open; if (n.open && !n.children) n.children = await relationChildren(n, n.relMode || mode); draw(); };
      r.onclick = () => n.path && showContextFor(n);
      r.ondblclick = () => n.path && goTo({ project: n.project, path: n.path, line: n.hitLine || n.line });
    });
  };
  draw();
  setLtab(id);
}

// ------------------------------------------------- comment heading styles
// SW renders "//1".."//4" comments as headings; for Python/HCL/shell we accept "#1".."#4" too.
let headingIds = [];
function decorateHeadings() {
  const m = editor.getModel();
  if (!m || S.monoView || m.getLineCount() > 20000) { headingIds = editor.deltaDecorations(headingIds, []); return; }
  const decos = [];
  const lines = m.getLinesContent();
  lines.forEach((l, i) => {
    const mm = l.match(/^(\s*)(\/\/|#)([1-4])\s(.*)$/);
    if (!mm) return;
    const lvl = mm[3];
    const startMarker = mm[1].length + 1, endMarker = startMarker + mm[2].length + 1;
    decos.push({ range: new monaco.Range(i + 1, endMarker + 1, i + 1, l.length + 1), options: { inlineClassName: `sw-h${lvl}` } });
    if (editor.getPosition()?.lineNumber !== i + 1) decos.push({ range: new monaco.Range(i + 1, startMarker, i + 1, endMarker + 1), options: { inlineClassName: "sw-h-marker" } });
  });
  headingIds = editor.deltaDecorations(headingIds, decos);
}

// ------------------------------------------------------ parse source links
function parseSourceLinks() {
  const box = document.createElement("div");
  box.id = "parseBox";
  box.innerHTML = `<div class="pane-head"><span>Parse Source Links</span><span class="spacer"></span><button class="mini" data-a="x">✕</button></div>
    <div class="report muted">Paste compiler / test / terraform output. Lines like <span class="kbd">path/file.py:42</span>, <span class="kbd">File "x.py", line 42</span>, <span class="kbd">file.ts(42,7)</span> become source links in the Search Results window.</div>
    <textarea id="parseText" spellcheck="false"></textarea>
    <div class="pane-foot"><span class="spacer"></span><button class="mini" data-a="go">Parse</button></div>`;
  document.body.append(box);
  const close = () => box.remove();
  box.querySelector("[data-a=x]").onclick = close;
  $("#parseText").focus();
  box.querySelector("[data-a=go]").onclick = () => {
    const txt = $("#parseText").value;
    const hits = [];
    const pats = [/File "([^"]+)", line (\d+)/, /([\w./-]+\.[A-Za-z]{1,6}):(\d+)(?::\d+)?/, /([\w./-]+\.[A-Za-z]{1,6})\((\d+)(?:,\d+)?\)/];
    for (const line of txt.split("\n")) {
      for (const re of pats) {
        const m = line.match(re);
        if (!m) continue;
        let p = m[1].replace(/^\.\//, "");
        // map absolute or repo-prefixed paths onto a project
        let project = S.project;
        for (const pr of S.projects) { const i = p.indexOf(pr.name + "/"); if (i >= 0) { project = pr.name; p = p.slice(i + pr.name.length + 1); break; } }
        const files = project === S.project ? S.files : null;
        if (files && !files.includes(p)) { const cand = files.find((f) => f.endsWith("/" + p) || p.endsWith("/" + f)); if (cand) p = cand; }
        hits.push({ project, path: p, line: +m[2], text: line.trim().slice(0, 300) });
        break;
      }
    }
    close();
    showResults("Parsed source links", hits);
    toast(`${hits.length} source link(s)`);
  };
}

// ---------------------------------------------------------------- snippets
// SW-style snippets with text variables ($date$, $file$, $user$, $symbol$).
const SNIPPETS = {
  python: [["def", "def ${1:name}(${2:args}):\n    \"\"\"${3:Docstring.}\"\"\"\n    ${0:pass}"], ["class", "class ${1:Name}:\n    def __init__(self${2:, args}):\n        ${0:pass}"], ["main", "if __name__ == \"__main__\":\n    ${0:main()}"], ["todo", "# TODO($user$, $date$): ${0}"], ["fastapi-route", "@router.${1|get,post,put,delete|}(\"/${2:path}\")\nasync def ${3:handler}(${4}):\n    ${0:...}"]],
  typescript: [["fn", "function ${1:name}(${2}): ${3:void} {\n\t${0}\n}"], ["comp", "export function ${1:Component}(${2:props}: ${3:Props}) {\n\treturn (\n\t\t<div>${0}</div>\n\t);\n}"], ["todo", "// TODO($user$, $date$): ${0}"]],
  hcl: [["resource", "resource \"${1:type}\" \"${2:name}\" {\n  ${0}\n}"], ["variable", "variable \"${1:name}\" {\n  type        = ${2:string}\n  description = \"${3}\"\n}"], ["output", "output \"${1:name}\" {\n  value = ${0}\n}"], ["module", "module \"${1:name}\" {\n  source = \"${2:../modules/x}\"\n  ${0}\n}"]],
};
SNIPPETS.javascript = SNIPPETS.typescript;
function expandVars(s) {
  const t = activeTab();
  return s.replace(/\$date\$/g, new Date().toISOString().slice(0, 10)).replace(/\$file\$/g, t ? baseName(t.path) : "").replace(/\$user\$/g, S.user || "").replace(/\$symbol\$/g, symbolAtLine(editor.getPosition().lineNumber)?.name || "");
}
function registerSnippets() {
  for (const [lang, list] of Object.entries(SNIPPETS)) {
    monaco.languages.registerCompletionItemProvider(lang, {
      provideCompletionItems: (model, pos) => {
        const w = model.getWordUntilPosition(pos);
        const range = new monaco.Range(pos.lineNumber, w.startColumn, pos.lineNumber, w.endColumn);
        return { suggestions: list.map(([label, body]) => ({ label: `✂ ${label}`, filterText: label, kind: monaco.languages.CompletionItemKind.Snippet, insertText: expandVars(body), insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range, detail: "snippet", sortText: "~" + label })) };
      },
    });
  }
}

// ------------------------------------------------------------ export HTML
async function exportHtml() {
  if (!confirm(`Export ${S.project} to a static, syntax-formatted HTML site on this machine (data/export/${S.project})?`)) return;
  toast("Exporting…");
  try {
    const r = await api(`/api/projects/${encodeURIComponent(S.project)}/export`, { method: "POST" });
    toast(`Exported ${r.files} files`);
    window.open(r.url, "_blank");
  } catch (e) { toast(`Export failed: ${e.message}`); }
}

// ------------------------------------------------------------------- hooks
const _y1 = window.extendCommands, _y2 = window.extendEditor, _y3 = window.afterBoot;
window.extendCommands = function () {
  _y1?.();
  cmd("jumpToPrototype", "Jump To Prototype", jumpToPrototype);
  cmd("pinRelation", "New Relation Window (pin current)", pinRelation, "Ctrl+Alt+N");
  cmd("parseSourceLinks", "Parse Source Links…", parseSourceLinks);
  cmd("exportHtml", "Export Project To HTML…", exportHtml);
  cmd("projectReportFile", "Project Report (.RPT)…", () => window.open(`/api/projects/${encodeURIComponent(S.project)}/report.rpt?symbols=true`, "_blank"));
  cmd("syntaxDecorations", "Syntax Decorations (operator glyphs)", () => {
    const on = !store.get("ligatures", false); store.set("ligatures", on);
    for (const ed of [editor, ctxEditor]) ed.updateOptions({ fontLigatures: on });
    toast(`Syntax decorations ${on ? "on: != <= >= -> render as glyphs" : "off"}`);
  });
  MENUS.Search.push("jumpToPrototype");
  MENUS.Project.push("-", "parseSourceLinks", "exportHtml", "projectReportFile");
  MENUS.Options.splice(3, 0, "syntaxDecorations");
  MENUS.View.push("pinRelation");
};
window.extendEditor = function () {
  _y2?.();
  registerSnippets();
  const deco = debounce(decorateHeadings, 200);
  editor.onDidChangeModel(deco);
  editor.onDidChangeModelContent(deco);
  editor.onDidChangeCursorPosition(deco);
};
window.afterBoot = async function () {
  await _y3?.();
  const head = $('[data-lpanel="relation"] .pane-head');
  const pin = document.createElement("button");
  pin.className = "mini"; pin.textContent = "📌"; pin.title = "Pin into a new Relation window (Ctrl+Alt+N)";
  pin.onclick = pinRelation;
  head.insertBefore(pin, $("#relationLock"));
  decorateHeadings();
  // the bundled JetBrains Mono loads asynchronously; re-measure once it is ready
  document.fonts?.ready.then(() => { monaco.editor.remeasureFonts(); });
  if (store.get("ligatures", false)) for (const ed of [editor, ctxEditor]) ed.updateOptions({ fontLigatures: true });
};
