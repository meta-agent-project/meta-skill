// 도식 배치 — 가로 스크롤 없이 읽는 글 폭에 넣는다 (SKILL.md "배치 순서")
import { DIAGRAM_STYLE, DIAGRAM_VARS } from "./theme";

export type Vertex = { id: string; text: string; type?: string; labelType?: string; classes: string[]; styles: string[] };
export type Edge = { start: string; end: string; text: string; type: string; stroke: string; labelType?: string };
export type Chain = { order: Vertex[]; links: Edge[] };
/** 줄바꿈 배치로 그렸을 때 줄 사이 연결선을 그리는 데 쓰는 것 */
export type Wrap = { rid: string; rows: Vertex[][]; links: Edge[]; k: number };
/** 세 노드 순환에서 따로 그리는 돌아가는 선(마지막 → 처음) */
export type Cycle = { from: string; to: string; text: string };
/** 고른 그림 · 어떤 배치인지 · 원래 크기로 그렸을 때의 폭 */
export type Laid = { svg: string; kind: "base" | "compact" | "wrap" | "flip"; natural: number; wrap?: Wrap; cycle?: Cycle };
export type LayoutOptions = { stale?: () => boolean; noWrap?: boolean };

/** layoutDiagram이 쓰는 mermaid 부분 */
export interface MermaidLike {
  render(id: string, text: string): Promise<{ svg: string }>;
  mermaidAPI: { getDiagramFromText(text: string): Promise<{ db: unknown }> };
}

/** 줄여도 그림 안 글자 ≥ minFontSize */
export const MIN_SCALE = parseFloat(DIAGRAM_STYLE.minFontSize) / parseFloat(DIAGRAM_VARS.fontSize);

/** 간격 · 여백을 좁힌 설정 (배치 순서 2) */
export const COMPACT = [
  "  er: { nodeSpacing: 30, rankSpacing: 30, entityPadding: 8, minEntityWidth: 60 }",
  "  state: { nodeSpacing: 30, rankSpacing: 30 }",
];
/** ELK 간격은 mermaid 설정으로 못 바꾼다 — 이 표시를 실어 보내면 elk-adjust가 간격을 좁힌다 */
export const ELK_COMPACT = "meta-compact";

const FRONTMATTER = /^\s*---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n/;
const DIRECTIVE = /^[ \t]*%%\{[\s\S]*?\}%%[ \t]*(\r?\n|$)/gm;

/** AI가 쓴 frontmatter 설정 · init 줄을 지운다(모양은 하나). frontmatter의 제목만 남긴다 */
export function stripOverrides(code: string): { title: string | null; body: string } {
  const fm = FRONTMATTER.exec(code);
  const title = fm ? (/^title:[ \t]*(.+?)[ \t]*$/m.exec(fm[1])?.[1] ?? null) : null;
  return { title, body: (fm ? code.slice(fm[0].length) : code).replace(DIRECTIVE, "") };
}

const FLOW = /^\s*(flowchart|graph)\b/;
const isFlow = (body: string) => FLOW.test(body);

/** 흐름 도식을 무엇으로 배치하나: 되돌아가는 선이 없으면 직각(ELK), 있으면 dagre 곡선(ELK가 시작 도형을 잘못 고른다). 흐름 도식이 아니면 null */
export type Flow = "elk" | "dagre" | null;

/** 도식 글 앞에 붙이는 frontmatter — 제목 · 흐름 배치기 · 좁힌 간격 */
export function frame(title: string | null, body: string, flow: Flow, compact = false): string {
  const config: string[] = [];
  if (flow === "elk") config.push("  layout: elk", ...(compact ? [`  elk: { mergeEdges: ${ELK_COMPACT} }`] : []));
  if (flow === "dagre") config.push(`  flowchart: { curve: basis${compact ? ", nodeSpacing: 30, rankSpacing: 30" : ""} }`);
  if (compact && !flow) config.push(...COMPACT);
  if (!title && !config.length) return body;
  return ["---", ...(title ? [`title: ${title}`] : []), ...(config.length ? ["config:", ...config] : []), "---", body].join("\n");
}

const ER_OR_STATE = /^\s*(erDiagram|stateDiagram(-v2)?)\b[^\n]*/;

/** 방향을 적지 않은 ER · 상태 도식은 가로로 */
export function preferHorizontal(code: string): string {
  if (!ER_OR_STATE.test(code) || /^\s*direction\s/m.test(code)) return code;
  return code.replace(ER_OR_STATE, (head) => `${head}\n  direction LR`);
}

// 관계 줄: <엔티티> <기호>--<기호>(또는 ..) <엔티티> : <글자>
const ER_RELATION = /^(\s*\S+\s+\S*(?:--|\.\.)\S*\s+\S+\s*):.*$/gm;

/** ER 관계선 글자(쓴다 · 팔린다 등)는 그리지 않는다(사용자가 정함) */
export function dropRelationLabels(code: string): string {
  if (!/^\s*erDiagram\b/.test(code)) return code;
  return code.replace(ER_RELATION, '$1: ""');
}

/** 가로(LR · RL) → 세로(TB). 이미 세로면 그대로 */
export function flipVertical(code: string): string {
  return code.replace(/^(\s*(?:flowchart|graph)\s+)(LR|RL)\b/m, "$1TB").replace(/^(\s*direction\s+)(LR|RL)\b/m, "$1TB");
}

export function svgWidth(svg: string): number {
  return Number(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+)/.exec(svg)?.[1] ?? 0);
}

const SHAPE: Record<string, [string, string]> = {
  square: ["[", "]"],
  round: ["(", ")"],
  stadium: ["([", "])"],
  diamond: ["{", "}"],
  circle: ["((", "))"],
  subroutine: ["[[", "]]"],
  cylinder: ["[(", ")]"],
  hexagon: ["{{", "}}"],
  undefined: ["[", "]"],
};
const LINK: Record<string, string> = { normal: "-->", dotted: "-.->", thick: "==>" };

/** 갈래 · 합류 없이 한 줄로 이어지는 흐름(노드 4개 이상)이면 순서대로, 아니면 null */
export function chainOf(vertices: Vertex[], edges: Edge[], subgraphs: number): Chain | null {
  if (vertices.length < 4 || edges.length !== vertices.length - 1 || subgraphs > 0) return null;
  if (vertices.some((x) => !(String(x.type) in SHAPE) || x.classes.length > 0 || x.styles.length > 0)) return null;
  if (edges.some((x) => !(x.stroke in LINK) || x.type !== "arrow_point")) return null;
  const next = new Map(edges.map((x) => [x.start, x]));
  const ins = new Set(edges.map((x) => x.end));
  if (next.size !== edges.length || ins.size !== edges.length) return null;
  const byId = new Map(vertices.map((x) => [x.id, x]));
  const first = vertices.find((x) => !ins.has(x.id));
  if (!first) return null;
  const order = [first];
  const links: Edge[] = [];
  for (let link = next.get(first.id); link && order.length < vertices.length; link = next.get(link.end)) {
    const to = byId.get(link.end);
    if (!to) return null;
    links.push(link);
    order.push(to);
  }
  return order.length === vertices.length ? { order, links } : null;
}

/** 한 줄 흐름을 줄마다 k개씩 가로 묶음으로. 줄 사이는 보이지 않는 연결로 자리만 잡는다(선은 drawReturns) */
export function wrapSource({ order, links }: Chain, k: number): { src: string; rows: Vertex[][] } {
  // 해석된 글을 다시 mermaid 글로: 내부 표시 → #이름;, 따옴표 → #quot;, 굵게(markdown)가 아니면 백틱 → #96;, 빈 글은 공백
  const label = (text: string, markdown: boolean) => {
    const s = restoreEntities(text).replace(/"/g, "#quot;");
    if (markdown) return `"\`${s}\`"`;
    return `"${s.replace(/`/g, "#96;") || " "}"`;
  };
  const node = (x: Vertex) => {
    const [open, close] = SHAPE[String(x.type)];
    return `${x.id}${open}${label(x.text, x.labelType === "markdown")}${close}`;
  };
  const link = (x: Edge) => LINK[x.stroke] + (x.text ? `|${label(x.text, x.labelType === "markdown")}|` : "");
  const rows: Vertex[][] = [];
  for (let i = 0; i < order.length; i += k) rows.push(order.slice(i, i + k));
  const lines = ["flowchart TB"];
  rows.forEach((row, r) => {
    lines.push(`  subgraph wrapRow${r}[" "]`, "    direction LR");
    row.forEach((x, j) => lines.push(j === 0 ? `    ${node(x)}` : `    ${row[j - 1].id} ${link(links[r * k + j - 1])} ${node(x)}`));
    lines.push("  end");
  });
  for (let r = 0; r + 1 < rows.length; r++) lines.push(`  wrapRow${r} ~~~ wrapRow${r + 1}`);
  lines.push("  classDef wrapRow fill:none,stroke:none", `  class ${rows.map((_, r) => `wrapRow${r}`).join(",")} wrapRow`, "");
  return { src: lines.join("\n"), rows };
}

// mermaid가 해석하며 #quot; · #35; 를 바꿔 두는 내부 표시
const NAMED = /ﬂ°(\w+)¶ß/g;
const NUMBERED = /ﬂ°°(\d+)¶ß/g;
const restoreEntities = (s: string) => s.replace(NUMBERED, "#$1;").replace(NAMED, "#$1;");

/** 해석된 연결선 글자를 사람이 읽는 글로(직접 그리는 줄 사이 연결선 글자) */
export function displayText(text: string, labelType?: string): string {
  const html = text.replace(NUMBERED, "&#$1;").replace(NAMED, "&$1;");
  const t = document.createElement("textarea");
  t.innerHTML = html;
  return labelType === "markdown" ? t.value.replace(/\*\*|__|`/g, "").replace(/(^|[^*])\*(?!\*)/g, "$1") : t.value;
}

type FlowDb = { getVertices(): Map<string, Vertex> | Record<string, Vertex>; getEdges(): Edge[]; getSubGraphs(): unknown[] };
type FlowGraph = { vertices: Vertex[]; edges: Edge[]; subgraphs: number };

async function readFlow(m: MermaidLike, code: string): Promise<FlowGraph | null> {
  if (!isFlow(code)) return null;
  const db = (await m.mermaidAPI.getDiagramFromText(code)).db as FlowDb;
  const vs = db.getVertices();
  return { vertices: vs instanceof Map ? [...vs.values()] : Object.values(vs), edges: db.getEdges(), subgraphs: db.getSubGraphs().length };
}

/** 되돌아가는 선(순환)이 있는지 */
export function hasCycle(edges: Pick<Edge, "start" | "end">[]): boolean {
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.start, [...(next.get(e.start) ?? []), e.end]);
  const state = new Map<string, 1 | 2>(); // 1 = 지나는 중, 2 = 끝남
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    const found = (next.get(id) ?? []).some(visit);
    state.set(id, 2);
    return found;
  };
  return [...next.keys()].some(visit);
}

const ID = String.raw`[\p{L}_][\p{L}\p{N}_]*`;
const STATE_EDGE = new RegExp(String.raw`^\s*(${ID})\s+-->\s+(${ID})(?:\s*:\s*(.*?))?\s*$`, "u");
const FLOW_EDGE = new RegExp(String.raw`^\s*(${ID})(?:\[[^\]]*\]|\{[^}]*\})?\s*-->(?:\|([^|]*)\|)?\s*(${ID})(?:\[[^\]]*\]|\{[^}]*\})?\s*$`, "u");

/**
 * 세 노드 순환(A → B → C → A, 가로 흐름 · 가로 상태도)이면 돌아가는 선을 뺀 글과 그 선. 아니면 null.
 * 앞으로 가는 둘은 일자로 그리고, 돌아가는 선은 그린 뒤 아래로 돌려 더한다(drawCycleReturn)
 */
export function simpleCycle(code: string): (Cycle & { source: string }) | null {
  const state = /^\s*stateDiagram-v2\b/.test(code) && /^\s*direction LR\s*$/m.test(code);
  if (!state && !/^\s*flowchart LR\s*$/m.test(code)) return null;
  if (/\bsubgraph\b|\[\*\]|^\s*state\s+\S+\s*\{/m.test(code)) return null;
  const lines = code.split("\n");
  if (lines.filter((line) => line.includes("-->")).length !== 3) return null;
  const edges = lines.flatMap((line, index) => {
    const m = (state ? STATE_EDGE : FLOW_EDGE).exec(line);
    return m ? [{ from: m[1], to: m[state ? 2 : 3], text: (state ? m[3] : m[2]) ?? "", index }] : [];
  });
  if (edges.length !== 3) return null;
  const [first, second, back] = edges;
  if (first.to !== second.from || second.to !== back.from || back.to !== first.from) return null;
  if (new Set([first.from, first.to, second.to]).size !== 3) return null;
  return { source: lines.filter((_, i) => i !== back.index).join("\n"), from: back.from, to: back.to, text: back.text.replace(/^"(.*)"$/, "$1") };
}

/**
 * 읽는 글 폭(width)에 맞는 그림을 고른다: 원래대로 → 간격 좁혀 줄임(글자 ≥ 최소) → 한 줄 흐름은 줄바꿈 배치 → 세로.
 * 첫 그리기만 실패가 실패다. 뒤 단계가 실패하면 그때까지의 가장 좋은 그림을 쓴다.
 * 세 노드 순환은 돌아가는 선을 빼고 일자로 배치한다(줄바꿈 · 세로가 되면 순환 그대로 다시).
 * width가 0이면(폭을 모름) 원래대로 한 번만 그린다. stale()이 참이 되면(더 새 배치) 그리기 사이에서 멈춘다.
 * noWrap이면 줄바꿈 · 세 노드 순환 없이 그린다(그린 뒤 선을 더하지 못했을 때).
 */
export async function layoutDiagram(m: MermaidLike, code: string, width: number, id: string, opts: LayoutOptions = {}): Promise<Laid> {
  const { title, body: raw } = stripOverrides(code);
  const body = preferHorizontal(dropRelationLabels(raw));
  const cycle = opts.noWrap ? null : simpleCycle(body);
  if (cycle) {
    const laid = await layoutBody(m, title, cycle.source, width, id, opts);
    if (laid.kind === "base" || laid.kind === "compact") return { ...laid, cycle: { from: cycle.from, to: cycle.to, text: cycle.text } };
  }
  return layoutBody(m, title, body, width, cycle ? `${id}r` : id, opts);
}

async function layoutBody(m: MermaidLike, title: string | null, body: string, width: number, id: string, opts: LayoutOptions): Promise<Laid> {
  const check = () => {
    if (opts.stale?.()) throw new Error("stale");
  };
  const attempt = async (rid: string, text: string) => {
    try {
      return (await m.render(rid, text)).svg;
    } catch {
      return null;
    } finally {
      check();
    }
  };
  const graph = await readFlow(m, body).catch(() => null);
  check();
  const flow: Flow = !isFlow(body) ? null : graph && hasCycle(graph.edges) ? "dagre" : "elk";
  const first = (await m.render(`${id}a`, frame(title, body, flow))).svg;
  check();
  const natural = svgWidth(first);
  let best: Laid = { svg: first, kind: "base", natural };
  if (!width || natural <= width) return best;

  const compact = await attempt(`${id}b`, frame(title, body, flow, true));
  if (compact) {
    best = { svg: compact, kind: "compact", natural };
    if (width / svgWidth(compact) >= MIN_SCALE) return best;
  }
  const chain = !opts.noWrap && graph && /^\s*(flowchart|graph)\s+(LR|RL)\b/.test(body) ? chainOf(graph.vertices, graph.edges, graph.subgraphs) : null;
  for (let k = chain ? Math.max(2, Math.floor((width * chain.order.length) / svgWidth(compact ?? first))) : 0; chain && k >= 2; k--) {
    const { src, rows } = wrapSource(chain, k);
    const rid = `${id}w${k}`;
    const svg = await attempt(rid, frame(title, src, "elk"));
    if (!svg) break;
    if (svgWidth(svg) <= width || k === 2) return { svg, kind: "wrap", natural, wrap: { rid, rows, links: chain.links, k } };
  }
  const flipped = flipVertical(body);
  if (flipped !== body) {
    const svg = await attempt(`${id}c`, frame(title, flipped, flow));
    if (svg) return { svg, kind: "flip", natural };
  }
  return best;
}

/** ER에서 PK가 있는 줄의 이름 · 키 칸을 굵게(diagram-key) */
export function emphasizeKeys(root: Element): void {
  const y = (el: Element) => /,\s*([-\d.]+)/.exec(el.getAttribute("transform") ?? "")?.[1];
  for (const keys of root.querySelectorAll(".label.attribute-keys")) {
    if (!/\bPK\b/.test(keys.textContent ?? "")) continue;
    const row = y(keys);
    for (const cell of keys.parentElement?.querySelectorAll(".label.attribute-name, .label.attribute-keys") ?? []) {
      if (y(cell) === row) cell.classList.add("diagram-key");
    }
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** mermaid가 그린 도형(g.node, id = `<그림 id>-flowchart-<노드 id>-<번호>`)을 노드 id로 정확히 찾는다 */
export function nodeById(root: Element, rid: string, id: string): Element | null {
  const prefix = `${rid}-flowchart-${id}-`;
  return [...root.querySelectorAll("g.node")].find((g) => g.id.startsWith(prefix) && /^\d+$/.test(g.id.slice(prefix.length))) ?? null;
}

/** 줄바꿈 배치: 윗줄 마지막 도형 아래 → 다음 줄 첫 도형 위로 꺾인 연결선(+ 연결 글자)을 그린다. 그릴 수 없으면 던진다 */
export function drawReturns(svg: SVGSVGElement, { rid, rows, links, k }: Wrap): void {
  const inv = svg.getScreenCTM()?.inverse();
  if (!inv) throw new Error("좌표를 잴 수 없음");
  const box = (id: string) => {
    const r = nodeById(svg, rid, id)?.getBoundingClientRect();
    if (!r) throw new Error(`도형 ${id} 없음`);
    const a = new DOMPoint(r.left, r.top).matrixTransform(inv);
    const b = new DOMPoint(r.right, r.bottom).matrixTransform(inv);
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  };
  for (let r = 0; r + 1 < rows.length; r++) {
    const from = box(rows[r][rows[r].length - 1].id);
    const to = box(rows[r + 1][0].id);
    const bottom = Math.max(...rows[r].map((x) => box(x.id).y2));
    const top = Math.min(...rows[r + 1].map((x) => box(x.id).y1));
    const mid = (bottom + top) / 2;
    const fx = (from.x1 + from.x2) / 2;
    const tx = (to.x1 + to.x2) / 2;
    const link = links[(r + 1) * k - 1];
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", `M${fx},${from.y2} V${mid} H${tx} V${to.y1 - 1}`);
    path.setAttribute("class", "flowchart-link wrap-return");
    path.setAttribute("fill", "none");
    if (link.stroke === "dotted") path.setAttribute("stroke-dasharray", "3 3");
    path.setAttribute("marker-end", `url(#${rid}_flowchart-v2-pointEnd)`);
    svg.appendChild(path);
    if (link.text) {
      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("x", String((fx + tx) / 2));
      text.setAttribute("y", String(mid - 4));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("class", "wrap-label");
      text.textContent = displayText(link.text, link.labelType);
      svg.appendChild(text);
    }
  }
}

/** 세 노드 순환: 배치에서 뺀 돌아가는 선을 그림 아래로 돌려(마지막 도형 아래 → 처음 도형 아래) 더한다. 그릴 수 없으면 던진다 */
export function drawCycleReturn(svg: SVGSVGElement, cycle: Cycle): void {
  const inv = svg.getScreenCTM()?.inverse();
  if (!inv) throw new Error("좌표를 잴 수 없음");
  const node = (id: string) => {
    const match = new RegExp(`(?:^|-)${id}(?:-|$)`);
    const el = [...svg.querySelectorAll("g.node")].find((g) => match.test(g.id));
    if (!el) throw new Error(`도형 ${id} 없음`);
    const r = el.getBoundingClientRect();
    const a = new DOMPoint(r.left, r.top).matrixTransform(inv);
    const b = new DOMPoint(r.right, r.bottom).matrixTransform(inv);
    return { x: (a.x + b.x) / 2, bottom: b.y };
  };
  const from = node(cycle.from);
  const to = node(cycle.to);
  const marker = svg.querySelector("path[marker-end]")?.getAttribute("marker-end");
  if (!marker) throw new Error("화살표 정의 없음");
  const vb = svg.viewBox.baseVal;
  const bottom = vb.y + vb.height + 32;
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", `M${from.x},${from.bottom} V${bottom} H${to.x} V${to.bottom + 1}`);
  path.setAttribute("class", "flowchart-link transition wrap-return");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", DIAGRAM_VARS.lineColor);
  path.setAttribute("marker-end", marker);
  svg.appendChild(path);
  if (cycle.text) {
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", String((from.x + to.x) / 2));
    text.setAttribute("y", String(bottom - 5));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", "wrap-label");
    text.textContent = displayText(cycle.text);
    svg.appendChild(text);
  }
  const height = bottom + 8 - vb.y;
  svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.width} ${height}`);
  svg.setAttribute("height", String(height));
}
