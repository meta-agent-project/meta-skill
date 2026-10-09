// 도식 배치 — 가로 스크롤 없이 읽는 글 폭에 넣는다 (SKILL.md "배치 순서")
import { DIAGRAM_STYLE, DIAGRAM_VARS } from "./theme";

export type Vertex = { id: string; text: string; type?: string; labelType?: string; classes: string[]; styles: string[] };
export type Edge = { start: string; end: string; text: string; type: string; stroke: string; labelType?: string };
export type Chain = { order: Vertex[]; links: Edge[] };
/** 줄바꿈 배치로 그렸을 때 줄 사이 연결선을 그리는 데 쓰는 것 */
export type Wrap = { rid: string; rows: Vertex[][]; links: Edge[]; k: number };
/** 고른 그림 · 어떤 배치인지 · 원래 크기로 그렸을 때의 폭 */
export type Laid = { svg: string; kind: "base" | "compact" | "wrap" | "flip"; natural: number; wrap?: Wrap };
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
  "---",
  "config:",
  "  er: { nodeSpacing: 30, rankSpacing: 30, entityPadding: 8, minEntityWidth: 60 }",
  "  flowchart: { nodeSpacing: 30, rankSpacing: 30 }",
  "  state: { nodeSpacing: 30, rankSpacing: 30 }",
  "---",
  "",
].join("\n");

const FRONTMATTER = /^\s*---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n/;
const DIRECTIVE = /^[ \t]*%%\{[\s\S]*?\}%%[ \t]*(\r?\n|$)/gm;

/** AI가 쓴 frontmatter 설정 · init 줄을 지운다(모양은 하나). frontmatter의 제목만 남긴다 */
export function stripOverrides(code: string): { title: string | null; body: string } {
  const fm = FRONTMATTER.exec(code);
  const title = fm ? (/^title:[ \t]*(.+?)[ \t]*$/m.exec(fm[1])?.[1] ?? null) : null;
  return { title, body: (fm ? code.slice(fm[0].length) : code).replace(DIRECTIVE, "") };
}

/** 흐름 도식만 직각 배치(ELK) — 흐름 도식 글 앞에 붙이는 설정. 전역으로 켜면 ER도 ELK로 바뀐다 */
export const ELK = ["---", "config:", "  layout: elk", "---", ""].join("\n");
const FLOW = /^\s*(flowchart|graph)\b/;
const isFlow = (body: string) => FLOW.test(body);

const withTitle = (title: string | null, body: string) => {
  if (isFlow(body)) return (title ? ELK.replace("---\nconfig:", `---\ntitle: ${title}\nconfig:`) : ELK) + body;
  return title ? `---\ntitle: ${title}\n---\n${body}` : body;
};
const compactOf = (title: string | null, body: string) => (title ? COMPACT.replace("---\nconfig:", `---\ntitle: ${title}\nconfig:`) : COMPACT) + body;

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

type FlowDb ={ getVertices(): Map<string, Vertex> | Record<string, Vertex>; getEdges(): Edge[]; getSubGraphs(): unknown[] };

async function readChain(m: MermaidLike, code: string): Promise<Chain | null> {
  if (!/^\s*(flowchart|graph)\s+(LR|RL)\b/.test(code)) return null;
  const db = (await m.mermaidAPI.getDiagramFromText(code)).db as FlowDb;
  const vs = db.getVertices();
  return chainOf(vs instanceof Map ? [...vs.values()] : Object.values(vs), db.getEdges(), db.getSubGraphs().length);
}

/**
 * 읽는 글 폭(width)에 맞는 그림을 고른다: 원래대로 → 간격 좁혀 줄임(글자 ≥ 최소) → 한 줄 흐름은 줄바꿈 배치 → 세로.
 * 첫 그리기만 실패가 실패다. 뒤 단계가 실패하면 그때까지의 가장 좋은 그림을 쓴다.
 * width가 0이면(폭을 모름) 원래대로 한 번만 그린다. stale()이 참이 되면(더 새 배치) 그리기 사이에서 멈춘다.
 */
export async function layoutDiagram(m: MermaidLike, code: string, width: number, id: string, opts: LayoutOptions = {}): Promise<Laid> {
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
  const { title, body: raw } = stripOverrides(code);
  const body = preferHorizontal(dropRelationLabels(raw));
  const first = (await m.render(`${id}a`, withTitle(title, body))).svg;
  check();
  const natural = svgWidth(first);
  let best: Laid = { svg: first, kind: "base", natural };
  if (!width || natural <= width) return best;

  // 흐름 도식은 ELK 간격이 고정이라 좁혀도 같다 — 건너뛴다
  const compact = isFlow(body) ? null : await attempt(`${id}b`, compactOf(title, body));
  if (compact) {
    best = { svg: compact, kind: "compact", natural };
    if (width / svgWidth(compact) >= MIN_SCALE) return best;
  }
  if (!opts.noWrap) {
    const chain = await readChain(m, body).catch(() => null);
    check();
    for (let k = chain ? Math.max(2, Math.floor((width * chain.order.length) / svgWidth(compact ?? first))) : 0; chain && k >= 2; k--) {
      const { src, rows } = wrapSource(chain, k);
      const rid = `${id}w${k}`;
      const svg = await attempt(rid, withTitle(title, src));
      if (!svg) break;
      if (svgWidth(svg) <= width || k === 2) return { svg, kind: "wrap", natural, wrap: { rid, rows, links: chain.links, k } };
    }
  }
  const flipped = flipVertical(body);
  if (flipped !== body) {
    const svg = await attempt(`${id}c`, withTitle(title, flipped));
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
