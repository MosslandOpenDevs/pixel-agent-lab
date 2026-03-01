# Mossland Core Service Architecture

대상 서비스:
- `https://algora.moss.land`
- `https://ao.moss.land`
- `https://bridge.moss.land`

본 문서는 실제 화면 탐색(대시보드/세부 메뉴 확인) 기준으로, 세 서비스의 역할·입출력·연계 구조를 실무적으로 이해하기 쉽게 정리한다.

---

## 1) 전체 구조: 3-레이어 운영 루프

Mossland 3개 서비스는 기능이 중복되는 제품군이 아니라, 하나의 거버넌스 운영 루프를 분담한다.

1. **Algora (Sense & Detect)**
   - 다중 소스 신호 수집
   - 이슈 감지·우선순위화
   - 거버넌스 안건화

2. **AO (Debate & Plan)**
   - 멀티 에이전트 토론
   - 아이디어/계획/프로젝트 생성
   - 실행 가능한 task 구조화

3. **Bridge (Execute & Verify)**
   - 실행/위임/모니터링
   - 결과 검증(Outcome/Proof)
   - 실행 결과 환류

핵심 파이프라인:

`Signals → Issues → Debates/Plans → Execution/Delegation → Outcomes/Proof → Feedback`

---

## 2) Algora 상세

## 2.1 화면에서 확인되는 핵심 기능

### A. 관제형 내비게이션 구조
좌측 메뉴 기준으로 기능 경계를 명확히 분리하고 있다.
- 대시보드, 라이브, 가이드
- 거버넌스 OS, 아고라, 에이전트
- 신호, 이슈, 제안, 트레저리, 공시
- 관리자, 엔진 룸

### B. 실시간 운영 상태
상단 바에서 운영 지표를 즉시 확인한다.
- 시스템 상태(실행 중)
- 예산(달러 단위)
- 라이브 상태, 대기열, 검색

### C. 대시보드 관점
- 활성 에이전트 / 활성 세션 / 오늘의 신호 / 미해결 이슈
- 최근 활동 로그(collector health, heartbeat, pipeline 이벤트)
- 에이전트 로비(역할형 에이전트 목록)

### D. Signals 화면(직접 확인)
- `Signal Pulse` (signals/min)
- 기간별 집계(10min, 1hour, today, week, month)
- 필터: 소스(RSS, GitHub, 블록체인, 소셜, 외부 API, 수동)
- 상태 필터(전체/처리됨/대기 중)
- 각 신호 카드에
  - 제목/요약
  - 심각도(낮음/보통/높음)
  - 출처/카테고리(ai/dev/crypto/security/finance)
  - 시간
  - 소스 링크

즉 Algora는 “데이터 수집기 + 이슈 감지기 + 거버넌스 관제판” 역할이 명확하다.

## 2.2 Algora I/O

**Input**
- RSS/소셜/GitHub/체인/외부 API 등 다중 신호
- 수집기 상태(health), 운영 이벤트

**Output**
- 구조화된 signal 레코드
- issue 후보 및 우선순위
- AO에 전달 가능한 의사결정 재료(문제 컨텍스트)

---

## 3) AO (Agentic Orchestrator) 상세

## 3.1 화면에서 확인되는 핵심 기능

### A. 파이프라인 중심 정보 구조
상단 메뉴:
- Dashboard / Ideas / Debates / Projects / Agents / System

Dashboard/파이프라인:
- Signals → Trends → Ideas → Plans → Projects
- Conversion rates, currently processing, activity.log 제공

### B. Debate 엔진(직접 확인)
Debates 탭에서 토론 메커니즘을 명시한다.
- 역할 예시: Founder, VC, Accelerator, Friend
- 역할 순환: Proposer → Supporter → Challenger → Synthesizer
- 토론 단계: Divergence → Convergence → Planning
- 세션 필터: Status, Phase
- Debate sessions 목록과 outcome 상태 표시

### C. Projects 엔진(직접 확인)
Projects 탭에서 계획의 산출물이 코드 프로젝트로 연결되는 흐름이 드러난다.
- 상태 집계: Total / Ready / Generating / Error
- 프로젝트 리스트(스택 태그: react/nextjs/vue, express, ethereum 등)
- 파이프라인 단계:
  - Plan
  - Parse Markdown
  - Detect Stack
  - LLM Code Gen
  - Project
- 모델 라우팅 정보(파싱/코드생성/아키텍처/폴백)

즉 AO는 “토론만 하는 도구”가 아니라, 신호를 계획·프로젝트로 전환하는 오케스트레이션 시스템이다.

## 3.2 AO I/O

**Input**
- Algora가 만든 신호/이슈 컨텍스트
- 목표/정책/제약

**Output**
- Ideas / Debates 결과
- Plans / Projects / 실행 명세
- Bridge에 전달할 작업 단위(task graph)

---

## 4) Bridge 상세

## 4.1 화면에서 확인되는 핵심 기능

### A. 실행/결과 중심 내비게이션
- Dashboard / Signals / Issues / Proposals / Delegation / Outcomes

### B. 운영 지표
Dashboard에서 확인되는 KPI:
- Total Signals
- Issue Detection
- Active Proposals
- Success Rate

### C. Recent Signals 블록
- Reality Feed
- Governance Proposals
- Issue Detection
- Proof of Outcome

### D. Outcomes 화면(직접 확인)
`/outcomes`에서 결과 검증 관점을 명확히 제공한다.
- Proof of Outcome
- Execution Record
- Verified / Passed / Success Rate
- Trust Scores (Agents / Proposers / Delegates)

즉 Bridge는 “실행 후 상태를 남기고 증명하는 레이어”다.

## 4.2 Bridge I/O

**Input**
- AO에서 확정된 계획/태스크/우선순위

**Output**
- 실행 기록(Execution Record)
- 검증/통과 여부(Verified, Passed)
- 신뢰 지표(Trust Scores)
- 상위 레이어 환류용 결과 이벤트

---

## 5) 세 서비스의 차이 (혼동 방지)

## 5.1 같은 점
- 세 서비스 모두 signals/issues/proposals 같은 용어를 공유한다.
- 세 서비스 모두 에이전트 기반 운영 관점을 가진다.

## 5.2 다른 점 (핵심 책임)
- **Algora**: 감지와 관제 중심 (문제 발견)
- **AO**: 토론과 계획 중심 (해결 설계)
- **Bridge**: 실행과 검증 중심 (결과 증명)

용어가 겹쳐 보여도, 책임의 중심축은 위처럼 분리된다.

---

## 6) 관계 모델: 실제 운영 시나리오

### Step 1. 감지 (Algora)
- 다중 수집기에서 신호 유입
- 중요 신호를 이슈로 구조화

### Step 2. 토론/계획 (AO)
- 이슈를 멀티 에이전트가 토론
- 대안 비교 후 plan/project 생성

### Step 3. 실행/검증 (Bridge)
- 계획을 delegation/실행
- 결과를 outcome/proof로 검증

### Step 4. 환류
- Bridge 결과가 다시 Algora/AO 판단 재료로 반영

---

## 7) 서비스별 핵심 KPI 제안

문서/대시보드 설계 시 아래 KPI를 표준 축으로 잡으면 이해가 빠르다.

### Algora KPI
- signals/min
- 신규 issue 수
- 미해결 issue 수
- 수집기 health

### AO KPI
- Signal→Idea 전환율
- Idea→Plan 전환율
- Plan→Project 전환율
- debate 완료율

### Bridge KPI
- 실행 성공률
- 검증 완료율(verified)
- delegated task 처리율
- outcome 누적 추세

---

## 8) 데이터 핸드오프 계약(개념)

### Algora → AO
- `signal_id`, `issue_id`
- `severity`, `category`
- `summary`, `evidence_links`
- `detected_at`

### AO → Bridge
- `plan_id`, `project_id`
- `tasks[]`, `priority`
- `approval_state`
- `constraints`

### Bridge → Algora/AO
- `execution_id`
- `status` (success/fail/pending)
- `outcome_summary`
- `proof_refs`
- `observed_risks`

---

## 9) 최종 요약

- **Algora**는 “무슨 일이 발생했는지”를 가장 먼저 잡아낸다.
- **AO**는 “그래서 무엇을 할지”를 토론과 계획으로 만든다.
- **Bridge**는 “실제로 무엇이 수행됐는지”를 검증 가능한 결과로 남긴다.

이 3개가 결합되어 Mossland의 에이전트 거버넌스 운영 루프를 구성한다.
