# Mossland Space Hub — Governance Monitor

<!-- opendevs-badges:start -->
[![Lifecycle: Lab](https://img.shields.io/badge/Lifecycle-Lab-eab308?style=flat)](https://links.moss.land/ecosystem-registry.json)
[![CI](https://github.com/MosslandOpenDevs/pixel-agent-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/MosslandOpenDevs/pixel-agent-lab/actions/workflows/ci.yml)
[![Website: monitor.moss.land](https://img.shields.io/badge/Website-monitor.moss.land-2563eb?style=flat)](https://monitor.moss.land/)
[![License: MIT](https://img.shields.io/badge/License-MIT-64748b?style=flat)](https://github.com/MosslandOpenDevs/pixel-agent-lab/blob/main/LICENSE)
<!-- opendevs-badges:end -->

[English](README.md) · **한국어** · [모니터 열기](https://monitor.moss.land)

> **Lifecycle: Lab** — 실험적이며 best-effort로 운영되어 변경되거나 중단될 수 있습니다. [Mossland 생태계 레지스트리](https://links.moss.land/ecosystem-registry.json)의 `monitor` 항목은 2026-09-02 비준된 [MIP-1](https://agora.moss.land/proposals/6a85129f8be190cf5d2ebcc1)을 따릅니다.

Mossland 생태계를 탐색하는 지도와 Algora, AO, Bridge의 픽셀 아트 상세 화면입니다. 레지스트리 메타데이터, 서비스 상태, 거버넌스 데이터를 하나의 정적 웹 앱에서 보여줍니다.

지도는 **등록 여부**, **관측 가능한 범위**, **서비스가 보고한 상태**를 구분합니다. 레지스트리에 등록되었다는 사실만으로 정상 동작을 판단하지 않습니다.

## 모니터 탐색

기본 화면은 **Map**입니다. 레지스트리 항목은 Official, Participation, Developers, Markets, Ecosystem 영역별 궤도에 배치됩니다. 천체에 마우스를 올리면 상세 정보가 표시됩니다. Algora, AO, Bridge를 클릭하면 상세 화면이 열리고, 다른 항목은 해당 목적지로 이동합니다. 모니터 자신의 천체를 클릭하면 지도 중앙으로 돌아옵니다.

| 지도 형태 | 의미 |
| --- | --- |
| 링이 있는 Streaming | 모니터가 데이터 API를 폴링하는 서비스: Algora, AO, Bridge. 이 표시 자체가 정상 상태를 뜻하지는 않습니다. |
| Health-checked | 직접 조회 또는 대체 집계 경로로 얻은 상태 측정값이 있습니다. |
| Listed only | 레지스트리에 등록되어 있지만 상태 측정값은 없습니다. |
| Link or file | 거래소 링크, 소셜 계정, 공개 파일 등의 참조 항목입니다. 서비스 상태 집계에서 제외합니다. |

색상은 `ok`, `degraded`, `down`, 또는 해석 가능한 측정값 없음을 나타냅니다. 보관·폐기된 항목도 흐리게 표시해 지도에 남깁니다. 사이드바에는 레지스트리 항목과 라이프사이클, 서비스 수, API 응답 여부, 거버넌스 수치가 표시됩니다.

**Map / Algora / AO / Bridge** 탭은 데스크톱과 모바일 모두에서 동작합니다. 768px 미만에서는 메뉴 버튼으로 정보 패널을 열고, 768~1100px에서는 패널이 스테이지 위에 배치됩니다. 모바일 기준 너비를 넘나들면 캔버스를 맞추기 위해 앱을 새로 불러옵니다. 모션 감소 설정을 사용하면 지도 회전과 활동 효과가 억제되고 탭 전환 시 카메라 이동 애니메이션이 생략됩니다.

## 거버넌스 상세 화면

세 서비스는 독립적입니다. 단계 이름은 각 서비스의 작업 흐름을 설명하며, 서비스 간 데이터 전달이 구현되어 있다는 뜻은 아닙니다.

| 화면 | 표시 내용 |
| --- | --- |
| **Algora · Sense & Detect** | 세로 신호 벨트, 9개 작업 단계, 에이전트 클러스터. 벨트는 Algora만이 아니라 **세 서비스 모두**에서 가져온 신호를 합친 큐를 사용합니다. |
| **AO · Debate & Plan** | 캐시된 AO 아이디어와 점수, 토론 주제·발췌문, Ideas / Plans / Projects 총계. 아이디어 버블은 계획 전환 7점, 프로젝트 전환 8점 기준을 시각화합니다. |
| **Bridge · Execute & Verify** | L0~L4 작업 흐름, 전문 에이전트, stats의 제안 총계, 에이전트 신뢰도, 최근 결과. 모니터는 전체 제안 목록을 조회하지 않습니다. |

서비스별 역할과 개념적인 거버넌스 루프는 [서비스 개요](docs/mossland-services-overview.md)를 참고하세요. 해당 문서의 서비스 간 데이터 전달 모델은 설계 스케치입니다.

### 데이터 해석 시 알아둘 점

- **푸시 스트림이 아닌 폴링입니다.** 서비스 API는 이전 조회 주기가 끝난 뒤 15초, 상태 조회는 60초, 레지스트리는 10분 후에 갱신합니다. 요청 주기의 제한 시간은 10초입니다.
- **API 응답 여부와 서비스 상태는 다릅니다.** 신호 또는 통계 요청에 성공하면 해당 서비스에 `LIVE` 배지가 붙습니다. 세 서비스 중 하나라도 응답하면 전체 상태는 `LIVE`, 모두 응답하지 않으면 `OFFLINE`, 첫 판단 전에는 `Connecting…`입니다. 생태계 상태 피드는 별도로 상태를 측정합니다.
- **상태는 관측 근거로 판단합니다.** 브라우저가 레지스트리의 `statusUrl`을 직접 조회하며, 직접 측정값이 [city 상태 집계](https://city.moss.land/api/health)보다 우선합니다. HTTP 오류 응답에도 상태가 명시되어 있으면 유지합니다. 비어 있지 않은 문자열 `status`가 없는 5xx 응답(HTML 오류 페이지, 또는 해당 필드가 없는 JSON)은 `down`으로 처리하지만, 네트워크·CORS 실패, 응답을 읽는 도중 끊긴 경우, 유효한 판정이 없는 5xx 이외의 응답만으로는 장애를 단정하지 않습니다. 알 수 없는 상태 문자열도 임의로 바꾸지 않습니다.
- **움직임마다 의미가 다릅니다.** 지도 입자는 새로 수집된 신호에 반응하며 표시 개수에는 제한이 있습니다. 링 스윕은 완료된 상태 조회에 반응합니다. 은하 회전은 장식입니다. 벨트 이동, 단계 전환, Bridge의 제안·증명 애니메이션은 작업 흐름을 설명하며, 실행 추적 기록이나 작업 완료 증거가 아닙니다.
- **최신 조회보다 오래된 스냅샷이 남을 수 있습니다.** 개별 요청이 실패해도 상세 데이터 캐시는 유지되고, 상태 조회가 전부 실패하면 이전 스냅샷을 유지합니다. AO는 캐시된 아이디어를 다시 표시할 수 있습니다. 신뢰도나 성공률이 없을 때, 그리고 서비스가 숫자로 보내지 않은 사이드바 수치는 `—`로 표시하며, 없는 값을 측정된 0으로 해석해서는 안 됩니다. 이 앱은 관측용 뷰어이며 가동 시간이나 실행의 감사 기록이 아닙니다.

## 로컬 실행

**Node.js 22 LTS(22.12 이상) 또는 Node.js 24 LTS**와 npm을 사용하세요. 개발 도구 전체의 지원 범위는 `^22.12.0 || ^24.0.0 || >=26.0.0`입니다. TypeScript, Vite 7, Phaser 3, 순수 DOM/CSS, Vitest를 사용합니다.

```bash
npm ci
npm run dev
```

Vite가 로컬 주소를 출력하며 기본값은 `http://localhost:5173`입니다. 레지스트리와 상태 지도는 공개 교차 출처 엔드포인트를 사용합니다. 거버넌스 상세 데이터를 모두 표시하려면 세 API를 로컬에서 실행하거나 [vite.config.ts](vite.config.ts)의 프록시 대상을 수정하세요.

| 브라우저 경로 | 개발 환경 기본 업스트림 | 조회 데이터 |
| --- | --- | --- |
| `/algora-api/*` | `http://localhost:3201/api/*` | 신호, 이슈, 통계 |
| `/ao-api/*` | `http://localhost:3001/*` | 신호, 상태, 토론, 아이디어, 계획, 프로젝트 |
| `/bridge-api/*` | `http://localhost:3101/api/*` | 신호, 통계, 결과, 에이전트 신뢰도 |

API 서버는 별도 프로젝트이며 이 저장소에서 실행하지 않습니다. 프런트엔드 API 키나 `.env` 파일은 필요하지 않습니다. 레지스트리와 대체 상태 집계 주소는 [ecosystem-client.ts](src/services/ecosystem-client.ts)에 정의되어 있습니다. 직접 조회하는 상태 엔드포인트는 CORS로 브라우저 접근을 허용해야 합니다. 프로덕션에서는 이 주소들 모두 페이지의 Content-Security-Policy `connect-src` 안에 있어야 합니다([배포](#배포) 참고).

### 검증 및 빌드

```bash
npm run typecheck
npm test
npm run build
```

[GitHub Actions](.github/workflows/ci.yml)는 대상 브랜치와 관계없이 모든 풀 리퀘스트와, 병합이 끝난 `main`에 대해 같은 검사를 실행한 뒤 빌드가 올바른 `dist/health.json`을 생성했는지 확인합니다(`node scripts/check-health-json.mjs`). 풀 리퀘스트 없이 푸시한 브랜치는 자동으로 검사하지 않으므로, 초안 풀 리퀘스트를 열거나 워크플로를 직접 실행하세요. 테스트는 상태 응답 해석, 생태계 피드의 판정·병합·폴링, 서비스 데이터 폴러의 연결 상태·폴링 체인·신호 중복 제거, 사이드바와 지도 툴팁이 마크업에 쓰는 값, 그리고 오리진이 빌드를 서빙하는 방식(없는 파일은 404, 디렉터리 목록 없음)을 검증합니다. 해당 코드를 수정할 때는 `npm run test:watch`를 사용할 수 있습니다.

```bash
npm run preview       # 프로덕션 빌드를 로컬에서 확인
# 또는
npm run serve         # dist/를 6300 포트에서 서빙
```

미리보기와 정적 서빙에는 Vite 개발 API 프록시가 **포함되지 않습니다**. 전체 프로덕션 동작을 확인하려면 아래 리버스 프록시 구성이 필요합니다.

## 배포

검토한 커밋을 빌드해 `dist/`를 배포합니다. 배포는 수동이며, GitHub Actions는 변경을 검증하지만 배포하지 않습니다. 정적 파일을 직접 서빙하거나, PM2가 이미 설치된 환경에서 [ecosystem.config.cjs](ecosystem.config.cjs)를 사용할 수 있습니다. 이 설정은 설치된 로컬 `serve` 패키지를 6300 포트에서 실행하므로 시작 전에 `npm ci`를 실행하세요.

앱에는 URL 경로 기반 라우팅이 없습니다. 정적 서버는 JavaScript 리소스를 포함해 **없는 파일에 404를 반환**하며 `index.html`로 대체하지 않고, 디렉터리 내용도 나열하지 않습니다. 빌드 때 `dist/`로 복사되는 [public/serve.json](public/serve.json)이 `serve`를 어떤 방식으로 실행하든 기본 디렉터리 목록을 끕니다. `serve`는 이 파일을 시작할 때 읽으므로, 이 파일이 바뀐 빌드를 배포한 뒤에는 프로세스를 다시 시작하세요. 다른 호스트나 리버스 프록시에서도 두 동작을 유지하세요.

프로덕션 경로 설정은 [deploy/nginx.conf.example](deploy/nginx.conf.example)에 있습니다. 호스트에 맞게 도메인, 인증서, 업스트림 주소, 파일 경로를 조정하세요. 배포에는 다음 구성이 필요합니다.

1. 위 표의 경로 변환을 유지하는 세 개의 동일 출처 API 프록시.
2. 생성된 `health.json`을 반환하는 정확한 `/api/health` 경로.
3. HTML·상태 응답의 재검증과 콘텐츠 해시가 있는 `/assets/` 파일의 immutable 캐싱. Phaser는 별도 청크로 빌드되므로 앱 코드만 바뀐 배포에서는 캐시가 그대로 유지됩니다.
4. 의도한 API 소비자를 위한 CORS. 예제는 허용된 출처를 반사하고, `OPTIONS`를 처리하며, `Origin`과 `Accept-Encoding`에 따라 응답 캐시를 구분합니다. 공개 상태 엔드포인트에는 `Access-Control-Allow-Origin: *`를 사용합니다.
5. 모든 응답의 보안 헤더(`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, HSTS)와 페이지의 `Content-Security-Policy`. nginx는 자체 `add_header`가 있는 location에서 상위 수준의 `add_header`를 상속하지 않으므로, 예제는 location마다 헤더를 포함합니다. 정책의 `connect-src`는 `moss.land`와 그 하위 도메인을 허용하며, [ecosystem-client.ts](src/services/ecosystem-client.ts)의 레지스트리·상태 집계 주소와 모든 레지스트리 `statusUrl`이 여기에 해당합니다. 이 중 하나라도 다른 호스트로 옮기면 먼저 그 호스트를 추가하세요. 개발 환경과 CI는 CSP를 보내지 않으므로 프로덕션에서만 요청이 차단됩니다. 차단된 요청은 장애로 표시되지 않고, 해당 조회만 빠집니다.

배포 후 데스크톱·모바일 너비에서 지도와 세 상세 탭을 열어 확인하세요. API가 JSON을 반환하고, 서비스 응답 여부가 결정되며, 레지스트리·상태 데이터와 브라우저 리소스가 오류 없이 로드되는지 확인합니다. `/api/health`가 빌드한 커밋을 식별하는 JSON을 반환하는지, 존재하지 않는 `/assets/` 파일이 404를 반환하는지, `/assets/` 자체가 파일 목록을 보여 주지 않는지도 검증하세요. public/serve.json을 읽은 `serve`는 404를, `dist/`를 직접 제공하는 nginx는 403을 반환합니다. `curl -sI https://monitor.moss.land/ | grep -i -e x-frame -e content-security`로 보안 헤더를 확인하고, 브라우저 콘솔에 Content Security Policy 위반이 보고되지 않는지도 확인하세요.

### 모니터 상태 엔드포인트

프로덕션 빌드마다 `dist/health.json`을 생성합니다. 리버스 프록시는 이를 [`/api/health`](https://monitor.moss.land/api/health)로 제공합니다.

```json
{
  "status": "ok",
  "service": "monitor",
  "role": "viewer",
  "pipeline": "none",
  "timestamp": "<빌드 시각>",
  "buildTime": "<동일한 빌드 시각>",
  "commit": "<짧은 Git 커밋 해시, Git 체크아웃 밖에서는 null>"
}
```

이 응답은 서빙 중인 프런트엔드 빌드를 식별합니다. 타임스탬프는 **빌드 시각**이며 마지막 상태 조회 시각이나 업스트림 데이터의 최신성이 아닙니다. `status: "ok"`가 Algora, AO, Bridge 또는 생태계 전체의 정상을 보증하지는 않습니다. Vite 개발 모드에는 이 경로가 없으며, 로컬 빌드는 미리보기·정적 서빙의 `/health.json`에서 확인할 수 있습니다.

## 관련 프로젝트와 라이선스

- [Mossland 생태계 레지스트리](https://links.moss.land) — 서비스 검색과 라이프사이클 메타데이터.
- [mossland-pixelops](https://github.com/MosslandOpenDevs/mossland-pixelops) — 관련 프로젝트인 이벤트 소싱 기반 픽셀 아트 운영 지도.
- [MIT 라이선스](LICENSE).
