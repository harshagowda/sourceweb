/* SourceWeb — syntax decorations: scaled nested brackets. With Options ▸ Syntax Decorations on, outer
 * brackets are drawn larger than inner ones so nesting is visible at a glance (display only; text unchanged). */
"use strict";
let parenIds = [];
function decorateParens() {
  const m = editor?.getModel();
  if (!m) return;
  if (!store.get("ligatures", false) || S.monoView || m.getValueLength() > 300_000) { parenIds = editor.deltaDecorations(parenIds, []); return; }
  const decos = [];
  const open = "([{", close = ")]}";
  let depth = 0, quote = null;
  const lines = m.getLinesContent();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    for (let c = 0; c < l.length; c++) {
      const ch = l[c];
      if (quote) { if (ch === "\\") c++; else if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
      if (ch === "#" && /^(python|shell|yaml|hcl|ruby|ini|dockerfile)$/.test(m.getLanguageId())) break;
      if (ch === "/" && l[c + 1] === "/") break;
      const isOpen = open.includes(ch), isClose = close.includes(ch);
      if (!isOpen && !isClose) continue;
      if (isClose) depth = Math.max(0, depth - 1);
      if (depth < 2) decos.push({ range: new monaco.Range(i + 1, c + 1, i + 1, c + 2), options: { inlineClassName: `sw-paren-${depth}`, inlineClassNameAffectsLetterSpacing: true } });
      if (isOpen) depth++;
    }
    if (quote && quote !== "`") quote = null; // single-line strings end at the line break
  }
  parenIds = editor.deltaDecorations(parenIds, decos);
}
const _p2 = window.extendEditor, _p1 = window.extendCommands;
window.extendEditor = function () {
  _p2?.();
  const d = debounce(decorateParens, 250);
  editor.onDidChangeModel(d);
  editor.onDidChangeModelContent(d);
};
window.extendCommands = function () {
  _p1?.();
  const base = COMMANDS.syntaxDecorations?.run;
  if (base) cmd("syntaxDecorations", "Syntax Decorations", () => { base(); setTimeout(decorateParens, 50); });
};
