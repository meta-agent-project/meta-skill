# 모션 슬라이드 작성법

사용자가 주제나 내용을 줄 때만 모션 슬라이드를 만든다.
요청이 없으면 빈 페이지 한 장이다.

## Remotion과의 관계

Remotion은 React로 영상을 만드는 도구다. 이 엔진은 Remotion을 불러오지 않는다.
대신 Remotion의 핵심 방식만 같은 이름으로 넣었다.

| Remotion | 이 엔진 |
|---|---|
| 프레임 번호로 화면을 계산한다 | 페이지에 들어온 순간부터 30fps로 프레임을 센다 |
| `interpolate()` | `MOTION.interpolate(frame, [입력], [출력], 옵션)` |
| `spring()` | `MOTION.spring({frame, fps, config})` |
| `<Sequence from durationInFrames>` | 요소의 `data-from`, `data-dur` |
| 영상으로 렌더링 | 하지 않는다. 브라우저에서 바로 재생한다 |

## 슬라이드 원칙

- 한 페이지에 메시지 한 줄. 문장 세 줄 이상 쓰지 않는다. 나머지는 판서로 채운다.
- 페이지는 4~8장. 첫 페이지는 빈 페이지로 둘지 사용자에게 맞춘다.
- 모션은 읽는 순서를 보여 줄 때만 쓴다. 장식으로 쓰지 않는다.
- 한 페이지 전체 재생은 3초(90프레임) 안쪽.
- 요소 사이 간격은 6~12프레임, 요소 길이는 12~24프레임.

## 섹션 구조

```html
<section class="step" id="s-sga" data-title="SGA">
  <div class="kicker m" data-anim="fade" data-dur="12">오라클 메모리</div>
  <h1 class="m" data-anim="fade-up" data-from="6">SGA는 <span class="hl">모두가 함께</span> 쓴다</h1>
  <div class="row">
    <div class="card m" data-anim="pop" data-from="20"><b>버퍼 캐시</b><span>블록 보관</span></div>
    <div class="card m" data-anim="pop" data-from="28"><b>공유 풀</b><span>SQL 재사용</span></div>
  </div>
  <div class="sub m" data-anim="type" data-from="40" data-dur="30">PGA는 프로세스마다 따로 가진다</div>
</section>
```

- `data-title`: 페이지 목록에 보이는 이름
- `class="m"`: 모션을 받는 요소. 시작 전에는 숨어 있다
- `data-from`: 시작 프레임(기본 0)
- `data-dur`: 길이 프레임(기본 18)

## 제공 클래스

| 클래스 | 쓰임 |
|---|---|
| `kicker` | 위의 작은 주제 표시 |
| `h1`, `h2` | 큰 메시지 |
| `sub` | 보조 한 줄 |
| `hl`, `hlr` | 강조색 1, 2. 배경에 따라 바뀐다 |
| `row` | 가로 줄 세우기 |
| `card` | 제목 칸이 있는 상자. `<b>`가 제목, `<span>`이 내용 |

색은 직접 쓰지 않고 `var(--ink)`, `var(--mute)`, `var(--accent)`, `var(--accent2)`, `var(--dfill)`을 쓴다. 그래야 화이트와 칠판 둘 다 맞는다.
왼쪽 76px은 레일 자리라 엔진이 비워 둔다.

## data-anim 종류

| 값 | 움직임 |
|---|---|
| `fade` | 나타나기 |
| `fade-up`, `fade-down` | 아래·위에서 나타나기 |
| `slide-left`, `slide-right` | 오른쪽·왼쪽에서 들어오기 |
| `scale` | 살짝 커지며 나타나기 |
| `pop` | 스프링으로 튀어나오기 |
| `grow-x`, `grow-y` | 막대가 가로·세로로 자라기 |
| `draw` | 안쪽 SVG 선을 그려 나가기 |
| `type` | 글자를 한 자씩 치기 |
| `count` | 숫자 올리기. `data-to`, `data-start`, `data-dec` |

## 직접 짜는 모션

정해진 종류로 안 되면 페이지 끝에 스크립트를 둔다.
섹션에 `id`를 주고 `MOTION.on`으로 등록한다. 함수는 매 프레임 불린다.

```html
<section class="step" id="s-lru" data-frames="90">
  <svg viewBox="0 0 600 120" width="600"><rect id="blk" x="0" y="40" width="60" height="40" fill="var(--accent)"/></svg>
</section>
<script>
document.addEventListener('DOMContentLoaded',()=>MOTION.on('s-lru',(f,M)=>{
  const x=M.interpolate(f,[0,60],[0,520],{extrapolateRight:'clamp',easing:M.Easing.inOut});
  M.el('#blk').setAttribute('x',x);
}));
</script>
```

- `data-frames`: 이 페이지 재생 길이. 직접 짠 모션만 있을 때 꼭 준다
- `M.el(선택자)`, `M.all(선택자)`: 이 섹션 안에서만 찾는다
- 이 스크립트는 STEPS 영역 안, 섹션 바로 뒤에 둔다. 엔진보다 먼저 읽히므로 `DOMContentLoaded` 안에서 등록한다
- 엔진 스크립트(`<script id="engine">`)는 고치지 않는다

## 재생 규칙

- 페이지에 들어오면 처음부터 재생한다. R 키로 다시 재생한다.
- 기기가 움직임 줄이기 설정이면 끝 화면을 바로 보여 준다.
