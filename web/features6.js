/* SourceWeb — Relation Window graph view, SourceWeb style.
 * Tidy left→right tree; for "Calls and Callers" the callers fan out to the LEFT of the selected symbol and the
 * callees to the RIGHT. Arrows always point from caller to callee (from derived to base for inheritance).
 * Pan (drag), zoom (wheel / buttons), fit-to-view, click = preview + expand/collapse, double-click = jump.
 * A full-size "Call Graph" view (⤢) opens over the editor. */
"use strict";

const G = { W: 210, H: 38, GX: 70, GY: 10, MAX_KIDS: 18 };
// Graph Options: line style, node shape, spacing, shadows (persisted per browser)
S.graphStyle = Object.assign({ lines: "spline", shape: "rounded", spacing: "normal", shadow: true }, store.get("graphStyle", {}));
function applyGraphSpacing() { const f = { compact: 0.6, normal: 1, wide: 1.5 }[S.graphStyle.spacing] || 1; G.GX = Math.round(70 * f); G.GY = Math.round(10 * f); }
applyGraphSpacing();
const KIND_FILL = (k) => ({ function: "--g-func", class: "--g-class", variable: "--g-var", type: "--g-type", constant: "--g-const" }[KIND_CLASS(k)] || "--g-other");

function graphLayout(root) {
  // returns {nodes:[{n,x,y,side}], edges:[{from,to}]} with root at x=0
  const nodes = [], edges = [];
  const sideKids = (n, side) => {
    if (!(n.open && n.children)) return [];
    let kids = n.children;
    if (n === root && root._split) kids = kids.filter((c) => (side < 0 ? c.relMode === "callers" : c.relMode !== "callers"));
    const cap = n._showAll ? Infinity : G.MAX_KIDS;
    if (kids.length > cap) kids = [...kids.slice(0, cap), { label: `… ${kids.length - cap} more (click)`, leaf: true, more: n, kind: "other" }];
    return kids;
  };
  const placeSide = (side) => {
    let y = 0;
    const place = (n, depth) => {
      const kids = depth === 0 ? sideKids(root, side) : sideKids(n, side);
      let cy;
      if (!kids.length) { cy = y; y += G.H + G.GY; }
      else {
        const ys = kids.map((k) => place(k, depth + 1));
        cy = (ys[0] + ys[ys.length - 1]) / 2;
      }
      if (depth > 0) nodes.push({ n, x: side * depth * (G.W + G.GX), y: cy, side, depth });
      kids.forEach((k) => {
        const child = nodes.find((o) => o.n === k && o.side === side);
        edges.push({ parent: n, child: k, side });
      });
      return cy;
    };
    const rootY = place(root, 0);
    return { rootY, height: y };
  };
  const right = placeSide(1);
  let left = { rootY: right.rootY, height: 0 };
  if (root._split) {
    const before = nodes.length;
    left = placeSide(-1);
    // vertically centre both sides on the root
    const shift = right.rootY - left.rootY;
    for (let i = before; i < nodes.length; i++) nodes[i].y += shift;
  }
  nodes.push({ n: root, x: 0, y: right.rootY, side: 0, depth: 0, root: true });
  const at = new Map(nodes.map((o) => [o.n, o]));
  const lines = edges.map((e) => {
    const p = e.parent === root ? at.get(root) : [...at.values()].find((o) => o.n === e.parent && o.side === e.side) || at.get(e.parent);
    const c = at.get(e.child);
    return p && c ? { p, c, side: e.side } : null;
  }).filter(Boolean);
  return { nodes, lines };
}

// which way the arrow points, by relation semantics
function arrowFromChild(mode, line) {
  if (mode === "both") return line.side < 0;          // callers (left side) call the parent
  return mode === "callers" || mode === "hierarchy" && line.c.n.rel === "child";
}

function renderGraph(host, root, mode, { big = false } = {}) {
  root._split = mode === "both";
  const { nodes, lines } = graphLayout(root);
  const xs = nodes.map((o) => o.x), ys = nodes.map((o) => o.y);
  const minX = Math.min(...xs) - 20, maxX = Math.max(...xs) + G.W + 20;
  const minY = Math.min(...ys) - 20, maxY = Math.max(...ys) + G.H + 20;
  const color = (v) => `var(${v})`;
  const edgePath = ({ p, c }) => {
    const leftToRight = c.x > p.x;
    const x1 = leftToRight ? p.x + G.W : p.x, x2 = leftToRight ? c.x : c.x + G.W;
    const y1 = p.y + G.H / 2, y2 = c.y + G.H / 2, mx = (x1 + x2) / 2;
    if (S.graphStyle.lines === "direct") return { d: `M${x1},${y1} L${x2},${y2}`, rev: `M${x2},${y2} L${x1},${y1}` };
    if (S.graphStyle.lines === "orthogonal") return { d: `M${x1},${y1} H${mx} V${y2} H${x2}`, rev: `M${x2},${y2} H${mx} V${y1} H${x1}` };
    return { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, rev: `M${x2},${y2} C${mx},${y2} ${mx},${y1} ${x1},${y1}` };
  };
  host.innerHTML = `<div class="g-tools">
      <button class="mini" data-g="fit" title="Fit to window">⤧ Fit</button><button class="mini" data-g="in" title="Zoom in">＋</button><button class="mini" data-g="out" title="Zoom out">－</button>
      ${big ? "" : `<button class="mini" data-g="big" title="Open large Call Graph view">⤢ Large</button>`}
      <button class="mini" data-g="svg" title="Save graph as SVG (local download)">⭳ SVG</button>
      <span class="muted g-legend">${mode === "both" ? "◀ callers · callees ▶" : mode === "callers" ? "callers → selected" : mode === "callees" ? "selected → callees" : ""} · drag to pan · wheel to zoom · click = preview/expand · double-click = jump</span></div>
    <svg class="g-svg" xmlns="http://www.w3.org/2000/svg"><defs>
      <marker id="g-arr${big ? "B" : ""}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--g-edge)"/></marker>
      <filter id="g-sh${big ? "B" : ""}" x="-10%" y="-10%" width="130%" height="140%"><feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-opacity=".18"/></filter></defs>
      <g class="g-world">
      ${lines.map((l) => { const e = edgePath(l); const fromChild = arrowFromChild(mode, l); return `<path d="${fromChild ? e.rev : e.d}" class="g-edge" marker-end="url(#g-arr${big ? "B" : ""})"/>`; }).join("")}
      ${nodes.map((o, i) => {
        const n = o.n;
        const expandable = !n.leaf && !o.root && !n.more;
        const sub = n.more ? "" : (n.path ? `${baseName(n.path)}:${n.hitLine || n.line}` : n.sub || "");
        const kx = o.side < 0 ? o.x - 9 : o.x + G.W + 9;
        return `<g class="g-node ${o.root ? "root" : ""}" data-i="${i}" transform="translate(${o.x},${o.y})">
          <rect width="${G.W}" height="${G.H}" rx="${{ rounded: 5, square: 0, pill: G.H / 2 }[S.graphStyle.shape] ?? 5}" fill="${color(KIND_FILL(n.kind))}" ${S.graphStyle.shadow ? `filter="url(#g-sh${big ? "B" : ""})"` : ""}/>
          <rect width="5" height="${G.H}" rx="2" fill="${color(KIND_FILL(n.kind) + "-strong")}"/>
          <text x="12" y="15" class="g-name">${esc(String(n.label || n.name || "").replace(/^[←→▲▼] /, "").replace(/^anonymous(Function|Object|Class)[0-9a-f]+$/, "ƒ (anonymous)").slice(0, 27))}</text>
          <text x="12" y="30" class="g-sub">${esc(sub.slice(0, 34))}</text>
          ${expandable ? `<g class="g-tog" data-t="${i}" transform="translate(${kx - o.x},${G.H / 2})"><circle r="7"/><text y="4" text-anchor="middle">${n.open ? "−" : "+"}</text></g>` : ""}
        </g>`;
      }).join("")}
      </g></svg>`;
  const svg = host.querySelector("svg");
  const world = svg.querySelector(".g-world");
  const st = host._view || { k: 1, x: 0, y: 0 };
  const apply = () => world.setAttribute("transform", `translate(${st.x},${st.y}) scale(${st.k})`);
  const fit = () => {
    const r = svg.getBoundingClientRect();
    const w = maxX - minX, h = maxY - minY;
    // fit if it stays readable; otherwise keep a readable zoom and centre on the selected symbol
    st.k = Math.min(1.25, (r.width - 10) / w, (r.height - 10) / h);
    if (st.k >= 0.6) {
      st.x = (r.width - w * st.k) / 2 - minX * st.k;
      st.y = (r.height - h * st.k) / 2 - minY * st.k;
    } else {
      st.k = Math.max(0.6, Math.min(1, st.k * 2));
      const ro = nodes.find((o) => o.root);
      st.x = r.width / 2 - (ro.x + G.W / 2) * st.k;
      st.y = r.height / 2 - (ro.y + G.H / 2) * st.k;
    }
    apply();
  };
  host._view = st;
  if (!host._keepView) fit(); else apply();
  host._keepView = false;
  const zoom = (f, cx, cy) => { const r = svg.getBoundingClientRect(); cx ??= r.width / 2; cy ??= r.height / 2; st.x = cx - (cx - st.x) * f; st.y = cy - (cy - st.y) * f; st.k *= f; apply(); };
  svg.onwheel = (e) => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top); };
  let drag = null;
  svg.onpointerdown = (e) => { if (e.target.closest(".g-node")) return; drag = { x: e.clientX - st.x, y: e.clientY - st.y }; svg.setPointerCapture(e.pointerId); svg.classList.add("panning"); };
  svg.onpointermove = (e) => { if (!drag) return; st.x = e.clientX - drag.x; st.y = e.clientY - drag.y; apply(); };
  svg.onpointerup = () => { drag = null; svg.classList.remove("panning"); };
  host.querySelector('[data-g=fit]').onclick = fit;
  host.querySelector('[data-g=in]').onclick = () => zoom(1.2);
  host.querySelector('[data-g=out]').onclick = () => zoom(1 / 1.2);
  host.querySelector('[data-g=big]')?.addEventListener("click", () => openBigGraph());
  host.querySelector('[data-g=svg]').onclick = () => {
    const clone = svg.cloneNode(true);
    const css = getComputedStyle(document.documentElement);
    let s = new XMLSerializer().serializeToString(clone);
    s = s.replace(/var\((--[\w-]+)\)/g, (_, v) => css.getPropertyValue(v).trim() || "#888");
    s = s.replace("<svg ", `<svg viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" width="${maxX - minX}" height="${maxY - minY}" font-family="sans-serif" `).replace(/<g class="g-world" transform="[^"]*"/, '<g class="g-world"');
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([s], { type: "image/svg+xml" }));
    a.download = `${root.name || "relation"}-${mode}.svg`;
    a.click();
  };
  const redraw = () => { host._keepView = true; renderGraph(host, root, mode, { big }); if (!big) syncBig(); };
  host.querySelectorAll(".g-node").forEach((g) => {
    const o = nodes[+g.dataset.i];
    const n = o.n;
    g.onclick = async (e) => {
      if (n.more) { n.more._showAll = true; return redraw(); }
      if (n.path) showContextFor(n);
      host.querySelectorAll(".g-node").forEach((x) => x.classList.toggle("sel", x === g));
      if (e.target.closest(".g-tog") && !n.leaf) {
        n.open = !n.open;
        if (n.open && !n.children) n.children = await relationChildren(n, n.relMode || (mode === "both" ? (o.side < 0 ? "callers" : "callees") : mode));
        if (n.children && mode === "both") n.children.forEach((c) => (c.relMode ||= o.side < 0 ? "callers" : "callees"));
        redraw();
      }
    };
    g.ondblclick = () => n.path && goTo({ project: n.project, path: n.path, line: n.hitLine || n.line });
  });
}

// ------------------------------------------------- hook into the Relation window
function relationMode() { return $("#relationMode").value === "auto" ? (["class", "interface", "struct"].includes(S.relTree?.kind) ? "hierarchy" : "callees") : $("#relationMode").value; }
window.drawRelationGraph = function () {
  if (!S.relTree) return;
  if ($("#relationView").value === "vgraph") return window.drawRelationGraphVertical?.();
  renderGraph($("#relationBody"), S.relTree, relationMode());
  syncBig();
};
const _outline6 = window.drawRelationOutline;
window.drawRelationOutline = function () {
  const v = $("#relationView").value;
  if (v === "graph") return window.drawRelationGraph();
  return _outline6();
};

// ------------------------------------------------------------ big view
function openBigGraph() {
  let v = $("#graphBig");
  if (!v) {
    v = document.createElement("div");
    v.id = "graphBig";
    v.innerHTML = `<div class="pane-head"><span>Call Graph</span><span id="graphBigTitle" class="muted ellipsis"></span><span class="spacer"></span>
      <span class="muted">follows the Relation window settings</span><button class="mini" id="graphBigClose" title="Close (Esc)">✕</button></div><div id="graphBigBody" class="g-host"></div>`;
    $("#editorWrap").append(v);
    $("#graphBigClose").onclick = closeBigGraph;
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#graphBig").hidden) { e.preventDefault(); closeBigGraph(); } }, true);
  }
  v.hidden = false;
  syncBig(true);
}
function syncBig(force) {
  const v = $("#graphBig");
  if (!v || v.hidden || !S.relTree) return;
  $("#graphBigTitle").textContent = `${S.relTree.name} — ${$("#relationMode").selectedOptions[0].text}`;
  const body = $("#graphBigBody");
  if (force) body._view = null;
  else body._keepView = true;
  renderGraph(body, S.relTree, relationMode(), { big: true });
}
function closeBigGraph() { const v = $("#graphBig"); if (v) v.hidden = true; editor.focus(); }

// ------------------------------------------------------------------ hooks
function graphOptions() {
  const opts = [
    ["lines", "Lines", { spline: "Splined", orthogonal: "Orthogonal", direct: "Direct" }],
    ["shape", "Node shape", { rounded: "Rounded", square: "Square", pill: "Pill" }],
    ["spacing", "Spacing", { compact: "Compact", normal: "Normal", wide: "Wide" }],
    ["shadow", "Drop shadow", { true: "On", false: "Off" }],
  ];
  const items = opts.flatMap(([k, label, vals]) => Object.entries(vals).map(([v, name]) => ({ k, v, label, name })));
  palette({
    title: "Relation Graph Options", items,
    render: (o) => `<span class="mcheck">${String(S.graphStyle[o.k]) === o.v ? "●" : "○"}</span><span>${esc(o.label)}</span><span class="sub">${esc(o.name)}</span>`,
    filter: (o, q) => (o.label + o.name).toLowerCase().includes(q.toLowerCase()),
    pick: (o) => { S.graphStyle[o.k] = o.k === "shadow" ? o.v === "true" : o.v; store.set("graphStyle", S.graphStyle); applyGraphSpacing(); redrawRelation(); syncBig(true); graphOptions(); },
    hint: "Enter applies · Esc closes",
  });
}
const _w1 = window.extendCommands, _w3 = window.afterBoot;
window.extendCommands = function () {
  _w1?.();
  cmd("graphOptions", "Relation Graph Options…", graphOptions);
  cmd("callGraph", "Call Graph (large view)", () => { setLtab("relation"); if (!S.relTree) updateRelation(true); openBigGraph(); }, "Ctrl+Alt+G");
  cmd("relationGraph", "Relation: Toggle Graph/Outline", () => { $("#relationView").value = $("#relationView").value === "outline" ? "graph" : "outline"; store.set("relView", $("#relationView").value); redrawRelation(); });
  MENUS.View.push("callGraph");
};
window.afterBoot = async function () {
  await _w3?.();
  // Graph is the default view, Calls and Callers the default relation, two levels deep — SourceWeb's classic picture.
  const view = store.get("relView", "graph");
  $("#relationView").value = view;
  if (!store.get("relMode", null)) { $("#relationMode").value = "both"; store.set("relMode", "both"); }
  if (!store.get("relLevels", null)) { S.relLevels = 2; store.set("relLevels", 2); $("#relationLevels").value = "2"; }
  $("#relationView").addEventListener("change", () => store.set("relView", $("#relationView").value));
  $("#relationBody").classList.add("g-host");
  const head = $('[data-lpanel="relation"] .pane-head');
  const big = document.createElement("button");
  big.className = "mini"; big.textContent = "⤢"; big.title = "Large Call Graph view (Ctrl+Alt+G)";
  big.onclick = () => runCmd("callGraph");
  head.insertBefore(big, $("#relationLock"));
  new ResizeObserver(() => { const b = $("#relationBody"); if (S.relTree && $("#relationView").value === "graph" && b._view) { b._keepView = false; window.drawRelationGraph(); } }).observe($("#relationBody"));
};
