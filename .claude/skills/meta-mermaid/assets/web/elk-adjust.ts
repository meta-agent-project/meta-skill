// 흐름 도식 직각 배치 고침 — 마름모는 꼭짓점에서만, 마주 보는 도형 사이 선은 꺾임 0
// elkjs layout()을 감싸 배치 전에 마름모 꼭짓점 포트를 붙이고, 배치 뒤 선 끝을 노드로 되돌리고 선을 편다.

type Pt = { x: number; y: number };
export type ElkPort = { id: string; x: number; y: number; width: number; height: number; layoutOptions?: Record<string, string> };
export type ElkLabel = { id?: string; text?: string; x?: number; y?: number; width?: number; height?: number };
export type ElkSection = { id?: string; startPoint: Pt; endPoint: Pt; bendPoints?: Pt[] };
export type ElkEdge = { id: string; sources: string[]; targets: string[]; sections?: ElkSection[]; labels?: ElkLabel[]; container?: string };
export type ElkGraph = {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  shape?: string;
  layoutOptions?: Record<string, string>;
  children?: ElkGraph[];
  ports?: ElkPort[];
  edges?: ElkEdge[];
};

type Side = "N" | "S" | "E" | "W";
const SIDE_NAME: Record<Side, string> = { N: "NORTH", S: "SOUTH", E: "EAST", W: "WEST" };
/** 흐름 방향마다 [들어오는 꼭짓점, 나가는 꼭짓점 차례(흐름 방향 → 옆 → 옆)] */
const ORDER: Record<string, [Side, Side[]]> = {
  DOWN: ["N", ["S", "E", "W"]],
  UP: ["S", ["N", "E", "W"]],
  RIGHT: ["W", ["E", "S", "N"]],
  LEFT: ["E", ["W", "S", "N"]],
};
const PORT = "__vertex_";
const isDiamond = (n: ElkGraph) => n.shape === "diamond";

/** 모든 노드(루트 빼고)와 부모 · 절대 위치 */
function index(g: ElkGraph) {
  const nodes = new Map<string, { node: ElkGraph; parent: ElkGraph; abs: Pt; dir: string }>();
  const walk = (n: ElkGraph, abs: Pt, dir: string) => {
    for (const c of n.children ?? []) {
      const a = { x: abs.x + (c.x ?? 0), y: abs.y + (c.y ?? 0) };
      const d = c.layoutOptions?.["elk.direction"] ?? dir;
      nodes.set(c.id, { node: c, parent: n, abs: a, dir });
      walk(c, a, d);
    }
  };
  walk(g, { x: 0, y: 0 }, g.layoutOptions?.["elk.direction"] ?? "DOWN");
  return nodes;
}

function allEdges(g: ElkGraph): { edge: ElkEdge; owner: ElkGraph }[] {
  const out: { edge: ElkEdge; owner: ElkGraph }[] = [];
  const walk = (n: ElkGraph) => {
    for (const e of n.edges ?? []) out.push({ edge: e, owner: n });
    for (const c of n.children ?? []) walk(c);
  };
  walk(g);
  return out;
}

/** 배치 전: 마름모에 꼭짓점 포트 넷을 붙이고 선 끝을 포트로 (들어옴 = 흐름 반대쪽, 나감 = 흐름 방향 → 옆 → 옆 → 다시 흐름 방향) */
export function addVertexPorts(g: ElkGraph): void {
  const nodes = index(g);
  const used = new Map<string, number>();
  for (const { edge } of allEdges(g)) {
    const from = nodes.get(edge.sources[0]);
    const to = nodes.get(edge.targets[0]);
    if (from && isDiamond(from.node)) {
      const out = ORDER[from.dir]?.[1] ?? ORDER.DOWN[1];
      const k = used.get(from.node.id) ?? 0;
      used.set(from.node.id, k + 1);
      edge.sources = [portOf(from.node, k < out.length ? out[k] : out[0])];
    }
    if (to && isDiamond(to.node)) edge.targets = [portOf(to.node, (ORDER[to.dir] ?? ORDER.DOWN)[0])];
  }
}

function portOf(n: ElkGraph, side: Side): string {
  if (!n.ports?.length) {
    const w = n.width ?? 0;
    const h = n.height ?? 0;
    const at: Record<Side, Pt> = { N: { x: w / 2, y: 0 }, S: { x: w / 2, y: h }, E: { x: w, y: h / 2 }, W: { x: 0, y: h / 2 } };
    n.ports = (Object.keys(at) as Side[]).map((s) => ({ id: `${n.id}${PORT}${s}`, ...at[s], width: 0, height: 0, layoutOptions: { "elk.port.side": SIDE_NAME[s] } }));
    n.layoutOptions = { ...n.layoutOptions, "elk.portConstraints": "FIXED_POS" };
  }
  return `${n.id}${PORT}${side}`;
}

/** 배치 뒤: 포트로 바꾼 선 끝을 노드 id로 되돌린다(layout-elk는 노드 id로 찾는다) */
export function restoreEnds(g: ElkGraph): void {
  const back = (id: string) => (id.includes(PORT) ? id.slice(0, id.indexOf(PORT)) : id);
  for (const { edge } of allEdges(g)) {
    edge.sources = edge.sources.map(back);
    edge.targets = edge.targets.map(back);
  }
}

type Rect = { x0: number; y0: number; x1: number; y1: number; diamond: boolean };
/** 짧은 계단(12px 미만): 같은 방향 두 마디 사이 */
const JOG = 12;
/** 같은 두 노드 사이 선끼리 최소 간격 · 글자와 옆 선 사이 여유 */
const MIN_GAP = 8;
const LABEL_GAP = 4;
/** 같은 두 노드 사이에서 이미 쓴 선 좌표와 그 선 글자 두께(선과 수직 방향) */
type Slot = { c: number; t: number };
const need = (a: number, b: number) => Math.max(MIN_GAP, (a + b) / 2 + (a || b ? LABEL_GAP : 0));

/**
 * 배치 뒤: 마주 보는 두 노드(선과 수직으로 범위가 겹침) 사이 선을 꺾임 없이 펴고, 펴지 못한 선은 끝 쪽 짧은 계단을 없앤다.
 * 같은 두 노드 사이 글자 달린 선이 여럿이라 글자가 겹친 구간에 다 들어가지 않으면 그 선들은 펴지 않는다(배치기의 글자 자리 그대로)
 */
export function straighten(g: ElkGraph): ElkGraph {
  const nodes = index(g);
  const rect = (id: string): Rect => {
    const n = nodes.get(id)!;
    return { x0: n.abs.x, y0: n.abs.y, x1: n.abs.x + (n.node.width ?? 0), y1: n.abs.y + (n.node.height ?? 0), diamond: isDiamond(n.node) };
  };
  /** 가로 · 세로 선분 p–q가 a · b 말고 다른 노드를 지나는지 */
  const blocked = (p: Pt, q: Pt, a: string, b: string) =>
    [...nodes.entries()].some(([id, n]) => {
      if (id === a || id === b || n.node.children?.length) return false;
      const r = rect(id);
      return r.x0 < Math.max(p.x, q.x) && r.x1 > Math.min(p.x, q.x) && r.y0 < Math.max(p.y, q.y) && r.y1 > Math.min(p.y, q.y);
    });
  type Item = { edge: ElkEdge; s: ElkSection; off: Pt; a: string; b: string };
  const pairs = new Map<string, Item[]>();
  for (const { edge, owner } of allEdges(g)) {
    const s = edge.sections?.[0];
    const [a, b] = [edge.sources[0], edge.targets[0]];
    if (!s || edge.sections!.length > 1 || !nodes.has(a) || !nodes.has(b) || a === b) continue;
    const frameId = edge.container ?? owner.id;
    const off = frameId === g.id ? { x: 0, y: 0 } : (nodes.get(frameId)?.abs ?? { x: 0, y: 0 });
    const key = [a, b].sort().join("|");
    pairs.set(key, [...(pairs.get(key) ?? []), { edge, s, off, a, b }]);
  }
  for (const items of pairs.values()) {
    const taken: Slot[] = [];
    const lines = items.map(({ edge, s, off, a, b }) => {
      const line = facingLine(s, off, rect(a), rect(b), edge.labels?.[0], taken);
      return line && !blocked(line[0], line[1], a, b) ? line : null;
    });
    // 글자 달린 선이 하나라도 못 펴면 쌍 전체를 그대로 — 편 선이 배치기의 글자 자리를 지나지 않게
    const keep = lines.some((l) => !l) && items.some(({ edge }) => (edge.labels?.[0]?.width ?? 0) > 0 && (edge.labels?.[0]?.height ?? 0) > 0);
    items.forEach(({ edge, s, off, a, b }, i) => {
      const line = keep ? null : lines[i];
      if (!line) return removeEndJogs(s, off, rect(a), rect(b), (p, q) => blocked(p, q, a, b));
      const [ns, ne] = line;
      s.startPoint = { x: ns.x - off.x, y: ns.y - off.y };
      s.endPoint = { x: ne.x - off.x, y: ne.y - off.y };
      s.bendPoints = [];
      const label = edge.labels?.[0];
      if (label && label.width !== undefined && label.height !== undefined) {
        label.x = (ns.x + ne.x) / 2 - off.x - label.width / 2;
        label.y = (ns.y + ne.y) / 2 - off.y - label.height / 2;
      }
    });
  }
  return g;
}

/** 마주 보는 두 노드 사이 한 줄 직선(절대 좌표). 마주 보지 않거나 쓸 좌표가 없으면 null */
function facingLine(s: ElkSection, off: Pt, ra: Rect, rb: Rect, label: ElkLabel | undefined, taken: Slot[]): [Pt, Pt] | null {
  const side = ra.x1 <= rb.x0 || rb.x1 <= ra.x0;
  const stack = ra.y1 <= rb.y0 || rb.y1 <= ra.y0;
  // 가로로 마주 봄: y를 하나로. 세로로 마주 봄: x를 하나로
  const axis = side && Math.min(ra.y1, rb.y1) - Math.max(ra.y0, rb.y0) > 1 ? "y" : stack && Math.min(ra.x1, rb.x1) - Math.max(ra.x0, rb.x0) > 1 ? "x" : null;
  if (!axis) return null;
  const lo = axis === "y" ? Math.max(ra.y0, rb.y0) : Math.max(ra.x0, rb.x0);
  const hi = axis === "y" ? Math.min(ra.y1, rb.y1) : Math.min(ra.x1, rb.x1);
  const inside = (c: number) => c > lo && c < hi;
  const start = { x: s.startPoint.x + off.x, y: s.startPoint.y + off.y };
  const end = { x: s.endPoint.x + off.x, y: s.endPoint.y + off.y };
  const center = (r: Rect) => (axis === "y" ? (r.y0 + r.y1) / 2 : (r.x0 + r.x1) / 2);
  const diamonds = [ra, rb].filter((r) => r.diamond);
  let c: number | undefined;
  if (diamonds.length) {
    // 마름모가 끼면 꼭짓점(마름모 중심)만 — 둘 다 마름모면 중심이 같을 때만
    const m = center(diamonds[0]);
    c = diamonds.every((r) => Math.abs(center(r) - m) < 0.5) && inside(m) ? m : undefined;
  } else {
    // 원래 시작점 → 끝점 → 겹친 구간 가운데. 같은 두 노드 사이 선이 이미 쓴 좌표는 비켜서(그 선 · 이 선 글자 두께만큼)
    const first = [start[axis], end[axis], (lo + hi) / 2].find(inside);
    const t = (axis === "y" ? label?.height : label?.width) ?? 0;
    const ok = (c: number) => inside(c) && taken.every((u) => Math.abs(u.c - c) >= need(u.t, t));
    const beside = (f: number) => taken.flatMap((u) => [u.c + need(u.t, t), u.c - need(u.t, t)]).sort((p, q) => Math.abs(p - f) - Math.abs(q - f));
    c = first === undefined ? undefined : [...[0, 10, -10, 20, -20].map((d) => first + d), ...beside(first)].find(ok);
    if (c !== undefined) taken.push({ c, t });
  }
  if (c === undefined) return null;
  return axis === "y" ? [{ x: start.x, y: c }, { x: end.x, y: c }] : [{ x: c, y: start.y }, { x: c, y: end.y }];
}

/**
 * 끝 쪽 짧은 계단 없애기: 도형에서 나오자마자(들어가기 직전) 12px 미만 비켜 서는 마디가 있으면
 * 끝점을 도형 변 안에서 옮겨 다음 마디와 한 줄로. 마름모(꼭짓점)는 옮기지 않고, 옮긴 마디가 다른 노드를 지나면 그대로
 */
function removeEndJogs(s: ElkSection, off: Pt, from: Rect, to: Rect, blocked: (p: Pt, q: Pt) => boolean): void {
  const abs = (p: Pt) => ({ x: p.x + off.x, y: p.y + off.y });
  const fix = (pts: Pt[], r: Rect): Pt[] => {
    if (pts.length < 4 || r.diamond) return pts;
    const [p0, p1, p2, p3] = pts;
    if (Math.hypot(p2.x - p1.x, p2.y - p1.y) >= JOG) return pts;
    const vert = (u: Pt, v: Pt) => Math.abs(u.x - v.x) <= 0.5;
    const horiz = (u: Pt, v: Pt) => Math.abs(u.y - v.y) <= 0.5;
    const moved = vert(p0, p1) && vert(p2, p3) && p2.x > r.x0 && p2.x < r.x1 ? { x: p2.x, y: p0.y } : horiz(p0, p1) && horiz(p2, p3) && p2.y > r.y0 && p2.y < r.y1 ? { x: p0.x, y: p2.y } : null;
    return moved && !blocked(moved, p3) ? [moved, ...pts.slice(3)] : pts;
  };
  let poly = fix([s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map(abs), from);
  poly = fix([...poly].reverse(), to).reverse();
  const rel = (p: Pt) => ({ x: p.x - off.x, y: p.y - off.y });
  s.startPoint = rel(poly[0]);
  s.endPoint = rel(poly[poly.length - 1]);
  s.bendPoints = poly.slice(1, -1).map(rel);
}

/** layout.ts ELK_COMPACT — mergeEdges 자리에 실려 온 좁힘 표시 */
const COMPACT_MARK = "compact-spacing";
const MERGE_EDGES = "elk.layered.mergeEdges";
/** 좁힐 때 ELK 간격 기준값(layout-elk 기본 40) */
const COMPACT_SPACING = "20";

/** 좁힘 표시가 있으면 지우고(mergeEdges는 기본 false로) 간격 기준값을 줄인다 */
export function applyCompact(g: ElkGraph): void {
  const o = g.layoutOptions;
  if (!o || o[MERGE_EDGES] !== COMPACT_MARK) return;
  o[MERGE_EDGES] = "false";
  o["spacing.baseValue"] = COMPACT_SPACING;
}

/** layout(g)를 감싼다: 배치 전 좁힘 · 마름모 꼭짓점 포트, 배치 뒤 선 끝 되돌리기 · 선 펴기 */
export function withAdjust(layout: (g: ElkGraph) => Promise<ElkGraph>): (g: ElkGraph) => Promise<ElkGraph> {
  return async (g) => {
    applyCompact(g);
    addVertexPorts(g);
    const out = await layout(g);
    restoreEnds(out);
    return straighten(out);
  };
}

type ElkClass = { prototype: { layout: (g: ElkGraph, ...rest: unknown[]) => Promise<ElkGraph> } };
const INSTALLED = Symbol.for("mermaid-diagram.elk-adjust");
/** elkjs ELK.prototype.layout을 한 번 감싼다(layout-elk가 그릴 때마다 new ELK()를 쓰므로) */
export function installElkAdjust(ELK: ElkClass): void {
  const proto = ELK.prototype as ElkClass["prototype"] & { [INSTALLED]?: boolean };
  if (proto[INSTALLED]) return;
  const original = proto.layout;
  proto.layout = function (this: unknown, g: ElkGraph, ...rest: unknown[]) {
    return withAdjust((x) => original.call(this, x, ...rest))(g);
  };
  proto[INSTALLED] = true;
}
