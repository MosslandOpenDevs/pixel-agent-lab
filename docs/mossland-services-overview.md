# Mossland Core Service Architecture

**Scope**
- 대상 서비스: `algora.moss.land`, `ao.moss.land`, `bridge.moss.land`
- 목적: 세 서비스의 역할, 기능, 상호관계, 입출력(I/O)을 **실무적으로 이해 가능한 형태**로 정리

---

## 1. System Overview

Mossland의 3개 서비스는 단일 제품이 아니라, 다음과 같은 **연속 운영 체계**를 구성한다.

1. **Algora**: 신호 관측과 이슈 탐지
2. **AO (Agentic Orchestrator)**: 멀티 에이전트 의사결정과 실행 계획 수립
3. **Bridge**: 실행/위임/검증 및 결과 환류

핵심 파이프라인:

`Signals → Issues → Plans → Execution → Outcomes → Feedback`

---

## 2. Service-by-Service Detail

## 2.1 Algora

### 2.1.1 Mission
실시간으로 시스템/시장/커뮤니티/개발 관련 신호를 관측하고, 유의미한 이슈를 빠르게 감지해 거버넌스 가능한 단위로 구조화한다.

### 2.1.2 화면 구조(스크린샷 기반)
- 좌측 내비게이션: 대시보드, 라이브, 거버넌스 OS, 아고라, 에이전트, 신호, 이슈, 제안, 트레저리, 공시, 관리자, 엔진 룸
- 상단 상태 바: 시스템 상태, 예산, 다음 사이클 시점, 대기열, LIVE 상태
- KPI 카드: 활성 에이전트, 활성 세션, 오늘의 신호, 미해결 이슈
- 최근 활동 피드: 수집기 헬스 및 운영 이벤트 로그
- 에이전트 로비: 역할별 에이전트 목록

### 2.1.3 Functional Role
- 지속 수집(collector)
- 이상/이슈 감지
- 이슈 우선순위화
- 거버넌스 안건 생성
- 고위험 액션 게이트(승인 절차 전 잠금)

### 2.1.4 I/O
**Input**
- 외부/내부 신호(개발 이벤트, 커뮤니티 이벤트, 운영 텔레메트리 등)
- 수집기 상태 및 헬스 데이터

**Output**
- 구조화된 신호 레코드
- 이슈 및 심각도/우선순위
- AO로 전달 가능한 안건 단위 데이터

---

## 2.2 AO (Agentic Orchestrator)

### 2.2.1 Mission
신호/이슈를 그대로 실행하지 않고, 멀티 에이전트 토론을 통해 대안 비교, 전략 수립, 실행 계획 생성까지 담당한다.

### 2.2.2 화면 구조(스크린샷 기반)
- 상단 탭: Dashboard, Ideas, Debates, Projects, Agents, System
- 파이프라인: Signals → Trends → Ideas → Plans → Projects
- 요약 카드: Total Ideas, Plans, In Development, Trends Analyzed
- 실행 상태: RUNNING, uptime, 최근/다음 실행 시점

### 2.2.3 Functional Role
- 다중 관점 토론(Debates)
- 문제 재정의 및 대안 생성
- 계획(Plan) 수립
- 프로젝트 단위 분해(Projects)
- 승인 기반 실행 준비(Human-in-the-loop)

### 2.2.4 I/O
**Input**
- Algora에서 전달된 신호/이슈
- 정책/목표/제약 조건

**Output**
- 실행 가능한 Plan
- 우선순위가 반영된 Project/Task 구조
- Bridge에 전달되는 실행 명세

---

## 2.3 Bridge

### 2.3.1 Mission
계획을 현실 운영 맥락에서 실행하고, 결과를 검증 가능 형태로 기록해 상위 레이어로 환류한다.

### 2.3.2 화면 구조(스크린샷 기반)
- 상단 탭: Dashboard, Signals, Issues, Proposals, Delegation, Outcomes
- 안내 배너: Experimental / Research / Non-Production
- KPI: Total Signals, Issue Detection, Active Proposals, Success Rate
- 최근 신호: Reality Feed, Governance Proposals, Issue Detection, Proof of Outcome
- 뷰 전환: Signals / Issues / Proposals / Delegation

### 2.3.3 Functional Role
- 실행 위임(Delegation)
- 실행 상태 추적
- 결과 검증(Proof/Outcome)
- 상태/결과 환류

### 2.3.4 I/O
**Input**
- AO가 확정한 실행 명세(Plan/Task)
- 실행 환경 컨텍스트

**Output**
- 실행 결과(성공/실패/보류)
- Outcome/Proof 데이터
- Algora/AO로 돌아가는 피드백 이벤트

---

## 3. Comparative Model (차이점)

## 3.1 Primary Responsibility
- **Algora**: Detect & Structure
- **AO**: Decide & Plan
- **Bridge**: Execute & Verify

## 3.2 Time Perspective
- **Algora**: 상시 감시(continuous sensing)
- **AO**: 의사결정 사이클(decision cycles)
- **Bridge**: 실행 사이클(execution cycles)

## 3.3 Risk Perspective
- **Algora**: 리스크 감지와 경보
- **AO**: 리스크-효율 균형 의사결정
- **Bridge**: 실행 리스크 관리 및 결과 검증

---

## 4. End-to-End Flow

1. **Signal Capture (Algora)**
   - 다중 소스에서 신호 수집
2. **Issue Detection (Algora)**
   - 이상 이벤트를 이슈로 구조화
3. **Debate & Planning (AO)**
   - 멀티 에이전트 토론 후 계획 확정
4. **Execution & Delegation (Bridge)**
   - 계획을 실제 실행 단위로 처리
5. **Outcome Verification (Bridge)**
   - 결과/증빙 생성
6. **Feedback Loop (Algora/AO)**
   - 결과가 다음 탐지/계획 정확도 향상에 반영

---

## 5. Operational Interpretation for Product Design

UI/UX 또는 시각화 시스템 설계 시, 세 서비스를 하나로 섞기보다 아래처럼 분리 표현하는 것이 이해도를 높인다.

- **Algora Zone**: 신호 스트림, 이슈 생성, 경보 밀도
- **AO Zone**: 토론 상태, 계획 큐, 우선순위 변화
- **Bridge Zone**: 실행 진행률, 위임 상태, 검증/결과

추천 지표 매핑:
- Algora: Signal Volume, Issue Detection Rate, Open Issues
- AO: Debate Throughput, Plan Conversion Rate, Active Projects
- Bridge: Execution Success Rate, Delegation Queue, Verified Outcomes

---

## 6. Canonical Data Handoff Contract (개념적)

### 6.1 Algora → AO
- `issue_id`
- `severity`
- `evidence_links`
- `detected_at`
- `recommended_action`

### 6.2 AO → Bridge
- `plan_id`
- `tasks[]`
- `priority`
- `approval_state`
- `constraints`

### 6.3 Bridge → Algora/AO
- `execution_id`
- `status`
- `outcome_summary`
- `proof_refs`
- `observed_risks`

---

## 7. Practical Summary

- **Algora**는 "무슨 일이 벌어졌는가"를 잡아내는 레이어
- **AO**는 "무엇을 할 것인가"를 결정하는 레이어
- **Bridge**는 "실제로 무엇이 실행되었는가"를 증명하는 레이어

세 서비스는 개별 도구가 아니라, 하나의 거버넌스 루프를 이루는 유기적 구조다.
