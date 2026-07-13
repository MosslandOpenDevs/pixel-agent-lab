# Mossland Space Hub — Governance Monitor

[English](README.md) · **한국어**

Mossland Space Hub는 Mossland 3대 핵심 거버넌스 서비스 — **Algora**, **AO**, **Bridge** — 의 운영 상태를 **우주 물류 센터 시각화**(컨베이어 벨트 · 픽셀 에이전트)로 한 화면에 실시간 렌더링하는 라이브 대시보드입니다.

세 서비스는 각각 **독립적으로** 자신의 파이프라인을 돌리며, 이 화면은 세 서비스의 실시간 스트림을 한 곳에 모아 하나의 운영 지도로 보여줍니다.

![Status](https://img.shields.io/badge/status-live-brightgreen)
[![Live](https://img.shields.io/badge/live-monitor.moss.land-brightgreen)](https://monitor.moss.land)
![Stack](https://img.shields.io/badge/stack-Vite%20%C2%B7%20TS%20%C2%B7%20Phaser%203-blue)
![License](https://img.shields.io/badge/license-MIT-blue)

https://github.com/user-attachments/assets/1e3ab6cb-41f0-4bff-a227-a6b4505b2c3e

## 왜 (Why)

- **책임 분리를 한눈에** — 하나의 거버넌스 루프를 세 서비스가 어떻게 나눠 맡는지 한 화면에서 파악.
- **실제 작업 추적** — 각 서비스의 실제 처리 단계를 벨트 위 박스 이동으로 추적.
- **입력에서 결과까지** — 신호 유입부터 검증된 결과까지 전체 흐름을 시각화.

세 서비스가 공유하는 개념적 거버넌스 루프:

`Signals → Issues → Debates/Plans → Execution/Delegation → Outcomes/Proof → Feedback`

> 화면은 세 서비스를 **연결선 없이 독립 구역**으로 렌더링합니다(사이드바에서 세 개의 독립 서비스로 표현). 서비스 간 실제 데이터 핸드오프 계약은 [`docs/mossland-services-overview.md`](docs/mossland-services-overview.md) 참고.

## 서비스 (Services)

| 서비스 | 포트 | 역할 | Input | Output |
|--------|------|------|-------|--------|
| **Algora** | `:3201` | Sense & Detect | github / rss / social / chain 신호 | 구조화된 signal, 우선순위화된 issue |
| **AO** | `:3001` | Debate & Plan | 신호 / 이슈 컨텍스트 | Ideas → Plans → Projects |
| **Bridge** | `:3101` | Execute & Verify | 확정된 제안 / 태스크 | execution record, verified outcome, trust score |

### Algora — Sense & Detect · `:3201`

- **책임** — 다중 소스 신호 수집, 이슈 감지·우선순위화, 거버넌스 안건화.
- **화면:**
    - `LOADER` 봇이 신호를 집어 세로 컨베이어 벨트에 적재.
    - 11개 에이전트 클러스터(총 38 agents): Visionaries · Builders · Investors · Guardians · Operatives · Moderators · Advisors · Orchestrators · Archivists · Red Team · Scouts.
    - 9단계 파이프라인: Signal Intake → Issue Detection → Workflow Dispatch → Specialist Work → Doc Production → Dual-House Vote → Approval Route → Execution → Outcome Verify.
    - 신호는 벨트를 따라가다 이슈 카드로 승격되고, 산출 문서(`DP` · `GP` · `PA` · `WGC` · `ER` · `DR`)는 측면 독(dock)에 쌓입니다.

### AO — Debate & Plan · `:3001`

- **책임** — 멀티 에이전트 토론, 아이디어/계획/프로젝트 생성.
- **화면:**
    - 로더 봇이 아이디어를 가로 컨베이어 벨트에 투입.
    - 에이전트 링: Diverge(16) → Converge(8) → Plan(10).
    - 벨트 위 score 임계값: **score ≥ 7 → Plan 문서**, **≥ 8 → Project 박스**, 그 미만은 소멸.
    - 실시간 Debate 카드가 실제 토론 topic과 스니펫을 표시(AO 미응답 시 "AO debates unavailable").
    - 하단 퍼널: Ideas / Plans / Projects 누계.

### Bridge — Execute & Verify · `:3101`

- **책임** — 실행/위임, 인간 투표, 결과 검증(Outcome/Proof), 신뢰 지표.
- **화면:**
    - 5개 전문 에이전트: Risk · Treasury · Community · Product · Moderator.
    - L0→L4 파이프라인: L0 Signal Collection → L1 Deliberation → L2 Human Voting → L3 Execution → L4 Outcome Proof (L4에서 제안이 outcome-proof로 전환).
    - Trust & Outcomes 패널: Agent Trust · Proposals · Success Rate + 최근 outcome 로그.

## 인터페이스 (Interface)

### 좌측 패널
- **연결 상태** — 단일 집계 LIVE / OFFLINE (하나라도 도달 가능하면 LIVE, 셋 다 불가일 때만 "OFFLINE — no service reachable").
- **Stats** — 신호 큐, Algora 이슈, AO 토론 수.
- **Service I/O** — Algora / AO / Bridge를 개별 표시, 각 서비스의 도달 여부를 반영한 LIVE 배지.
- **About** — 시각화 범례.

### 우측 스테이지
- **Algora** — 세로 벨트 + 9단계 파이프라인 + 11개 에이전트 클러스터 아크.
- **AO** — 가로 벨트(score 임계값에 따라 Plan/Project로 승격) + Debate 카드 + 에이전트 링(Diverge/Converge/Plan).
- **Bridge** — 가로 벨트(L0→L4) + 5개 전문 에이전트 + Trust & Outcomes 패널.
- **허브 스트립** — 전체 폭 DataBridge 상태 스트립(집계 연결 · 큐 크기 · 15초 폴링).

### 모바일 / 반응형
- **< 768px** — 하단 탭(Algora / AO / Bridge)으로 한 번에 한 서비스 구역을 확대; 좌상단 ☰ 버튼으로 좌측 패널을 오버레이 토글.
- **768–1100px** — 좌측 패널을 상단에 가로로 배치.
- 모바일/데스크톱 브레이크포인트를 넘나들면(회전/리사이즈) 올바른 스케일 설정으로 재초기화.
- `prefers-reduced-motion` 존중(펄스/전환/카메라 팬 완화).

### 실시간 데이터
- 세 서비스(Algora / AO / Bridge)를 각각 **15초 주기로 폴링**.
- **Algora**·**AO** 벨트 위 박스는 각 서비스 API에서 가져온 실제 신호·아이디어이며, **Bridge** 레인은 꾸준한 제안 흐름을 애니메이션으로 보여주고 실제 제안·결과·신뢰 데이터는 L단계 통계와 Trust & Outcomes 패널을 구동합니다.
- 부분 응답·필드 누락·서비스 장애에도 크래시 없이, 해당 서비스만 LIVE 배지를 잃고 placeholder 수치로 폴백하며 나머지는 계속 렌더링됩니다.

## 데이터 흐름 (구역별 · 독립)

세 서비스는 서로 연결선 없이 **각자의 파이프라인**을 독립적으로 돌립니다.

- **Algora** — 신호 유입 → `LOADER` 적재 → 9단계(이슈 승격 + 문서 산출) → Outcome Verify 후 배출.
- **AO** — 아이디어 유입 → score 기반 Plan(≥ 7)/Project(≥ 8) 승격 또는 소멸 → 퍼널 누계.
- **Bridge** — 제안 유입 → L0~L4 통과 → L4에서 Outcome Proof로 전환 → 배출.

데이터가 비어 있거나 서비스가 offline이면 각 구역은 placeholder 상태를 유지하고, 사이드바가 서비스별 LIVE/OFFLINE을 정직하게 반영합니다.

## 기술 스택 (Tech Stack)

| 레이어 | 선택 | 이유 |
|--------|------|------|
| 2D 엔진 | Phaser 3 | 벨트/에이전트 애니메이션, 구역별 카메라 팬/줌 |
| 언어 | TypeScript | 타입이 있는 서비스 클라이언트와 월드 상태 |
| 빌드 | Vite 7 | 빠른 dev 서버 + 정적 SPA 빌드 |
| UI | 없음(vanilla DOM) | 사이드바/패널은 순수 DOM, 프레임워크 없음 |
| 서빙 | `serve` / PM2 | 프로덕션에서 정적 `dist` 호스팅 |

정적 SPA, UI 프레임워크 없음. 요구 사항: Node `>= 20.19` (Vite 7).

## 실행 (Running Locally)

```bash
npm install
npm run dev
```

빌드:

```bash
npm run build
```

빌드 결과물 서빙:

```bash
npm run serve          # serve dist -l 6300 -s
# 또는 PM2
pm2 start ecosystem.config.cjs
```

## 배포 (Deployment)

프런트엔드는 정적 SPA이며 `dist/`를 아무 정적 호스트로 서빙하면 됩니다.

앱은 런타임에 세 서비스 API를 **같은 오리진** 경로로 호출합니다:

- `/algora-api` → Algora signals/issues/stats
- `/ao-api` → AO signals/debates/status/ideas/plans/projects
- `/bridge-api` → Bridge signals/stats/proposals/outcomes/trust

개발 시에는 `vite.config.ts`의 dev 프록시가 이 경로들을 `localhost:3201 / 3001 / 3101`로 연결합니다. **프로덕션에서는 dev 프록시가 동작하지 않으므로**, 정적 파일 앞단의 리버스 프록시(nginx 등)가 위 세 경로를 각 서비스 업스트림으로 프록시해야 합니다.

예시 구성은 [`deploy/nginx.conf.example`](deploy/nginx.conf.example) 참고. 현재 배포: `https://monitor.moss.land` (정적 `dist` + nginx 리버스 프록시).

### CORS (교차 오리진 소비자)

monitor의 API 경로는 same-origin뿐 아니라 **다른 오리진**(예: moss.land 홈페이지의 거버넌스 위젯)에서도 호출됩니다. 따라서 리버스 프록시는 `Access-Control-Allow-Origin`을 단일 apex로 **고정하지 말고**, 허용 오리진 목록(`moss.land`, `www.moss.land`, dev `localhost:5173`)을 **반사(reflect)**하고 `OPTIONS` 프리플라이트에 응답해야 합니다. 예시 설정의 `map $http_origin` 블록과 각 `/…-api/` location의 CORS 헤더 참고. (GitHub issue #1)

## 라이선스 (License)

MIT — 자세한 내용은 [LICENSE](LICENSE) 참고.
