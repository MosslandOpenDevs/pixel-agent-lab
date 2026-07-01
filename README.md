# Mossland Space Hub — Governance Monitor

`pixel-agent-lab`은 Mossland 핵심 서비스(**Algora**, **AO**, **Bridge**)의 운영 상태를
**우주 물류 센터 시각화**(컨베이어 벨트 · 픽셀 에이전트)로 보여주는 라이브 대시보드입니다.
세 서비스는 각각 **독립적으로** 자신의 파이프라인을 돌리며, 이 화면은 세 서비스의 실시간
데이터를 한 곳에 모아 보여줍니다.

- 🔴 라이브: **https://monitor.moss.land**
- 스택: Vite · TypeScript · Phaser 3 (정적 SPA, 프레임워크 없음)

https://github.com/user-attachments/assets/1e3ab6cb-41f0-4bff-a227-a6b4505b2c3e

## 1) 데모 목적

- 세 서비스의 책임 분리를 한 화면에서 직관적으로 이해
- 각 서비스가 실제로 어떤 작업 단계를 거치는지 벨트 위 박스 이동으로 추적
- 입력(Input)부터 결과(Output)까지의 처리 흐름을 시각화

각 서비스가 담당하는 거버넌스 루프의 개념적 파이프라인:

`Signals → Issues → Debates/Plans → Execution/Delegation → Outcomes/Proof → Feedback`

> 참고: 화면은 세 서비스를 **연결선 없이 독립 구역**으로 렌더링합니다(사이드바 "3 Independent
> Services"). 서비스 간 실제 데이터 핸드오프 계약은 [`docs/mossland-services-overview.md`](docs/mossland-services-overview.md) 참고.

---

## 2) 서비스 구조 (화면 구성)

### Algora — Sense & Detect · `:3201`

- **책임**: 다중 소스 신호 수집, 이슈 감지·우선순위화, 거버넌스 안건화
- **Input**: github / rss / social / chain 신호 (severity · category · priority)
- **Output**: 구조화된 signal, 우선순위화된 issue
- **화면**:
    - `LOADER` 봇이 신호를 집어 세로 컨베이어 벨트에 적재
    - 11개 에이전트 클러스터(총 38 agents): Visionaries · Builders · Investors · Guardians ·
      Operatives · Moderators · Advisors · Orchestrators · Archivists · Red Team · Scouts
    - 9단계 파이프라인: Signal Intake → Issue Detection → Workflow Dispatch → Specialist Work →
      Doc Production → Dual-House Vote → Approval Route → Execution → Outcome Verify
      (2단계에서 신호가 이슈 카드로 전환, 5단계에서 문서 산출)
    - 산출 문서 유형: DP · GP · PA · WGC · ER · DR

### AO — Debate & Plan · `:3001`

- **책임**: 멀티 에이전트 토론, 아이디어/계획/프로젝트 생성
- **Input**: 신호/이슈 컨텍스트
- **Output**: Ideas → Plans → Projects
- **화면**:
    - 로더 봇이 아이디어를 가로 컨베이어 벨트에 투입
    - 에이전트 링: Diverge(16) → Converge(8) → Plan(10)
    - 벨트 위 score 임계값 전환: **score ≥ 7 → Plan 문서**, **≥ 8 → Project 박스**, 그 미만은 소멸
    - 실시간 Debate 카드(실제 토론 topic·스니펫; AO 미응답 시 "AO debates unavailable")
    - 하단 퍼널: Ideas / Plans / Projects 누계

### Bridge — Execute & Verify · `:3101`

- **책임**: 실행/위임, 인간 투표, 결과 검증(Outcome/Proof), 신뢰 지표
- **Input**: 확정된 제안/태스크
- **Output**: execution record, verified outcome, trust score
- **화면**:
    - 5개 전문 에이전트: Risk · Treasury · Community · Product · Moderator
    - L0→L4 파이프라인: L0 Signal Collection → L1 Deliberation → L2 Human Voting →
      L3 Execution → L4 Outcome Proof (L4에서 결과 증명(outcome-proof)으로 전환)
    - Trust & Outcomes 패널: Agent Trust · Proposals · Success Rate + 최근 outcome 로그

---

## 3) UI 구성

### 좌측 패널
- 연결 상태(LIVE / OFFLINE) — 서비스별 도달 가능 여부를 개별 반영
- 운영 통계(Stats): 신호 큐, Algora 이슈, AO 토론 수
- 서비스 I/O 상태 (Algora / AO / Bridge 분리 표시, 서비스별 LIVE 배지)
- About: 시각화 범례

### 우측 스테이지
- **Algora**: 세로 컨베이어 벨트 + 9단계 파이프라인 + 11개 에이전트 클러스터 아크
- **AO**: 가로 컨베이어 벨트(아이디어 → score 임계값에 따라 Plan/Project로 전환) + 토론(Debate) 카드 + 에이전트 링(Diverge/Converge/Plan)
- **Bridge**: 가로 컨베이어 벨트(L0→L4) + 5개 전문 에이전트 + Trust & Outcomes 패널
- 하단 스트립: DataBridge 집계 상태(연결/큐/폴링 주기)

### 모바일 / 반응형
- `< 768px`: 화면 하단 탭(Algora / AO / Bridge)으로 한 번에 한 서비스 구역을 확대해서 표시,
  좌상단 ☰ 버튼으로 좌측 패널을 오버레이로 토글
- `768–1100px`: 좌측 패널을 상단에 가로 배치
- 브레이크포인트를 넘나들면(회전/리사이즈) 올바른 스케일 설정으로 재초기화
- `prefers-reduced-motion` 존중(펄스/전환/카메라 팬 완화)

### 실시간 데이터
- 세 서비스(Algora/AO/Bridge)를 각각 **15초 주기로 폴링**
- 벨트 위의 박스는 실제 신호/아이디어/제안 데이터를 시각화한 것
- 부분 응답·필드 누락·서비스 장애에도 크래시 없이 mock/placeholder로 유지되며,
  사이드바가 해당 서비스만 OFFLINE으로 표시

---

## 4) 데이터 흐름 (구역별 · 독립)

세 서비스는 서로 연결선 없이 **각자의 파이프라인**을 독립적으로 돌립니다.

- **Algora**: 신호 유입 → `LOADER` 적재 → 9단계 통과(2단계 이슈화, 5단계 문서화) → Outcome Verify 후 배출
- **AO**: 아이디어 유입 → score 기반 Plan(≥7)/Project(≥8) 승격 또는 소멸 → 퍼널 누계
- **Bridge**: 제안 유입 → L0~L4 통과 → L4 Outcome Proof로 전환 → 배출

데이터가 비어 있거나 서비스가 offline이면 각 구역은 placeholder 상태를 유지하고,
사이드바의 연결 상태가 서비스별로 LIVE/OFFLINE을 정직하게 반영합니다.

---

## 5) 실행

```bash
npm install
npm run dev
```

빌드:

```bash
npm run build
```

정적 서빙(빌드 결과물):

```bash
npm run serve          # serve dist -l 6300 -s
# 또는 PM2
pm2 start ecosystem.config.cjs
```

요구 사항: Node `>= 20.19` (Vite 7).

## 6) 배포 (Deployment)

프런트엔드는 정적 SPA이며 `dist/`를 아무 정적 호스트로 서빙하면 된다.

단, 앱은 런타임에 세 서비스 API를 **같은 오리진**의 경로로 호출한다.

- `/algora-api` → Algora signals/issues/stats
- `/ao-api` → AO signals/debates/status/ideas/plans/projects
- `/bridge-api` → Bridge signals/stats/proposals/outcomes/trust

이 경로들은 개발 시 `vite.config.ts`의 dev 프록시가 `localhost:3201 / 3001 / 3101`로 연결한다.
**프로덕션에서는 dev 프록시가 동작하지 않으므로**, 정적 파일 앞단의 리버스 프록시(nginx 등)가
위 세 경로를 각 서비스 업스트림으로 프록시하도록 반드시 구성해야 한다.

예시 nginx 구성은 [`deploy/nginx.conf.example`](deploy/nginx.conf.example) 참고.
현재 배포: `https://monitor.moss.land` (정적 `dist` + nginx 리버스 프록시).

### CORS (교차 오리진 소비자)

monitor는 자기 자신(same-origin)뿐 아니라 **다른 오리진**(예: moss.land 홈페이지의 거버넌스
위젯)에서도 위 API 경로를 호출한다. 따라서 리버스 프록시는 `Access-Control-Allow-Origin`을
단일 apex로 **고정하지 말고**, 허용 오리진 목록(`moss.land`, `www.moss.land`, dev `localhost:5173`)을
**반사(reflect)**하고 `OPTIONS` 프리플라이트에 응답해야 한다. 예시 설정의 `map $http_origin`
블록과 각 `/…-api/` location의 CORS 헤더 참고. (GitHub issue #1)
