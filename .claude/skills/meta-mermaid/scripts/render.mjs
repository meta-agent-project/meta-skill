#!/usr/bin/env node
// meta-mermaid 렌더러 — Mermaid를 정해진 디자인 · 배치 규칙으로 PNG/SVG로 그린다.
//
// 쓰는 법:
//   node render.mjs <원고.md | 도식.mmd> [--width 760] [--out <폴더>] [--format png|svg|both|none] [--scale 2] [--md-out <파일.md>]
//   - .md  : 안의 ```mermaid 블록마다 그림 파일을 만들고, --md-out을 주면 블록을 그림 링크로 바꾼 MD를 쓴다
//   - .mmd : 도식 하나
//   --width : 그림이 들어갈 폭(px). 웹 읽는 글 760(기본), 책이면 판면 폭
//   --format none : 그림 파일 없이 재기만 한다(시나리오로 나눌지 판단할 때)
// 결과(JSON 한 줄씩): 도식 번호 · 배치(base|compact|wrap|flip) · 비율 · 글자 px · 들어갈 폭 · 높이 · 파일 · 실패 이유
import { mkdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const require = createRequire(join(root, "package.json"));

function need(pkg) {
  try {
    return require.resolve(pkg);
  } catch {
    console.error(`[meta-mermaid] '${pkg}'가 없습니다. 한 번만 설치하세요:\n  cd "${root}" && npm install && npx playwright install chromium`);
    process.exit(2);
  }
}

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const input = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!input) {
  console.error("쓰는 법: node render.mjs <원고.md | 도식.mmd> [--width 760] [--out 폴더] [--format png|svg|both|none] [--scale 2] [--md-out 파일.md]");
  process.exit(1);
}

// 기본 폭 = 웹 읽는 글 폭(--content-w)
const width = Number(opt("width", "760"));
const format = opt("format", "png");
const scale = Number(opt("scale", "2"));
const src = readFileSync(input, "utf8");
const isMd = /\.(md|markdown)$/i.test(input);
const base = basename(input, extname(input));
const outDir = resolve(opt("out", join(dirname(input), `${base}-diagrams`)));
if (format !== "none") mkdirSync(outDir, { recursive: true });

// 도식 목록
const BLOCK = /^```mermaid[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;
const blocks = isMd ? [...src.matchAll(BLOCK)].map((m) => ({ whole: m[0], code: m[1] })) : [{ whole: src, code: src.trim() }];
if (blocks.length === 0) {
  console.log(JSON.stringify({ note: "mermaid 블록이 없습니다", input }));
  process.exit(0);
}

const { chromium } = require(need("playwright"));
need("mermaid");
need("@mermaid-js/layout-elk/package.json"); // ESM 전용이라 package.json으로 있는지만 본다
need("elkjs/lib/elk.bundled.js");

// 브라우저 쪽(scripts/browser.ts + assets/web/)을 한 파일로 묶는다 — 고친 파일이 묶음보다 새로우면 다시
const bundle = join(here, ".build", "browser.js");
const sources = [join(here, "browser.ts"), ...readdirSync(join(root, "assets/web")).filter((f) => f.endsWith(".ts")).map((f) => join(root, "assets/web", f))];
if (!existsSync(bundle) || sources.some((f) => statSync(f).mtimeMs > statSync(bundle).mtimeMs)) {
  const { build } = await import(pathToFileURL(need("esbuild")).href);
  await build({ entryPoints: [join(here, "browser.ts")], outfile: bundle, bundle: true, format: "iife", platform: "browser", target: "chrome120", logLevel: "error", absWorkingDir: root });
}
let fontCss = "";
try {
  fontCss = require.resolve("pretendard/dist/web/static/pretendard.css");
} catch {
  /* 없으면 시스템 글꼴 */
}

// 페이지: file:// 로 열어 글꼴 css의 상대 경로가 풀리게 한다
const work = mkdtempSync(join(tmpdir(), "meta-mermaid-"));
const page = join(work, "page.html");
writeFileSync(
  page,
  `<!doctype html><html lang="ko"><head><meta charset="utf-8">
${fontCss ? `<link rel="stylesheet" href="${pathToFileURL(fontCss).href}">` : ""}
<style>body{margin:0;background:#fff}#host{width:${width}px;padding:8px 0}#host svg{display:block;max-width:100%;height:auto}</style>
</head><body><div id="host"></div>
<script src="${pathToFileURL(bundle).href}"></script>
</body></html>`,
);

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: width + 40, height: 800 }, deviceScaleFactor: scale });
await tab.goto(pathToFileURL(page).href);
await tab.waitForFunction(() => window.metaMermaid);
await tab.evaluate(() => document.fonts.ready);

const pad = (n) => String(n).padStart(2, "0");
const results = [];
for (const [i, b] of blocks.entries()) {
  const name = `diagram-${pad(i + 1)}`;
  try {
    const info = await tab.evaluate(async ({ code, id }) => {
      const host = document.getElementById("host");
      host.innerHTML = "";
      await document.fonts.ready;
      return window.metaMermaid.draw(host, code, id);
    }, { code: b.code, id: `d${i}` });
    const files = [];
    if (format === "svg" || format === "both") {
      // 들어갈 크기로 width · height를 박는다(원래 크기보다 키우지 않음)
      const svg = await tab.evaluate(({ w, h }) => {
        const el = document.querySelector("#host svg").cloneNode(true);
        el.removeAttribute("style");
        el.setAttribute("width", String(Math.round(w)));
        el.setAttribute("height", String(Math.round(h)));
        return el.outerHTML;
      }, { w: info.width, h: info.height });
      writeFileSync(join(outDir, `${name}.svg`), `<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`);
      files.push(join(outDir, `${name}.svg`));
    }
    if (format === "png" || format === "both") {
      await tab.locator("#host svg").screenshot({ path: join(outDir, `${name}.png`), omitBackground: false });
      files.push(join(outDir, `${name}.png`));
    }
    const r = { diagram: i + 1, layout: info.kind, scale: +info.scale.toFixed(3), fontPx: +info.fontPx.toFixed(1), width: Math.round(info.width), height: Math.round(info.height), files };
    results.push({ ...r, link: files.find((f) => f.endsWith(".png")) ?? files[0] }); // 책 · 문서 도구는 PNG가 안전
    console.log(JSON.stringify(r));
  } catch (e) {
    results.push({ diagram: i + 1, error: String(e?.message ?? e).split("\n")[0].replace(/^page\.evaluate: (Error: )?/, "") });
    console.log(JSON.stringify(results.at(-1)));
  }
}
await browser.close();

// 원고 MD: 블록을 그림 링크로 바꾼 사본(그리지 못한 블록은 그대로 둔다)
const mdOut = opt("md-out");
if (isMd && mdOut) {
  let n = 0;
  const out = src.replace(BLOCK, (whole) => {
    const r = results[n++];
    if (!r?.link) return whole;
    const rel = relative(dirname(resolve(mdOut)), r.link).replace(/\\/g, "/");
    return `![도식 ${r.diagram}](${rel})`;
  });
  writeFileSync(mdOut, out);
  console.log(JSON.stringify({ mdOut: resolve(mdOut) }));
}
if (results.some((r) => r.error)) process.exitCode = 1;
