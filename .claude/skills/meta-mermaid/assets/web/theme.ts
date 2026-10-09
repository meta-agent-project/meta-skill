import type { MermaidConfig } from "mermaid";

/** 도식 값 — references/design.md "값과 CSS 토큰"의 토큰을 푼 값 */
export const DIAGRAM_VARS = {
  fontFamily: "'Cascadia Mono','Consolas','Pretendard',monospace",
  fontSize: "14px",
  background: "#ffffff",
  primaryColor: "#ffffff",
  primaryTextColor: "#111111",
  primaryBorderColor: "#111111",
  secondaryColor: "#ffffff",
  tertiaryColor: "#ffffff",
  lineColor: "#111111",
  textColor: "#111111",
  edgeLabelBackground: "#ffffff",
  attributeBackgroundColorOdd: "#ffffff",
  attributeBackgroundColorEven: "#ffffff",
  noteBkgColor: "#ffffff",
  noteBorderColor: "#111111",
  noteTextColor: "#111111",
  git0: "#111111",
  git1: "#555555",
  git2: "#8a8a8a",
  git3: "#c4c4c4",
  gitBranchLabel0: "#ffffff",
  gitBranchLabel1: "#ffffff",
  gitBranchLabel2: "#ffffff",
  gitBranchLabel3: "#111111",
} as const;

/** mermaid 변수에 없는 값 — 선 두께 · 모서리 · 굵은 글자는 themeCSS로, 최소 글자는 배치 규칙(layout.ts)이 쓴다 */
export const DIAGRAM_STYLE = { strokeWidth: "1px", radius: "4px", boldWeight: "700", minFontSize: "11px" } as const;

const { strokeWidth: sw, radius: r, boldWeight: bold } = DIAGRAM_STYLE;
const THEME_CSS = [
  `.node rect,.node polygon,.node circle,.node path,.outer-path,.divider,.actor,.note,.labelBox,.statediagram-state rect{stroke-width:${sw}}`,
  `.node rect,.actor,.note,.statediagram-state rect{rx:${r};ry:${r}}`,
  `.relationshipLine,.flowchart-link,.messageLine0,.messageLine1,.transition{stroke-width:${sw}}`,
  // 제목(ER 엔티티 · 순서도 참여자 · 묶음 제목)과 중요한 글자(ER PK 줄 · **굵게**)
  `.label.name .nodeLabel,.cluster-label .nodeLabel,text.actor>tspan{font-weight:${bold}}`,
  `.diagram-key .nodeLabel,.nodeLabel strong{font-weight:${bold}}`,
  // 줄바꿈 배치에서 직접 그린 연결선의 글자
  `.wrap-label{fill:${DIAGRAM_VARS.textColor};font-size:${DIAGRAM_VARS.fontSize};font-family:${DIAGRAM_VARS.fontFamily}}`,
].join("\n");

const natural = { useMaxWidth: false }; // 원래 크기로 그리고, 줄이기는 읽는 글 폭이 한다

/** mermaid.initialize에 넘기는 설정 — 모든 도식이 이 하나를 쓴다 */
export const DIAGRAM_CONFIG: MermaidConfig = {
  // 도식 글 안 init · frontmatter가 바꿀 수 없는 설정 — 모양은 하나, 안전 모드 유지
  secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "theme", "themeVariables", "themeCSS", "fontFamily", "altFontFamily", "look", "darkMode", "handDrawnSeed"],
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
  theme: "base",
  fontFamily: DIAGRAM_VARS.fontFamily,
  themeVariables: DIAGRAM_VARS,
  themeCSS: THEME_CSS,
  // 흐름 도식은 직각 배치(ELK — layout.ts가 흐름 도식 글에만 layout: elk). 선은 직선으로 꺾고, 갈래가 있어도 주 흐름은 한 줄
  flowchart: { ...natural, curve: "linear" },
  elk: { nodePlacementStrategy: "NETWORK_SIMPLEX" },
  sequence: natural,
  er: natural,
  state: natural,
  class: natural,
  gitGraph: natural,
};
