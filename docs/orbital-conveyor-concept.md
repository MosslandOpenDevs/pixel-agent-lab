# Orbital Conveyor Concept

## Purpose
본 문서는 Mossland의 3개 서비스(**Algora**, **AO**, **Bridge**)를 하나의 일관된 시각적 메타포로 설명하기 위한 콘셉트 문서다.

핵심 목표는 다음과 같다.
- 서비스 역할을 한 화면에서 직관적으로 이해
- 복잡한 내부 로직 대신 상태 흐름 중심으로 전달
- 데모 단계에서 더미 데이터로도 충분히 시연 가능

---

## Core Metaphor: Orbital Conveyor Ops

우주 물류 허브를 배경으로, 하나의 박스가 3개 공정을 거친다.

1. **Algora**: 신호를 태깅해 메인 벨트에 적재
2. **AO**: 토론을 통해 분기 벨트로 라우팅
3. **Bridge**: 실행용 셔틀(트럭)에 적재 후 출고

파이프라인:

`Tag (Algora) → Route (AO) → Dispatch (Bridge)`

---

## Visual Layout (Single Screen)

- 좌측: **Algora Inbound Dock**
- 중앙: **AO Routing Hub**
- 우측: **Bridge Dispatch Bay**

가로로 긴 메인 컨베이어 3줄(우선순위 레인):
- **Top lane (P1)**: Urgent
- **Middle lane (P2)**: Normal
- **Bottom lane (P3)**: Low

> 레인이 위에 있을수록 우선순위가 높다.

---

## Service Behavior

## 1) Algora
### Role
신호 감지 결과를 박스로 변환하고 태그를 부착해 메인 벨트에 올린다.

### Actions
- 박스 생성 (Signal Box)
- 태그 부착
  - source
  - risk
  - category
- 우선순위 레인 배정 (P1/P2/P3)

### Output
`Tagged Box` on Main Conveyor

---

## 2) AO
### Role
메인 벨트 박스에 대해 토론하고 실행 방향을 결정한다.

### Actions
- 박스 일시 정지
- 멀티 에이전트 토론(짧은 단계)
- 분기 벨트 결정
  - Immediate Action Lane
  - Monitor Lane
  - Defer/Archive Lane

### Output
`Routed Box` on Branch Conveyor

---

## 3) Bridge
### Role
분기된 박스를 실행 수단에 적재하고 결과를 기록한다.

### Actions
- 셔틀/트럭 적재
- 출고(Dispatch)
- 결과 스탬프 기록
  - executed
  - monitored
  - deferred

### Output
`Outcome Record`

---

## Dummy Data Schema

## Box Entity
```json
{
  "boxId": "BX-20260301-0001",
  "title": "Unusual governance signal from GitHub",
  "source": "github",
  "category": "dev",
  "risk": "high",
  "priorityLane": "P1",
  "algoraTaggedAt": "2026-03-01T21:10:00+09:00",
  "aoDecision": "Immediate Action Lane",
  "aoReason": "high risk + repeated pattern",
  "bridgeStatus": "executed",
  "bridgeCompletedAt": "2026-03-01T21:13:10+09:00"
}
```

## Lane Rule (Dummy)
- risk = high → P1
- risk = medium → P2
- risk = low → P3

## AO Routing Rule (Dummy)
- P1 + high confidence → Immediate Action Lane
- P2 + uncertain impact → Monitor Lane
- P3 + low urgency → Defer/Archive Lane

---

## Dummy Data Examples

## Example A (Urgent)
- Box: `BX-0001`
- Algora: `source=github`, `risk=high`, lane `P1`
- AO: `Immediate Action Lane`
- Bridge: `executed`

## Example B (Monitor)
- Box: `BX-0002`
- Algora: `source=rss`, `risk=medium`, lane `P2`
- AO: `Monitor Lane`
- Bridge: `monitored`

## Example C (Defer)
- Box: `BX-0003`
- Algora: `source=social`, `risk=low`, lane `P3`
- AO: `Defer/Archive Lane`
- Bridge: `deferred`

---

## Interaction Design

## Default View (Simple)
사용자는 다음만 즉시 본다.
- 박스 위치 (Algora/AO/Bridge 중 어디인지)
- 우선순위 레인 (P1/P2/P3)
- 현재 상태 (tagged/routed/dispatched)

## Detail Popup (On Click)
박스 클릭 시 상세 정보 표시:
1. Signal summary
2. Algora tagging result
3. AO decision reason
4. Bridge execution outcome

> 상세 설명은 팝업에만 표시해 기본 화면의 난잡함을 방지한다.

---

## Clarity Rules
- 동시 이동 박스 수 제한: 최대 3
- 화면 내 총 박스 수 제한: 최대 8
- 에이전트 수 최소화: 서비스당 2~3
- 서비스 컬러 고정:
  - Algora: Mint
  - AO: Blue
  - Bridge: Amber

---

## Expected Communication Outcome
이 콘셉트는 사용자가 아래 질문에 즉시 답할 수 있도록 설계한다.
- “이 박스는 지금 어느 단계에 있나?”
- “왜 이 레인에 있나?”
- “누가 어떤 결정을 했나?”
- “실행됐나, 보류됐나?”

즉, 세 서비스의 역할 차이와 연결 관계를 단일 화면에서 직관적으로 전달한다.
