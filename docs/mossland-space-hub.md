# Mossland Space Hub Demo Specification

## 1. 문서 목적

본 문서는 `pixel-agent-lab`의 **Mossland Space Hub 데모 구성 원칙, 서비스 역할, 에이전트 동작, UI 설계 의도**를 공식적으로 정의한다.  
데모의 전체 구조를 이해할 수 있도록, 핵심 서비스 정의(Algora/AO/Bridge의 책임·I/O·연계)를 포함해 정리한다.

---

## 2. 데모 컨셉

### 2.1 핵심 컨셉

데모 컨셉은 다음과 같다.

> **“모스랜드 우주 물류 센터에서, 역할이 부여된 에이전트들이 각 서비스 단계에서 현재 어떤 일을 처리 중인지 직관적으로 보여준다.”**

즉, 추상적인 데이터 파이프라인을 택배 박스 흐름으로 시각화하여:

- 어떤 입력이 들어오고,
- 어떤 판단을 거치며,
- 어떤 실행/검증 결과가 나오는지,

를 한 화면에서 이해하도록 설계한다.

### 2.2 운영 루프

데모는 Mossland 3-레이어 루프를 그대로 반영한다.

`Signals → Issues → Debates/Plans → Execution/Delegation → Outcomes/Proof → Feedback`

- **Algora**: 신호 감지·분류
- **AO**: 토론·계획·라우팅 결정
- **Bridge**: 실행·적재·검증

---

## 3. 서비스별 역할 및 I/O 정의

## 3.1 Algora (Sense & Detect)

### 책임

- 다중 소스 신호를 받아 이슈 후보를 선별
- 우선순위와 처리 필요성을 구분
- AO로 전달 가능한 구조화 입력 생성

### Input

- github / rss / social / chain 등 신호
- 위험도(risk), 카테고리(category), 우선순위(priority)

### Output

- 태깅된 이슈(처리 필요 여부 포함)
- AO 토론 대상 컨텍스트

### 데모 내 에이전트 역할

- **SCAN**: 신규 박스를 수집해 Algora 대기 구역(P2 좌측 스테이징)으로 이동
- **FILTER**: 박스 필요 여부 판단
    - 불필요: 박스를 직접 집어 외부로 폐기(throw out)
    - 필요: 박스를 유지하고 승인 상태로 전환
- **LOAD**: 승인된 박스를 순서대로 컨베이어 벨트에 적재해 AO 단계로 송출

---

## 3.2 AO (Debate & Plan)

### 책임

- 멀티 에이전트 토론 기반 의사결정
- 실행 가능한 계획(plan) 및 라우팅(route) 생성
- Bridge 실행 대상 작업 단위로 변환

### Input

- Algora에서 승인된 이슈 박스
- 우선순위/위험도/출처 컨텍스트

### Output

- 라우팅 결정: Immediate Action / Monitor / Defer
- 실행 계획(Execution Draft)
- Bridge 위임 대상

### 데모 내 에이전트 역할

- **DEBATE**: 대안 제시·반박·논점 수렴
- **PLAN**: 실행 계획 요약 및 작업 형태 명시
- **ROUTE**: 최종 라우팅 선택 및 다음 벨트 방향 결정

### 토론 UI 원칙

- 토론 정보는 상단 팝업으로 표시하되, 캐릭터/핵심 오브젝트를 가리지 않도록 위치·깊이(depth) 최적화
- 라우팅 결정 시 펄스 효과로 결정 지점을 시각적으로 표시

---

## 3.3 Bridge (Execute & Verify)

### 책임

- 계획 실행 및 결과 적재
- 결과 검증(verify/proof)
- Outcome 기록 생성

### Input

- AO에서 전달된 위임 작업(Delegated Plan)

### Output

- 실행 레코드(Execution Record)
- 검증 결과(Verified Outcome)
- 신뢰 축적용 결과 이벤트

### 데모 내 에이전트 역할

- **EXECUTE**: 박스를 트럭 적재 슬롯으로 운반 및 적재
- **VERIFY**: 적재 완료 시 검증 신호/핑(verify ping) 수행

---

## 4. 좌측 패널(HUD) 설계

## 4.1 정보 구조

좌측 패널은 다음 3영역으로 구성한다.

1. **운영 통계(Stats)**
2. **서비스 I/O 상태(Service I/O Status)**
3. **박스 상세(Detail)**

## 4.2 서비스 I/O 표시 방식

Service I/O Status는 Algora/AO/Bridge를 **독립 카드 형태**로 구분 표시한다.

- ALGORA: Input Signals / Output Tagged Issues
- AO: Input Queue / Output Plans + Route 분포
- BRIDGE: Input Delegated / Output Verified

## 4.3 박스 상세 실시간 추적

- 사용자가 박스를 클릭하면 해당 박스를 선택 상태로 유지
- 박스가 이동하며 `phase/status/route/current action`이 바뀔 때, 좌측 상세 패널 값도 **실시간 갱신**
- 클릭 시점 스냅샷이 아닌 **라이브 추적**이 기본 동작

---

## 5. 에이전트-행동 매핑 원칙

데모의 핵심 품질 기준은 다음과 같다.

1. **역할명과 실제 모션이 일치해야 한다.**
    - 예: FILTER가 실제로 박스를 판정·폐기해야 함
2. **단계 전이가 박스 상태로 명확해야 한다.**
    - Algora 승인 → AO 토론 → Bridge 적재/검증
3. **패널보다 스테이지 동작에서 먼저 이해되어야 한다.**
    - 모션/배지/펄스만 봐도 현재 처리 상태를 파악 가능해야 함

---

## 6. 상태 전이 모델 (Demo State Flow)

대표 흐름:

1. 박스 생성(inbound)
2. Algora SCAN 수집
3. Algora FILTER 판정
    - reject → 폐기 후 종료
    - approve → LOAD 대기
4. Algora LOAD 벨트 적재(on-belt)
5. AO debate/planning/routing
6. Bridge loading/executing
7. verify 후 done

이 상태 전이는 시각적 애니메이션과 패널 데이터가 동일하게 반영되어야 한다.
