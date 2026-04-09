# Sprint Preflight Runbook

> Orchestrator가 **새 Sprint를 시작하기 직전에** 실행하는 점검 목록. 대부분은 이전 Sprint의
> final report만 보고 넘어가도 되지만, 아래 항목은 매 Sprint마다 기계적으로 확인한다.

## 1. Git 상태

```bash
git rev-parse --is-inside-work-tree   # true 여야 함
git status --short                    # 깨끗해야 함 (이전 Sprint 커밋 완료)
```

- `.git` 없으면: `git init && git add -A && git -c commit.gpgsign=false commit -m "chore: initial scaffold"`
- 이전 Sprint 산출물이 커밋 안 됐으면 먼저 커밋. 미커밋 상태로 다음 Sprint를 시작하면
  실패 시 rollback이 꼬인다.

## 2. 의존성 동기화

이전 Sprint가 `package.json`을 수정했는지 확인:
```bash
git diff HEAD~1 HEAD -- package.json
```

수정됐다면 Orchestrator가 `npm install`을 Bash로 직접 실행한다. Generator 샌드박스
안에서는 네트워크가 막혀 있으므로 위임하면 실패한다.

## 3. Provider health

```bash
codex --version
# 추가 provider가 있으면 각각 --version 체크
```

실패 시 사용자에게 `! codex auth login` 재실행 안내.

## 4. Sprint status 갱신

`.vibe/agent/sprint-status.json`(있으면)에서 `verificationCommands` 배열을 읽어 **Sprint
프롬프트의 "Regression guard" 섹션에 주입**한다. 예:

```markdown
## Regression guard (prior Sprints still pass)

다음 명령은 이번 Sprint 작업 후에도 모두 exit 0으로 통과해야 한다.

| id | command | expect |
|---|---|---|
| tsc | npx tsc --noEmit | exit 0 |
| db-smoke | node scripts/db-smoke.mjs | stdout contains "SMOKE OK" |
| auth-smoke | APP_PASSWORD=... node scripts/auth-smoke.mjs | stdout contains "AUTH SMOKE OK" |
```

## 5. 런타임 제약 리마인더

해당 Sprint가 Next.js middleware, Edge runtime, 네이티브 모듈을 건드린다면
`docs/context/architecture.md`의 "런타임 제약 체크리스트" 항목을 Sprint 프롬프트에
발췌해 포함한다 (Planner 책임).

## 6. Heartbeat 설정 (장시간 Generator 실행용)

Codex가 2분 이상 걸릴 수 있는 Sprint라면, Orchestrator는 `run_in_background: true`로
Bash 호출을 띄우고 **주기적으로 TaskOutput을 polling하지 않는다** (TaskCreate/TaskGet
알림을 기다린다). 대신 사용자에게 "백그라운드 실행 중" 한 줄 상태만 먼저 전달한다.

## 7. 실패 시 escalation

preflight 항목 중 하나라도 실패하면 Sprint를 시작하지 말고 사용자에게 보고:
- 무엇이 실패했는가
- 권장 해결 방법 (터미널 명령 or `!` prefix)
- 진행 vs 중단 선택지
