# Sprint self-evolution-1 — scripts delegation

## Context

vibe-doctor self_evolution 브랜치 fine-tuning pass. Orchestrator가 문서 변경은 직접 마쳤고,
아래 스크립트 작업만 Generator(너)에게 위임한다. 역할 제약상 Orchestrator는 `.mjs`를 직접
편집하지 않는다.

## 작업 1 — 신규: `scripts/vibe-checkpoint.mjs`

Claude Code PreCompact hook이 호출할 체크포인트 스크립트. 압축 직전에 handoff 상태가
최신인지 기계적으로 검증하고, stale하면 **non-zero exit**로 압축을 block한다. 사용자가
그 시점에 handoff/session-log를 갱신한 뒤 재시도할 수 있다.

### 사양

- 실행: `node scripts/vibe-checkpoint.mjs` (인자 없음). `--json` 플래그 지원.
- Shebang `#!/usr/bin/env node`, ESM, `node:child_process`/`node:fs`/`node:path` 표준만 사용.
- `scripts/vibe-preflight.mjs`의 구조(`record(id, ok, detail)` + 결과 리스트 + text/JSON 출력
  + exit code 1/0)를 **동일한 스타일**로 따를 것. 공통 helper를 새로 만들지는 말고 복붙해도 OK.
- 체크 항목:
  1. **`handoff.exists`** — `.vibe/agent/handoff.md` 존재. 없으면 fail.
  2. **`session-log.exists`** — `.vibe/agent/session-log.md` 존재. 없으면 fail.
  3. **`status.exists`** — `.vibe/agent/sprint-status.json` 존재 + JSON 파싱 성공.
  4. **`handoff.fresh`** — `sprint-status.json`의 `handoff.updatedAt` ISO 문자열과
     `.vibe/agent/handoff.md` mtime을 읽어, **둘 중 더 최근 것**이 "현재 시각 - 30분"보다
     신선하거나, 또는 마지막 git commit 시각(`git log -1 --format=%cI`)보다 신선하면 OK.
     둘 다 실패면 stale → fail with detail "handoff stale: updatedAt=X, mtime=Y, lastCommit=Z".
  5. **`session-log.not-empty`** — `session-log.md`가 `## Entries` 섹션 아래 **최소 1개**의
     `- ` 불릿을 포함. 0개면 fail (압축 직전에 기록할 게 정말 아무것도 없을 리 없다는 경험칙).
  6. **`context.budget`** — `sprint-status.json`의 `handoff.orchestratorContextBudget` 값이
     `low`/`medium`/`high` 중 하나인지 확인. `high`면 경고 출력하지만 **pass**로 처리
     (hook은 진단용이지 강제 차단이 아님 — budget 정보는 사람/Orchestrator에게 보이기만 하면 됨).
- 출력 형식: preflight와 동일. `[OK ]` / `[FAIL]` prefix.
- 마지막에 fail이 하나라도 있으면 프로세스 exit code 1, stderr에 한 줄 안내:
  `"PreCompact blocked — update .vibe/agent/handoff.md + session-log.md then retry."`

### 주의

- Windows 경로: `path.resolve` 사용. 백슬래시 하드코딩 금지.
- `git log` 실패 (첫 커밋 없음 등)는 비치명으로 처리 — `lastCommit`만 건너뛰고 다른 기준으로 평가.
- 파일 I/O 실패 시 fail detail에 error.message 포함.
- JSON mode(`--json`)에서는 `[{id, ok, detail}, ...]` 배열 출력 (preflight와 동일 스키마).

## 작업 2 — 편집: `scripts/vibe-preflight.mjs`

기존 체크 뒤에 **새 체크 1개** 추가: `handoff.stale` — vibe-checkpoint.mjs의 `handoff.fresh`와
동일 로직이지만 **sprint 시작 전** 관점이므로 threshold는 "handoff.updatedAt이 마지막 git
commit보다 오래되면 경고". Fail 대신 **record하되 ok=true + detail에 'warning: ...'** 로
기록(기존 체크 실패 정책을 해치지 않기 위해). 위치는 `sprint.handoff` 체크 바로 아래.

또한 기존 `sprint.handoff` 체크가 `.vibe/agent/session-log.md` 존재도 함께 확인하도록 확장
(없으면 fail). detail에 두 파일 모두 언급.

## 최종 보고 형식

작업 종료 시 다음을 출력:

```
FINAL REPORT
- files created: <path>
- files modified: <path>
- checks added: <count>
- verification: `node scripts/vibe-checkpoint.mjs` → exit code <n>, `node scripts/vibe-preflight.mjs` → exit code <n>
```
