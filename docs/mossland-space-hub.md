# Mossland Space Hub

## 목적
본 문서는 Mossland의 3개 서비스(**Algora**, **AO**, **Bridge**)를 하나의 일관된 시각적 메타포로 설명하기 위한 콘셉트 문서입니다.

핵심 목표:
- 서비스 역할을 한 화면에서 직관적으로 이해
- 복잡한 내부 로직 대신 상태 흐름 중심으로 전달
- 더미 데이터만으로도 데모 시연 가능

---

## 핵심 메타포: 우주 물류 컨베이어 운영

우주 물류 허브에서 하나의 박스(**Signal Box**)가 3단계를 거칩니다.

1. **Algora**: 들어온 박스에 태그를 붙여 메인 벨트에 올림
2. **AO**: 토론을 통해 박스를 분기 벨트로 라우팅
3. **Bridge**: 라우팅된 박스를 출고 차량에 적재해 발송

파이프라인:

`Tag (Algora) → Route (AO) → Dispatch (Bridge)`

---

## 화면 구성 (단일 화면)

- 좌측: **Algora Inbound Dock**
- 중앙: **AO Routing Hub**
- 우측: **Bridge Dispatch Bay**

메인 컨베이어는 가로 3줄 우선순위 레인으로 구성:
- **Top lane (P1)**: 긴급
- **Middle lane (P2)**: 보통
- **Bottom lane (P3)**: 낮음

> 위 레인일수록 우선순위가 높습니다.

---

## 서비스별 동작

## 1) Algora
### 역할
감지된 신호를 박스로 만들고 태그를 붙여 메인 벨트에 적재합니다.

### 동작
- Signal Box 생성
- 태그 부착:
  - source
  - risk
  - category
- 우선순위 레인 배정(P1/P2/P3)

### 출력
`Tagged Box` on Main Conveyor

---

## 2) AO
### 역할
메인 벨트에서 온 박스를 토론하고 실행 방향을 결정합니다.

### 동작
- 박스 일시 정지
- 짧은 멀티 에이전트 토론
- 분기 벨트 결정:
  - Immediate Action Lane
  - Monitor Lane
  - Defer/Archive Lane

### 출력
`Routed Box` on Branch Conveyor

---

## 3) Bridge
### 역할
분기된 박스를 실행 차량에 적재하고 결과를 기록합니다.

### 동작
- 셔틀/트럭 적재
- 출고(Dispatch)
- 결과 스탬프 기록:
  - executed
  - monitored
  - deferred

### 출력
`Outcome Record`

---

## 더미 데이터 스키마

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

## 레인 배정 규칙 (Dummy)
- risk = high → P1
- risk = medium → P2
- risk = low → P3

## AO 라우팅 규칙 (Dummy)
- P1 + high confidence → Immediate Action Lane
- P2 + uncertain impact → Monitor Lane
- P3 + low urgency → Defer/Archive Lane

---

## 더미 데이터 예시

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

## 인터랙션 설계

## 기본 화면 (Simple)
항상 보이는 정보:
- 박스 위치(Algora / AO / Bridge)
- 우선순위 레인(P1 / P2 / P3)
- 현재 상태(tagged / routed / dispatched)

## 상세 팝업 (클릭 시)
박스 클릭 시 표시:
1. Signal summary
2. Algora tagging result
3. AO decision reason
4. Bridge execution outcome

> 기본 화면은 단순하게 유지하고, 디테일은 팝업으로 분리합니다.

---

## 가독성 규칙
- 동시에 움직이는 박스 최대 3개
- 화면 내 전체 박스 최대 8개
- 에이전트 수: 서비스당 2~3명
- 서비스 컬러 고정:
  - Algora: Mint
  - AO: Blue
  - Bridge: Amber

---

## 기대 효과
이 콘셉트는 사용자가 즉시 다음을 이해하도록 설계됩니다.
- 이 박스는 지금 어느 단계인가?
- 왜 이 레인에 배치됐는가?
- 어떤 판단이 내려졌는가?
- 실행되었는가, 모니터링 중인가, 보류되었는가?

즉, 세 서비스의 역할 분리와 연결 관계를 한 화면에서 직관적으로 전달합니다.
