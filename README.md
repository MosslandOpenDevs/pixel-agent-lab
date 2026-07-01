# Mossland Space Hub Demo

`pixel-agent-lab`은 Mossland 핵심 서비스(Algora, AO, Bridge)의 운영 흐름을 **우주 물류 센터 시각화**로 구현한 데모입니다.  
본 README는 데모의 목적, 서비스 역할, 에이전트 행동, UI 구성, 상태 전이 모델을 공식 문서 형태로 정리합니다.

https://github.com/user-attachments/assets/1e3ab6cb-41f0-4bff-a227-a6b4505b2c3e

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
- 연결 상태(LIVE / OFFLINE) — 서비스별 도달 가능 여부를 개별 반영
- 운영 통계(Stats): 신호 큐, Algora 이슈, AO 토론 수
- 서비스 I/O 상태 (Algora / AO / Bridge 분리 표시, 서비스별 LIVE 배지)
- About: 시각화 범례

### 우측 스테이지
- **Algora**: 세로 컨베이어 벨트 + 9단계 파이프라인 + 11개 에이전트 클러스터 아크
- **AO**: 가로 컨베이어 벨트(아이디어 → score 임계값에 따라 Plan/Project로 전환) + 토론(Debate) 카드 + 에이전트 링(Diverge/Converge/Plan)
- **Bridge**: 가로 컨베이어 벨트(L0→L4) + 5개 전문 에이전트 + Trust & Outcomes 패널
- 하단 스트립: DataBridge 집계 상태(연결/큐/폴링 주기)

### 모바일
- 화면 하단 탭(Algora / AO / Bridge)으로 한 번에 한 서비스 구역을 확대해서 표시
- 좌상단 ☰ 버튼으로 좌측 패널을 오버레이로 토글

### 실시간 데이터
- 세 서비스(Algora/AO/Bridge)를 각각 15초 주기로 폴링
- 벨트 위의 박스는 실제 신호/아이디어/제안 데이터를 시각화한 것

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

정적 서빙(빌드 결과물):

```bash
npm run serve          # serve dist -l 6300 -s
# 또는 PM2
pm2 start ecosystem.config.cjs
```

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
