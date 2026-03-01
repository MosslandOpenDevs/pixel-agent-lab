# Mossland Core Services Overview

> Scope: This document summarizes three Mossland services based on observed screenshots and service descriptions shared in conversation.
> 
> Services: **Algora**, **Agentic Orchestrator (AO)**, **Bridge**

---

## 1) Executive Summary (한눈에 보기)

Mossland의 3개 서비스는 기능이 겹치는 듯 보여도, 실제로는 역할이 분리된 **연속 파이프라인**으로 이해하는 것이 가장 정확합니다.

- **Algora**: 신호 감지/이슈화/거버넌스 관제
- **AO**: 멀티 에이전트 토론/계획 수립/프로젝트화
- **Bridge**: 실행 위임/현실 연동/결과 검증(Outcome)

핵심 흐름:

`Algora (Detect) → AO (Decide/Plan) → Bridge (Execute/Verify) → Feedback Loop`

---

## 2) 서비스별 상세 설명

## 2.1 Algora

### 역할
- 24/7 라이브 에이전틱 거버넌스 관제 레이어
- 다양한 소스에서 신호를 수집하고 문제를 감지해 **이슈/안건**으로 구조화
- 고위험 액션은 즉시 자동 실행이 아닌, 승인 절차(LOCK/승인 게이트) 기반으로 운영

### 스크린샷에서 확인된 UI 단서
- 좌측 메뉴: `대시보드`, `라이브`, `거버넌스 OS`, `신호`, `이슈`, `제안`, `트레저리`, `에이전트`
- 상단/카드 지표: 활성 에이전트, 활성 세션, 오늘의 신호, 해결된 이슈
- 최근 활동 피드: 수집기 상태(COLLECTOR_HEALTH), 리스크 평가 진행, 점검 이벤트
- 에이전트 로비: 역할형 에이전트 목록(예: Product Architect, Risk Sentinel 등)

### 해석
Algora는 "아이디어를 깊게 토론하는 장소"라기보다,
**실시간 감시 + 이슈 감지 + 거버넌스 상태 관리**의 중심에 가깝습니다.

---

## 2.2 Agentic Orchestrator (AO)

### 역할
- 다중 페르소나 에이전트(Founder/VC/Operator 등) 토론을 통해
  이슈를 **의사결정 가능한 계획(Plan)** 으로 변환
- 계획을 프로젝트/실행 단위로 나누고 우선순위를 배치
- Human-in-the-loop 기반 승인/조율

### 스크린샷에서 확인된 UI 단서
- 상단 탭: `Dashboard`, `Ideas`, `Debates`, `Projects`, `Agents`, `System`
- 파이프라인 카드/보드: `Signals → Trends → Ideas → Plans → Projects`
- 통계: Total Ideas, Plans, In Development, Trends Analyzed
- 실시간 실행 상태: RUNNING, uptime 등

### 해석
AO는 "문제를 어떻게 풀지"를 설계하는 엔진입니다.
Algora가 탐지한 신호/이슈를 입력받아,
**토론 → 계획화 → 프로젝트화**로 변환합니다.

---

## 2.3 Bridge

### 역할
- Reality Ops/Physical AI Governance 관점에서
  계획을 실제 실행 단계로 연결하고 결과를 검증
- 위임(Delegation), 실행 결과(Outcomes), 증빙(Proof) 관리
- 현실 이벤트/오라클/연동 결과를 다시 상위 시스템에 피드백

### 스크린샷에서 확인된 UI 단서
- 상단 탭: `Dashboard`, `Signals`, `Issues`, `Proposals`, `Delegation`, `Outcomes`
- 경고 배너: Experimental / Research / Non-Production
- 지표: Total Signals, Issue Detection, Active Proposals, Success Rate
- 최근 신호 목록: Reality Feed, Governance Proposals, Issue Detection, Proof of Outcome

### 해석
Bridge는 실제 행동 계층입니다.
AO가 만든 계획을 실행하고, 실행의 결과를 수치/상태/증빙으로 남깁니다.

---

## 3) 서비스 간 차이

## 3.1 문제를 다루는 위치
- **Algora**: 문제를 "발견"하고 "안건화"
- **AO**: 문제를 "토론"하고 "계획으로 결정"
- **Bridge**: 결정을 "실행"하고 "검증"

## 3.2 시간 축 관점
- **Algora**: 상시 감시(continuous sensing)
- **AO**: 배치/사이클 기반 전략화(decision cycles)
- **Bridge**: 실행 트랜잭션/운영 이벤트 중심(action cycles)

## 3.3 위험 통제 관점
- **Algora**: 위험 감지/분류/잠금(게이트)
- **AO**: 리스크-효율 균형 의사결정
- **Bridge**: 실행 실패/검증 실패 대응 및 결과 증빙

---

## 4) 입출력(I/O) 정리

## 4.1 Algora I/O

### 입력(Input)
- 외부/내부 신호(뉴스, GitHub, 시스템 로그, 커뮤니티 이벤트, 온체인 지표 등)
- 수집기 헬스/운영 텔레메트리

### 출력(Output)
- 구조화된 신호/이슈 레코드
- 우선순위, 심각도, 근거 링크
- AO에 전달할 안건 큐

---

## 4.2 AO I/O

### 입력(Input)
- Algora의 신호/이슈
- 토론 컨텍스트(역할별 관점, 정책 기준, 목표)

### 출력(Output)
- 계획(Plan), 제안(Proposal), 프로젝트(Task graph)
- 실행 우선순위와 승인 상태
- Bridge로 전달할 실행 명세

---

## 4.3 Bridge I/O

### 입력(Input)
- AO의 확정 계획/실행 명세
- 실행 대상 환경 정보(연구/실험 환경 포함)

### 출력(Output)
- 실행 상태(성공/실패/진행)
- 위임 결과, 검증 결과, Outcome/Proof
- Algora/AO로 돌아가는 피드백 이벤트

---

## 5) End-to-End 예시 시나리오

1. Algora 수집기가 특정 저장소/커뮤니티에서 이상 신호를 감지
2. Algora가 이슈를 생성하고 우선순위를 부여
3. AO에서 페르소나 에이전트가 토론해 대응 옵션 비교
4. AO가 실행 계획(작업 단위/담당/승인 조건) 확정
5. Bridge가 계획을 실행/위임
6. Bridge가 결과를 Outcome/Proof로 기록
7. 결과가 Algora/AO로 피드백되어 다음 라운드 판단 품질 개선

---

## 6) "Algora에 AO 기능이 포함되나?"에 대한 정리

짧은 답: **UI 상 일부 겹쳐 보일 수 있으나, 핵심 책임은 분리되어 있음**.

- Algora에도 에이전트/거버넌스 화면이 있어 토론적 기능처럼 보일 수 있음
- 하지만 **멀티 페르소나 토론→계획화 파이프라인 중심은 AO**
- Algora는 감지/관제 중심, AO는 설계/의사결정 중심, Bridge는 실행/검증 중심

---

## 7) 실무 적용 시 체크포인트

- 서비스 경계가 흐려지지 않도록 이벤트 스키마를 분리
  - `signal_detected` (Algora)
  - `plan_approved` (AO)
  - `execution_verified` (Bridge)
- 승인 게이트를 명시적으로 모델링
- 실행 결과의 원인/근거 링크를 Outcome에 반드시 남김

---

## 8) Notes

- 본 문서는 대화에서 공유된 서비스 설명과 스크린샷을 기반으로 작성됨
- 운영/아키텍처 세부 스펙은 각 서비스의 최신 문서/저장소 기준으로 추가 검증 권장
