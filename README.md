# meta-skill

Claude Code에서 쓰는 한국어 스킬 모음이다.
대화 저장과 복원, 주제 탐색, 문서 작성, 러닝 코스 지도 제작, 강의 판서보드 만들기, 설명 그림 생성, 스킬 찾기를 돕는다.

## 스킬

각 스킬의 규칙과 사용 순서는 .claude/skills/스킬이름/SKILL.md에 있다.

| 이름 | 하는 일 | 부르는 말 |
|---|---|---|
| meta-context-save | 대화의 결정, 초안, 열린 질문을 골라 저장한다 | 대화 저장, clear 전에 남겨줘 |
| meta-context-restore | 저장한 대화를 골라 불러온다 | 이어서 하자, 남긴 거 불러와 |
| meta-deeptalk | 코드를 바꾸지 않고 한 주제를 깊이 논의한다 | 깊게 얘기해 보자 |
| meta-md | 짧고 일관된 한국어 Markdown 문서를 작성한다 | md 규칙, 문서 다듬어줘 |
| meta-running-map | 실제 보행 경로 기반 러닝 지도와 재생 화면, 책용 지도 이미지·QR·GPX를 제작한다 | 러닝 지도 만들어줘, 러닝 코스 재생 지도 만들어줘 |
| meta-panseo-board | 도형·텍스트·자동 도형 맞춤·이미지 붙여넣기가 있는 강의용 판서보드와 모션 슬라이드 HTML을 만든다 | 판서보드 만들어줘, 판서 슬라이드 만들어줘 |
| meta-image | 견본 PNG 두 장을 첨부해 흑백 펜 화풍의 강의 · 책 설명 그림을 생성한다 | 이 화풍으로 그려줘, 설명 그림 만들어줘 |
| meta-skill | 필요한 스킬을 찾아 추천하고 요청하면 한국어 스킬로 재작성한다 | 스킬 찾아줘, 스킬 추천 |

## 내려받기

저장소를 내려받고 그 폴더에서 Claude Code를 실행한다.

```bash
git clone https://github.com/meta-agent-project/meta-skill.git
cd meta-skill
claude
```

다른 프로젝트에서 쓰려면 .claude/skills 안의 여덟 meta-* 폴더를 해당 프로젝트의 .claude/skills에 복사한다.
모든 프로젝트에서 쓰려면 ~/.claude/skills에 복사한다.
같은 이름의 스킬이 있으면 덮어쓰기 전에 내용을 확인한다.

스킬 본문에 적힌 ~/.claude/skills 경로는 전역 설치 기준이다.
프로젝트에 설치했다면 검색 스크립트는 아래의 프로젝트 경로로 실행한다.

## 사용

Claude Code 대화창에서 필요한 스킬을 호출한다.
표의 부르는 말로 요청할 수도 있다.

```text
/meta-context-save
/meta-context-restore
/meta-deeptalk
/meta-md
/meta-running-map
/meta-panseo-board
/meta-image
/meta-skill
```

## 스킬 검색 준비

Node.js와 인터넷 연결이 필요하다.
저장소 루트에서 후보 목록을 모으고 검색한다.

```bash
node .claude/skills/meta-skill/registry.mjs collect
node .claude/skills/meta-skill/registry.mjs search review 리뷰
```

검색 캐시 registry.json은 각 컴퓨터에서 생성한다.
의존성 폴더와 빌드 결과, 검색 캐시는 저장소에 포함하지 않는다.
