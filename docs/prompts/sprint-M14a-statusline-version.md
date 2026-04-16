# Sprint M14-A — Statusline 하네스 버전 + 업데이트 힌트

## 목표

`.claude/statusline.sh` + `.claude/statusline.ps1` 의 출력 끝에 하네스 버전 정보를 추가.

### 출력 규칙

기존: `S idle (0/0) | 0m | 0K tok | 0 risks`

**조건별 suffix**:

| 조건 | suffix 예 |
|---|---|
| harnessVersionInstalled 또는 harnessVersion 읽을 수 없음 | 아무것도 추가 안 함 (기존 동작) |
| 설치 버전만 있고 최신 캐시 없음 | ` \| v1.3.1` |
| 설치 버전 >= 최신 캐시 | ` \| v1.3.1` |
| 설치 버전 < 최신 캐시 (업데이트 가능) | ` \| v1.3.1 ⚠ v1.4.0 (/vibe-sync)` |

### 데이터 소스

- **설치 버전**: `.vibe/config.json` 의 `harnessVersionInstalled` (우선) → 없으면 `harnessVersion` → 없으면 skip.
- **최신 캐시**: `.vibe/sync-cache.json` 의 `latestVersion` (vibe-version-check.mjs 가 24h 주기 갱신).
- **비교 함수**: 정수 배열 비교 (1.3.1 → [1,3,1]). normalizeVersion: `v` prefix strip.

두 파일 중 하나라도 없거나 파싱 실패면 그냥 skip — 기존 동작 깨지지 않게.

## 범위

### 1. `.claude/statusline.sh` 수정
현재 inline node 스크립트 안에서:
- `.vibe/config.json` 읽기 (try/catch)
- `.vibe/sync-cache.json` 읽기 (try/catch)
- 위 규칙대로 suffix 생성 → `parts` 배열 끝에 push
- 실패 시 suffix 생략 (기존 출력 그대로)

### 2. `.claude/statusline.ps1` 수정
동일 로직을 PowerShell 로 구현. 같은 조건, 같은 suffix 형식.

### 3. 테스트 `test/statusline.test.ts` 확장

기존 테스트 파일에 다음 케이스 추가 (PowerShell 테스트는 현행 skip 유지):

- `bash statusline shows version suffix when config has harnessVersionInstalled`
- `bash statusline shows update hint when latestVersion > installed`
- `bash statusline omits suffix when config missing`
- `bash statusline omits suffix when config unparseable`

## 범위 밖

- Dashboard / 푸시 알림 (Sprint M14-B)
- Statusline 레이아웃 재설계
- vibe-version-check.mjs 내부 변경 (캐시 포맷은 현재 유지)

## 완료 기준

| 조건 | 명령 |
|---|---|
| tsc 0 errors | `npx tsc --noEmit` |
| npm test pass (기존 + 신규) | `npm test` |
| bash statusline.sh 수동 출력 | `echo '{...mock...}' > /tmp/.vibe/sync-cache.json; bash .claude/statusline.sh` — suffix 확인 |

## Final report
§_common-rules §9.
