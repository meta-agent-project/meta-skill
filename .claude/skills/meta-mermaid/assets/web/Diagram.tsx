import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { drawReturns, emphasizeKeys, layoutDiagram, type Laid } from "./layout";
import { installElkAdjust } from "./elk-adjust";
import { DIAGRAM_CONFIG } from "./theme";

type Mermaid = (typeof import("mermaid"))["default"];
let loading: Promise<Mermaid> | null = null;
/** mermaid는 처음 도식이 나올 때 한 번만 불러 설정한다(첫 화면 번들에서 뺌). 흐름 도식의 직각 배치(ELK)와 그 고침(마름모 꼭짓점 · 선 펴기)도 이때 */
function load(): Promise<Mermaid> {
  loading ??= Promise.all([import("mermaid"), import("@mermaid-js/layout-elk"), import("elkjs/lib/elk.bundled.js")]).then(([{ default: m }, { default: elk }, { default: ELK }]) => {
    installElkAdjust(ELK as never);
    m.registerLayoutLoaders(elk);
    m.initialize(DIAGRAM_CONFIG);
    return m;
  });
  return loading;
}
let seq = 0;
/** 폭이 잇달아 바뀌면(창 크기 조절) 멈춘 뒤 한 번만 다시 배치한다 */
const SETTLE_MS = 150;

/** Mermaid 글을 그림으로. 그리는 중 · 못 그리면 원래 글(fallback) */
export function Diagram({ code, fallback }: { code: string; fallback: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [noWrap, setNoWrap] = useState(false);
  const [laid, setLaid] = useState<Laid | null>(null);
  const [failed, setFailed] = useState(false);
  // 지난 배치 — 다시 그릴 필요가 없는지 본다
  const last = useRef<{ code: string; noWrap: boolean; laid: Laid | null; failed: boolean } | null>(null);

  // 읽는 글 폭 — 창 폭이 바뀌면 다시 배치한다. 첫 폭은 바로, 그 뒤 변화는 멈춘 뒤에
  useEffect(() => {
    const host = box.current?.parentElement;
    if (!host) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      clearTimeout(timer);
      if (first) {
        first = false;
        setWidth(w);
      } else timer = setTimeout(() => setWidth(w), SETTLE_MS);
    });
    ro.observe(host);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    if (width === null) return;
    const prev = last.current;
    if (prev && prev.code === code && prev.noWrap === noWrap) {
      if (prev.failed) return; // 글 자체가 틀림 — 폭이 바뀌어도 같다
      if (prev.laid?.kind === "base" && width >= prev.laid.natural) return; // 원래 크기로 이미 들어감
    }
    let alive = true;
    void (async () => {
      try {
        const m = await load();
        await document.fonts?.ready; // 글꼴이 늦으면 라벨 상자 크기를 잘못 잰다
        const out = await layoutDiagram(m, code, width, `diagram-${++seq}`, { stale: () => !alive, noWrap });
        if (!alive) return;
        last.current = { code, noWrap, laid: out, failed: false };
        setFailed(false);
        setLaid(out);
      } catch {
        if (!alive) return;
        last.current = { code, noWrap, laid: null, failed: true };
        setLaid(null);
        setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, width, noWrap]);

  // 그림을 넣고 PK 줄 굵게 · 줄바꿈 연결선은 그려진 뒤에. 연결선을 못 그리면 줄바꿈 없이 다시 배치(세로)
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !laid) return;
    el.innerHTML = laid.svg;
    emphasizeKeys(el);
    const svg = el.querySelector("svg");
    if (!laid.wrap || !svg) return;
    try {
      drawReturns(svg, laid.wrap);
    } catch {
      setNoWrap(true);
    }
  }, [laid]);

  return (
    <>
      <div ref={box} className="mermaid-diagram" role={laid ? "img" : undefined} aria-label={laid ? "도식" : undefined} hidden={!laid} />
      {!laid && fallback}
      {failed && <p className="mermaid-diagram-error">도식을 그리지 못했습니다</p>}
    </>
  );
}
