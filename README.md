# AETHERION AI

한국어 에이전트 AI 사이트와 플레이그라운드예요. 사이트: https://hii.o-r.kr

## 서비스 모델
- **Google Gemma 4 26B-A4B** (Apache 2.0). 우리가 학습한 모델이 아니에요. 공개 가중치의 3비트 양자화(UD-IQ3_S) 버전과 비전 인코더(mmproj)를 그대로 써요. Gemma는 Google의 상표예요.
- llama.cpp `llama-server`로 GPU 없는 8코어 CPU, 16GB RAM 서버에서 돌려요. 실측 생성 속도는 초당 약 10 토큰이에요 (2026-10, 594토큰 생성 기준 10.5 tok/s).

## 구성
| 경로 | 내용 |
|---|---|
| `/` | 홈 (최근 소식 포함) |
| `/playground/` | 채팅: 도구 호출, 이미지, 딥 리서치, 파일·PDF Q&A, 파이썬 실행(Pyodide), CSV 차트, 실시간 미리보기·버전 기록, 공유 링크, 템플릿, 맞춤 지시사항·기억, 읽어주기, 👍/👎 피드백 |
| `/news/`, `/news/post/?p=…` | 소식 (패치 노트·블로그·이벤트 탭) |
| `/patch-notes/` | 버전별 패치 노트 |
| `/status/` | 모델 서버 상태 (30초마다 갱신) |
| `/share/#…` | 공유된 대화 (내용은 URL `#` 뒤에만 있고 서버에 저장되지 않아요) |
| `config/endpoint.json` | 플레이그라운드 기본 서버 주소 |
| `content/posts/*.md` | 소식 원본 |

## 소식 쓰기
1. `content/posts/YYYY-MM-DD-이름.md` 를 만들어요. 앞부분(front-matter):
   ```
   ---
   type: patch | blog | event
   title: 제목
   date: 2026-10-24
   version: v5        # patch만
   summary: 한 줄 요약
   ---
   ```
   패치 노트는 `## 신규`, `## 개선`, `## 수정`, `## 알려진 문제` 섹션과 `— AETHERION 팀` 서명이 필요해요.
2. `node tools/build_content.mjs` 로 `content/index.json`, `feed.xml` 을 다시 만들어요. (main에 머지되면 `content.yml` 액션도 다시 만들어요.)
3. 릴리스 PR(`feat/`·`release/` 브랜치, `release` 라벨, 또는 제목이 `vN`)은 새 패치 노트가 없으면 `release-notes.yml` 검사에서 실패해요.

## 검사
```
python3 tools/site_audit.py          # HTML·링크·접근성 정적 검사
node tools/build_content.mjs --check # 생성 파일 최신 여부
# 브라우저 스모크 (390px·1280px): 로컬 서버를 8765에 띄운 뒤
BROWSER_EXECUTABLE=$(command -v google-chrome) PW_CORE_DIR=…/playwright-core node tools/site_browser_smoke.cjs
```
`site-quality.yml` 이 PR과 main 푸시마다 위 검사를 돌려요.

## 개인정보
대화 기록, 맞춤 지시사항, 기억, 접속 키는 브라우저(localStorage)에만 저장돼요. 👍/👎를 누를 때만 그 질문과 답변 일부가 서버 로그에 남아요.

## 정리된 것 (v4)
초기 WebGPU 실험(`/chat/`, `/agent/`, `/runtime/`, `/lab/`, `/legacy/`)과 관련 스크립트·워크플로는 v4에서 지웠어요. 기록은 Git 히스토리에 남아 있어요.

## 라이선스
- Gemma 4: Apache 2.0 (Google)
- pdf.js: Apache 2.0 (`assets/vendor/LICENSE-pdfjs.txt`), Pyodide: MPL 2.0 (jsDelivr에서 불러옴)
