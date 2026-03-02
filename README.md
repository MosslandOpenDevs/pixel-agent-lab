# Mossland Space Hub Demo

`pixel-agent-lab`은 Mossland 핵심 서비스(Algora, AO, Bridge)의 운영 흐름을 **우주 물류 센터 시각화**로 구현한 데모입니다.  
본 README는 데모의 목적, 서비스 역할, 에이전트 행동, UI 구성, 상태 전이 모델을 공식 문서 형태로 정리합니다.

## 1) 데모 목적

이 데모의 목표는 다음과 같습니다.

- 서비스 간 책임 분리를 한 화면에서 직관적으로 이해
- 역할 기반 에이전트가 실제로 어떤 작업을 수행하는지 시각적으로 확인
- 입력(Input)부터 결과(Output)까지의 처리 흐름을 박스 이동으로 추적

핵심 파이프라인:

`Signals → Issues → Debates/Plans → Execution/Delegation → Outcomes/Proof → Feedback`

---

## 2) 서비스 구조

### Algora (Sense & Detect)

**책임**
- 다중 소스 신호 수집
- 이슈 후보 선별 및 우선순위화
- AO 전달용 컨텍스트 생성

**Input**
- github / rss / social / chain 신호
- risk, category, priority

**Output**
- tagged issue
- AO 토론 대상 컨텍스트

**에이전트 역할**
- **SCAN**: 박스를 수집해 Algora 스테이징 구역으로 이동
- **FILTER**: 필요 여부 판정 (불필요 시 폐기, 필요 시 승인)
- **LOAD**: 승인된 박스를 컨베이어 벨트에 순차 적재

---

### AO (Debate & Plan)

**책임**
- 멀티 에이전트 토론
- 실행 계획 수립
- 라우팅 및 Bridge 위임

**Input**
- Algora 승인 박스
- 우선순위/위험도/출처 컨텍스트

**Output**
- route 결정 (Immediate Action / Monitor / Defer)
- execution draft
- delegated work item

**에이전트 역할**
- **DEBATE**: 대안 제시·반박·수렴
- **PLAN**: 실행 계획 구조화
- **ROUTE**: 최종 라우팅 결정 및 전달

---

### Bridge (Execute & Verify)

**책임**
- 실행 처리
- 트럭 적재
- 결과 검증 및 기록

**Input**
- AO에서 전달된 delegated plan

**Output**
- execution record
- verified outcome

**에이전트 역할**
- **EXECUTE**: 박스를 트럭 슬롯에 적재
- **VERIFY**: 적재 완료 검증 신호 처리

---

## 3) UI 구성

### 좌측 패널
- 운영 통계(Stats)
- 서비스 I/O 상태 (Algora / AO / Bridge 분리 표시)
- 박스 상세 정보(Detail)

### 우측 스테이지
- Algora, AO, Bridge 섹션
- P1/P2/P3 컨베이어 레인
- Bridge 트럭(Express / Monitor / Defer)

### 실시간 상세 추적
- 박스를 클릭하면 해당 박스를 선택 상태로 유지
- 박스 이동 중 phase/status/route/action이 바뀌면 상세 패널 값도 실시간 갱신

---

## 4) 상태 전이 모델

1. 박스 생성 (inbound)
2. Algora SCAN 수집
3. Algora FILTER 판정
   - reject: 폐기 후 종료
   - approve: LOAD 대기
4. Algora LOAD 벨트 적재 (on-belt)
5. AO 토론/계획/라우팅
6. Bridge 실행/적재/검증
7. done

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
