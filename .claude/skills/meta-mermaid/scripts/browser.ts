// meta-mermaid 브라우저 쪽 — render.mjs가 esbuild로 묶어 페이지에 넣는다(scripts/.build/browser.js).
// 배치 · 테마 · 직각 배치 고침은 웹 화면용 assets/web/ 를 그대로 쓴다(따로 옮겨 쓰지 않음).
import mermaid from "mermaid";
import elkLayouts from "@mermaid-js/layout-elk";
import ELK from "elkjs/lib/elk.bundled.js";
import { installElkAdjust } from "../assets/web/elk-adjust";
import { drawCycleReturn, drawReturns, emphasizeKeys, layoutDiagram, type Laid } from "../assets/web/layout";
import { DIAGRAM_CONFIG, DIAGRAM_VARS } from "../assets/web/theme";

// assets/web/Diagram.tsx load()와 같은 순서: 직각 배치 고침 → ELK 등록 → 설정
installElkAdjust(ELK as never);
mermaid.registerLayoutLoaders(elkLayouts);
mermaid.initialize(DIAGRAM_CONFIG);

/** 그림을 넣고 PK 줄 굵게 · 줄바꿈 연결선 · 순환의 돌아가는 선(Diagram.tsx와 같음). 선을 못 그리면 던진다 */
function put(host: HTMLElement, laid: Laid): SVGSVGElement {
  host.innerHTML = laid.svg;
  emphasizeKeys(host);
  const svg = host.querySelector("svg") as SVGSVGElement;
  if (laid.wrap) drawReturns(svg, laid.wrap);
  if (laid.cycle) drawCycleReturn(svg, laid.cycle);
  return svg;
}

/** 도식 하나를 host(폭 = 읽는 글 · 판면 폭) 안에 그린다. 결과: 배치 · 비율 · 글자 크기 · 들어갈 크기 */
async function draw(host: HTMLElement, code: string, id: string) {
  const width = Math.floor(host.getBoundingClientRect().width);
  let laid = await layoutDiagram(mermaid, code, width, id);
  let svg: SVGSVGElement;
  try {
    svg = put(host, laid);
  } catch {
    // 더할 선을 못 그리면 줄바꿈 · 순환 보정 없이 다시(Diagram.tsx와 같음)
    laid = await layoutDiagram(mermaid, code, width, `${id}n`, { noWrap: true });
    svg = put(host, laid);
  }
  const vb = svg.viewBox.baseVal;
  const scale = Math.min(1, width / vb.width);
  return { kind: laid.kind, scale, fontPx: parseFloat(DIAGRAM_VARS.fontSize) * scale, width: vb.width * scale, height: vb.height * scale };
}

(window as unknown as { metaMermaid: unknown }).metaMermaid = { draw };
