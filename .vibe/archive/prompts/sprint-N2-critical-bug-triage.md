# Sprint: N2 — critical bug triage + production self-test (iter-3 priority c)

> 공용 규칙은 `.vibe/agent/_common-rules.md` 준수 (§1 샌드박스 우회 금지 / §2 의존성
> 설치 금지 / §5 범위 준수 / §9 Final report 형식 / §14 Wiring Integration Checklist).
> 본 프롬프트는 그 위에 **iter-3 제약** 과 **N2 고유 스펙** 을 얹는다.

## 직전 Sprint 결과 요약 (Orchestrator 첨부, 2~3 lines)

- iter-3 N1 (commit `50ede64`) — CLAUDE.md rule audit diet 292→248 lines, `scripts/vibe-rule-audit.mjs` `--scan-transcripts` 확장, `.vibe/audit/iter-3/rule-audit-report.md` + `rules-deleted.md` 산출.
- 현재 상태: 199 tests pass / 0 fail / 1 skip, `npx tsc --noEmit` 0 errors, `.vibe/config.json.harnessVersion = "1.4.0"`, annotated tag `v1.4.0` 이미 존재 (M-audit 시점 생성).
- iter-3 누적 delta budget: N1 이 net negative (코드 add 140 / delete 640 중) 소비 — N2 허용 추가 `add ≤ +150, delete ~0, net ≤ +150`.

---

## Context & why

**Iter-3 priority 는 a > b > c > d** 이다. N2 는 `c` = **critical bug triage + auto-tag production self-test**. 목적은 세 가지 운영 bug 를 닫고, iter-2 에서 설계만 하고 실전 검증이 없던 **harness-auto-tag** 를 이번 Sprint commit 자체로 **self-test** 하는 것.

### D1 — `vibe-sprint-commit.mjs.collectArchivedPromptFiles` filter bug

- 증상: Sprint 완료 시 `.vibe/archive/prompts/<sprintId>.md` (suffix 없는 파일명) 이 git stage 누락. Orchestrator 가 매번 수동 `git add` + amend 를 해야 한다.
- 근거: `scripts/vibe-sprint-commit.mjs:193` 의 필터 `entry.startsWith(\`${sprintId}-\`)` 는 sprintId = `sprint-M-audit` + 아카이브 파일명 = `sprint-M-audit.md` 조합에서 **false** (파일명이 `sprint-M-audit-` prefix 가 아니라 `sprint-M-audit.` 로 시작).
- 실측: `ls .vibe/archive/prompts/sprint-M-audit.md` 존재 확인 가능 (N1 Planner 참고 자료로 남아있음).

### D2 — artificial `v1.4.1` bump (auto-tag production self-test)

- 증상: iter-2 M-harness-gates 에서 `createHarnessVersionTag()` 구현 (`scripts/vibe-sprint-commit.mjs:348`) 을 마쳤으나, 실제 **production bump** 는 test 픽스처에서만 발생 (`test/sprint-commit.test.ts:294`). 실제 repo 에서 델타 감지 → tag 생성 경로가 돌아본 적이 없다.
- 목표: N2 Sprint 커밋 경로로 harnessVersion `1.4.0` → `1.4.1` 을 **실 production bump** 하여 annotated tag `v1.4.1` 이 자동 생성되는지 검증. 실패 시 bug 로 간주하고 fix 를 N2 내 추가 (Orchestrator 판단 후 재위임).

### D3 — `run-codex.{sh,cmd}` auto status-tick hook missing

- 증상: iter-2 전 세션 (`.vibe/agent/tokens.json.elapsedSeconds = 0`, `cumulativeTokens = 0`) 에서 `vibe-status-tick.mjs` 가 0회 호출됨. statusline 의 time / token counter 가 완전히 정지. MD 에 "Agent 호출 전후 tokens/시간 기록" 룰 있지만 script-gate 가 없어 Orchestrator 와 Codex 가 매 Sprint 잊는다.
- 근거: `scripts/run-codex.sh:348` 이 `[run-codex] total attempts=X elapsed=Ys tokens=Z` 형식의 final 라인을 이미 stderr 에 쓰고 있어 parse 용 hook point 가 자연스럽게 존재. CLI `node scripts/vibe-status-tick.mjs --add-tokens <N> --sprint <id> [--elapsed-start <ISO>]` 은 `scripts/vibe-status-tick.mjs:7` 시그니처로 이미 노출되어 있다.

### D4 — dogfood8 인계 프롬프트 신규 작성

- dogfood8 은 iter-3 post-acceptance 실사용. 사용자가 dogfood8 세션 첫 메시지로 copy-paste 할 **iter-3 인계 프롬프트** 가 아직 없다. `/vibe-review` 는 dogfood8 종료 후에 돌아갈 뿐이므로, 사전 전달용 브리핑 파일이 필요하다.

### D5 (optional) — iter-3 audit artifacts 최신화

- N1 에서 만든 `.vibe/audit/iter-3/rule-audit-report.md` 끝에 **N2 completion addendum** section 1개 append (auto-tag self-test 결과 + bug fix 3종 summary). Optional — timebox 초과 시 skip.

---

## Prerequisites (already installed / ready)

- Zod v3 runtime dep (iter-2 M-audit).
- `scripts/vibe-sprint-commit.mjs` + `createHarnessVersionTag` 로직 (iter-2 M-harness-gates).
- `scripts/vibe-status-tick.mjs` CLI — 본 Sprint 가 확장하지 않고 **호출자만 추가**.
- `scripts/run-codex.sh` + `scripts/run-codex.cmd` (iter-2 M2 + 후속 patches).
- `test/sprint-commit.test.ts` / `test/run-codex-wrapper.test.ts` — 확장 대상.
- `.vibe/config.json.harnessVersion = "1.4.0"` + annotated tag `v1.4.0` 이미 존재 (N2 의 bump target = `1.4.1`).
- `.vibe/archive/prompts/sprint-M-audit.md` 실재 — D1 회귀 테스트 고정 픽스처로 사용 가능.
- `.vibe/audit/iter-3/rule-audit-report.md` + `rules-deleted.md` (N1 산출물, read-only 참조).

---

## Deliverables (D1 ~ D4 + D5 optional)

### D1 — archive prompt filter 수정

**파일**: `scripts/vibe-sprint-commit.mjs` (수정), `test/sprint-commit.test.ts` (확장).

**변경 의도**:
- `collectArchivedPromptFiles(sprintId)` 이 아래 **세 가지 파일명 패턴** 을 모두 매치해야 한다:
  1. `${sprintId}.md` (suffix 없음) — 현재 버그로 누락되는 케이스.
  2. `${sprintId}-<anything>.md` (suffix 있음) — 기존에 이미 동작.
  3. `.md` 확장자 아닌 파일은 여전히 제외.
- 매칭 키 = 파일명에서 `.md` 확장자만 제거한 base name. `base === sprintId || base.startsWith(\`${sprintId}-\`)` 두 조건 OR.
- 대소문자 구분 그대로 유지 (기존 동작 존중). sprintId 에 regex meta 문자가 들어오더라도 literal 비교이므로 escape 불필요.

**Non-goals**:
- 다른 sprintId prefix collision 방지 (예: `sprint-M` 이 `sprint-M1.md` 를 삼키는 문제) — 이미 `startsWith(`${sprintId}-`)` 가 delimiter 역할이라 본 수정으로 regress 안 함. 본 Sprint 는 suffix-less 만 추가로 포착.

**회귀 테스트 (≥2 cases)**:
- `test/sprint-commit.test.ts` 에 신규 `describe('collectArchivedPromptFiles', ...)` 블록 추가.
  - Case A (suffix-less): sprintId = `sprint-example`, 아카이브에 `sprint-example.md` + `sprint-example-plan.md` 두 파일. 두 파일 모두 결과에 포함되어야 한다.
  - Case B (prefix collision 방어): sprintId = `sprint-M`, 아카이브에 `sprint-M.md` + `sprint-M1.md` + `sprint-M-audit.md`. 결과는 `sprint-M.md` + `sprint-M-audit.md` 만 포함, `sprint-M1.md` 는 제외.
- `scripts/vibe-sprint-commit.mjs` 에서 `collectArchivedPromptFiles` 를 `export function` 으로 노출 (이미 `inlineExtendLastSprintScope` 가 동일 패턴으로 export 되어 있음 → 같은 스타일). 테스트는 `pathToFileURL(...).href` dynamic import 로 로드.
- 결과 반환 경로는 POSIX 형태 (`normalizePosix`) 유지.

### D2 — harnessVersion 1.4.0 → 1.4.1 production bump

**파일**: `.vibe/config.json` (수정), `docs/release/v1.4.1.md` (신규).

**변경 의도**:
- `.vibe/config.json.harnessVersion` 을 `"1.4.1"` 로 변경.
- `.vibe/config.json.harnessVersionInstalled` 도 **동일하게** `"1.4.1"` 로 변경 (downstream sync drift 방지, 기존 `harnessVersionInstalled` semantic 은 "이 repo 자기 자신의 설치 버전" 으로 여기서는 upstream = installed).
- `docs/release/v1.4.1.md` 신규: `# v1.4.1 (<N2 커밋일 ISO date>)` 제목 + `## iter-3 N2 — critical bug triage` section. 본문 4~8 bullet 로 D1/D3/D4 요약. `## Notes` subsection 에 "auto-tag self-test succeeded (tag v1.4.1 auto-created by vibe-sprint-commit)" 1줄 또는 실패 기록.
- `.vibe/config.json` 포맷은 기존 2-space indent + trailing newline 유지 (`test/sprint-commit.test.ts` writeJson helper 스타일과 동일).

**자동 tag 생성 기대 동작**:
- `node scripts/vibe-sprint-commit.mjs sprint-N2-critical-bug-triage passed` 실행 시:
  - `git commit` 성공 후 `createHarnessVersionTag()` 가 호출되어 `HEAD:.vibe/config.json.harnessVersion = 1.4.1` vs `HEAD~1:.vibe/config.json.harnessVersion = 1.4.0` 을 비교.
  - `1.4.1 > 1.4.0` 이므로 `git tag -a v1.4.1 -m "auto-tag from sprint-commit sprint-N2-critical-bug-triage"` 실행.
  - stdout 에 `[vibe-sprint-commit] harness-tag: created v1.4.1 (prev=1.4.0)` 출력.
- Codex 는 `--push-tag` 를 **호출하지 않는다** (push 권한 없음, Orchestrator 가 post-Sprint 수동 push).
- **검증 CLI**: `git tag -l "v1.4.1"` 가 `v1.4.1` 출력하면 통과. Final report 에 이 CLI 출력 포함.

**실패 시 복구 절차** (프롬프트 내 기록용):
- 만약 tag 자동 생성이 실패 (stdout 에 `harness-tag: FAILED ...` 출력) → Codex 는 **수동 tag 를 절대 생성하지 않는다** (실패 원인 조사가 Orchestrator 작업). Final report 의 Risks 섹션에 FAILED 라인 전체 copy 및 exit-code 기록.
- Tag 이미 존재 (`harness-tag: skipped (tag v1.4.1 already exists)`) → 이전 세션에서 수동 생성된 경우. Final report Risks 섹션에 기록, bump 는 완료된 것으로 간주.

### D3 — run-codex auto status-tick hook

**파일**: `scripts/run-codex.sh` (수정), `scripts/run-codex.cmd` (수정), `test/run-codex-wrapper.test.ts` (확장).

#### D3-a: `run-codex.sh` 변경

**변경 의도**:
- Success path (exit code 0 branch, `scripts/run-codex.sh:345` 근방) 에서 `[run-codex] total attempts=...` line 출력 **직후** 자동으로 `vibe-status-tick.mjs` CLI 를 호출한다.
- 실패 path (`scripts/run-codex.sh:352` giving up) 에서는 **호출하지 않는다** (실패한 attempt 의 token count 는 신뢰할 수 없다).

**Sprint ID 해결 순서** (먼저 성공한 것 채택):
1. 환경 변수 `$VIBE_SPRINT_ID` 가 비어있지 않으면 사용.
2. `.vibe/agent/sprint-status.json` 의 `handoff.currentSprintId` 가 `idle` 외 값이면 사용 (`node -e` 1줄 또는 `grep/sed` 조합 — bash 환경 제약 고려하여 **node 사용 금지 없이 grep/sed 로만** 추출. jq 의존 금지).
3. 위 둘 다 실패 → silent skip (status-tick 호출 자체 생략, stderr 에 warning 1줄).

**Token 추출**:
- 현재 `run-codex.sh:160` `token_suffix()` 가 `tail -n 10 $attempt_output | grep -Eio 'tokens?[: ]+[0-9]+'` 으로 마지막 token 값을 파싱. D3 는 **같은 값** 을 재추출해서 `--add-tokens <N>` 로 넘긴다. 공백 결과 (token 없음) → status-tick CLI 호출 생략.

**Elapsed start 처리**:
- `start_ts` (scripts/run-codex.sh:324) 는 epoch 초 정수. status-tick CLI 는 **ISO-8601** 만 허용 (`scripts/vibe-status-tick.mjs:66`). 변환 공식: `date -u -d "@$start_ts" +"%Y-%m-%dT%H:%M:%SZ"` (GNU date) 또는 BSD/macOS fallback `date -u -r "$start_ts" +"%Y-%m-%dT%H:%M:%SZ"`. Git Bash on Windows 는 GNU 계열이라 `-d "@..."` 형식 동작. 실패 시 `--elapsed-start` 인자 생략하고 `--add-tokens` 만 전달 (partial update 허용).

**호출 계약**:
```
node scripts/vibe-status-tick.mjs \
  --add-tokens <tokens_int> \
  --sprint <sprint_id_string> \
  --elapsed-start <iso_utc>
```
- exit code 무관하게 parent `run-codex.sh` 의 최종 exit code (0) 를 보존 (status-tick 실패가 Codex 성공을 뒤집지 않는다). stderr 에 `[run-codex] status-tick: skipped reason=<...>` 또는 `[run-codex] status-tick: ticked tokens=<N> sprint=<id>` 1줄 출력.

**Crash guard**:
- `set -e` 환경에서 status-tick 실패가 parent 를 terminate 하지 않도록 sub-shell + `|| true` 패턴 사용. 모든 parsing 실패는 stderr warning 으로만.

#### D3-b: `run-codex.cmd` 변경

- `.cmd` wrapper 는 현재 token 파싱을 **전혀** 하지 않음 (`scripts/run-codex.cmd:38`). 최소 버전 구현:
  - `codex exec` 종료 후 `ERRORLEVEL == 0` 일 때 `node scripts/vibe-status-tick.mjs --elapsed-start <iso>` 호출 (token 없어도 elapsed 는 기록 가치 있음).
  - Sprint ID 해결은 `%VIBE_SPRINT_ID%` 만 사용 (cmd 에서 sprint-status.json grep 은 비용 대비 복잡). 없으면 skip.
  - ISO 생성: `powershell -NoProfile -Command "(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')"` 또는 `wmic os get LocalDateTime` 후 substring. **둘 중 powershell 선호** (이미 repo 다른 스크립트에서 사용 패턴 존재).
  - 실패 시 silent (stderr warning 1줄, 종료 코드 0 유지).

#### D3-c: 테스트 확장

**파일**: `test/run-codex-wrapper.test.ts`.

**신규 케이스**:
- `it('invokes status-tick after successful codex run when VIBE_SPRINT_ID is set', ...)`.
- 접근 방식: shell stub `bin/` 안에 `codex` stub + **`node` stub (간단한 wrapper script)** 을 배치하는 대신, **status-tick 호출 관측** 을 위해 테스트용 임시 `scripts/vibe-status-tick.mjs` override 가 아닌 — `env.PATH` 에 `node` stub 을 넣어 인자 capture 하기도 복잡하다. 대안:
  - 실제 `scripts/vibe-status-tick.mjs` 를 그대로 실행하되, `cwd` 를 `makeTempDir` 로 지정해 `.vibe/agent/tokens.json` 이 temp 에 생성되도록 한다.
  - assertion: `tokens.json` 이 존재하고 `sprintTokens[<sprintId>] > 0` 이어야 하며 `elapsedSeconds >= 0`.
- `it('skips status-tick when VIBE_SPRINT_ID is unset and sprint-status handoff is idle', ...)` — 유사 구조, tokens.json 이 만들어지지 않음 OR `sprintTokens` 가 비어있음 확인.
- 기존 retry/health 테스트는 status-tick 호출 경로를 건드리지 않도록, status-tick 이 silent skip 되는 환경 (VIBE_SPRINT_ID 없음 + sprint-status.json 없음) 에서 돌도록 유지. 필요하면 기존 테스트의 `env` 에 `VIBE_SPRINT_ID=''` 명시.

**Cross-platform skip 주석**:
- `run-codex.cmd` 신규 테스트 케이스 1개 추가하되 `{ skip: process.platform !== 'win32' }` guard. cmd 는 `VIBE_SPRINT_ID` 세팅 시 tokens.json 이 `elapsedSeconds >= 0` 로 생성되는지만 확인 (token 파싱은 cmd 에 없음).

### D4 — dogfood8 handoff prompt

**파일**: `.vibe/audit/iter-3/dogfood8-handoff-prompt.md` (신규).

**구조 및 필수 섹션** (markdown, 한글 작성 허용, 줄 수 120~200):

1. `# dogfood8 인계 — iter-3 완료 브리핑` (H1 제목).
2. `## iter-3 요약` — 3 Sprint 완료 (N1 rule-audit-diet, N2 critical-bug-triage, N3 TBD), harness 1.4.0 → 1.4.1 승격, CLAUDE.md 292→248 lines, tests 199 pass / 0 fail / 1 skip. N3 가 아직 미착수면 그 사실 명시.
3. `## 자동 tag self-test 결과` — `git tag -l v1.4.1` 결과 전체 출력 + `[vibe-sprint-commit] harness-tag: created v1.4.1 (prev=1.4.0)` 라인 포함 여부. 실패 시 원인 기록.
4. `## dogfood8 진입 체크리스트` — 5~8 items:
   - `node scripts/vibe-preflight.mjs` green 확인.
   - `npm run vibe:sync --dry-run` 실행 → v1.4.0 또는 v1.4.1 tag 기반으로 manifest pull 이 정상인지 검증.
   - `.vibe/audit/iter-3/rules-deleted.md` 의 4개 cluster (two-tier-audit-convention / 실패-에스컬레이션 / 항상-지킬-것 / 필요할-때만-읽을-문서) 중 dogfood8 실행 도중 마찰을 일으키는 게 있는지 incident 기록.
   - 새 `mode: "human"` default 가 `/vibe-init` Step 1-0 에서 제시되는지 (N3 에서 다룸 — N3 미완료 시 "해당 없음" 표기).
   - `scripts/vibe-status-tick.mjs` 가 Codex 호출마다 자동으로 tokens.json 을 갱신하는지 1회 이상 육안 확인.
5. `## 이상 발견 시 feedback template` — `/vibe-review` 가 append 할 JSON schema skeleton. 필수 key: `iteration`, `sprint`, `signal_type` (agent/token/user), `priority_score` (10*agent + 5*token + 1*user), `recommended_approach` (script-wrapper > md-rule > config-default > user-action).
6. `## 복원 가이드` — iter-3 가 과도하게 trim 했다고 판단되면 `.vibe/audit/iter-3/rules-deleted.md` 의 `restoration_decision: pending` → `restoration_decision: restored(<dogfood8 commit sha>)` 로 업데이트 후 해당 `original_text:` 를 CLAUDE.md 에 재삽입하는 절차 5-step.

**Non-goals**:
- dogfood8 저장소 생성 / 초기화 절차는 본 파일에서 언급 금지 (사용자가 알고 있음).
- 구체적 UX copy 나 UI 관련 지시 금지.

### D5 (optional) — audit artifact addendum

- `.vibe/audit/iter-3/rule-audit-report.md` 끝에 `## iter-3 N2 completion addendum` section 추가 (8~15 lines). 내용: D1/D3 bug fix 1줄씩 + auto-tag self-test 결과 1줄 + dogfood8 handoff path 1줄.
- Skip 해도 Acceptance 에 영향 없음. D1~D4 완료 후 시간 여유가 있을 때만.

---

## File-level spec

| File | Action | Expected LOC delta | Rationale |
|---|---|---|---|
| `scripts/vibe-sprint-commit.mjs` | modify | +6 ~ +10 / -2 | `collectArchivedPromptFiles` 필터 확장 + `export`. |
| `scripts/run-codex.sh` | modify | +35 ~ +55 / 0 | success branch 에 status-tick hook block 추가. |
| `scripts/run-codex.cmd` | modify | +12 ~ +20 / 0 | success branch minimal status-tick. |
| `.vibe/config.json` | modify | +2 / -2 | harnessVersion 1.4.0 → 1.4.1 + harnessVersionInstalled 동일. |
| `docs/release/v1.4.1.md` | new | +20 ~ +35 | release notes. |
| `.vibe/audit/iter-3/dogfood8-handoff-prompt.md` | new | +80 ~ +140 | dogfood8 브리핑 파일. |
| `test/sprint-commit.test.ts` | modify | +45 ~ +70 | D1 회귀 테스트 2 cases + helper import 업데이트. |
| `test/run-codex-wrapper.test.ts` | modify | +45 ~ +75 | D3 status-tick hook 테스트 2~3 cases. |
| `.vibe/audit/iter-3/rule-audit-report.md` | modify (D5 optional) | +8 ~ +15 | addendum. |

**절대 생성/수정 금지**:
- `scripts/vibe-status-tick.mjs` — 호출만, 수정 금지.
- `CLAUDE.md` — N2 는 rule 변경 없음. 오타/헤딩 보정조차 금지 (N1 diet 결과를 존중).
- `.claude/**` — 본 Sprint 는 agent skill 변경 없음.
- 새 `.mjs` 스크립트 — **0 new scripts** iter-3 제약 준수.
- `dogfood6` / `dogfood7` / `dogfood8` 실제 저장소 — read-only (경로 문자열만 언급).
- `.vibe/audit/iter-3/rules-deleted.md` — N1 산출 ledger, N2 touch 금지.

---

## Acceptance criteria

1. **Type check**: `npx tsc --noEmit` exit 0, zero errors.
2. **Test suite**: `npm test` 전체 통과. 신규 테스트 **최소 3개 pass** (D1 suffix-less + D1 prefix-collision + D3 status-tick success, D3 skip 케이스 및 cmd 케이스는 bonus).
3. **Auto-tag self-test**: `git tag -l "v1.4.1"` 이 정확히 `v1.4.1` 출력. commit 메시지에 auto-tag 관련 stdout (`[vibe-sprint-commit] harness-tag: created v1.4.1 (prev=1.4.0)`) 이 Final report 에 인용되어 있어야 함.
4. **Config consistency**: `.vibe/config.json.harnessVersion === "1.4.1"` && `.vibe/config.json.harnessVersionInstalled === "1.4.1"`.
5. **Dogfood8 handoff**: `.vibe/audit/iter-3/dogfood8-handoff-prompt.md` 파일 존재, 6개 required section 모두 포함.
6. **Archive staging self-test**: N2 Sprint commit 이 (D1 fix 덕분에) `.vibe/archive/prompts/sprint-N2-critical-bug-triage.md` 를 자동 stage. `git show --stat HEAD` 에 이 파일이 포함되면 통과. **Orchestrator manual amend 불필요** — 이게 D1 의 실전 검증.
7. **Release notes**: `docs/release/v1.4.1.md` 존재, `# v1.4.1` heading + iter-3 N2 section 포함.
8. **LOC budget**: `git diff --cached --numstat` 기준 (또는 `git show --stat HEAD`) **production code add ≤ 150**. 테스트 파일은 별도 카운트로 자유.
9. **Stop-gate**: `npm run vibe:qa --silent` 가 grey 또는 green (blocking error 없음).

---

## Wiring Integration Checklist (mandatory per §14)

| Checkpoint | Status | Note |
|---|---|---|
| W1 CLAUDE.md hook table | n/a | N2 는 신규 script 없음 (기존 `run-codex.sh` + `vibe-sprint-commit.mjs` 확장만). |
| W2 Trigger matrix entry | n/a | 트리거 변경 없음. |
| W3 Skill registry | n/a | 스킬 추가/수정 없음. |
| W4 Preflight / handoff reference | n/a | preflight 계약 변경 없음. |
| W5 Session-log tag vocabulary | n/a | 기존 `[decision]` 태그만 사용. |
| W6 sync-manifest harness[] | n/a | 신규 파일은 audit/release 영역으로 manifest 대상 아님 (검증: `scripts/vibe-sync-manifest.mjs` 또는 `.vibe/sync-manifest.json` 확인 후 touch 불필요). |
| W7 README / docs bootstrap | n/a | 부트스트랩 경로 영향 없음. |
| W8 MCP / agent config | n/a | |
| W9 Schema migration (`migrations/`) | n/a | schema 변화 없음. |
| W10 Release notes | **touched** | `docs/release/v1.4.1.md` 신규 — D1/D3/D4 + auto-tag self-test 결과 기록. |
| W11 Example fixtures | n/a | |
| W12 Test regression | **touched** | `test/sprint-commit.test.ts` + `test/run-codex-wrapper.test.ts` 확장 (D1, D3). |
| W13 harness-gaps.md | n/a | N1 에서 rule coverage 갱신 완료, N2 는 bug fix 이므로 gap 목록 변경 없음. |
| Self-test (auto-tag) | **touched** | `git tag -l v1.4.1` 결과 + `harness-tag: created ...` stdout 인용. |

Final report 에 위 테이블을 그대로 포함. `touched` 항목은 **어느 파일의 어느 부분이 변경됐는지** 1~2줄로 기술.

---

## Non-goals (N2 scope 밖 — 시도 금지)

- **Progressive MD 재구조화** (charter/extensions split) → N3 예정.
- **`mode: "human" | "agent"` flag** 도입 → N3 예정.
- **dogfood8 저장소 초기화 / `/vibe-init` 자동 실행** → 사용자 manual 작업.
- **`dogfood6` / `dogfood7` 저장소 수정** → read-only (path 문자열만 handoff.md 에 기록).
- **새 `.mjs` script** 추가 금지. `vibe-status-tick.mjs` 는 호출만, 내부 로직 수정 금지.
- **CLAUDE.md baseline line count 하드코딩 금지**. 필요 시 `wc -l CLAUDE.md` 런타임 실행 (PowerShell `Measure-Object` 는 BOM/encoding 이유로 값이 다를 수 있으므로 사용 금지).
- **CLAUDE.md 편집** — N1 trim 결과 존중. 오타 보정조차 금지.
- **`--push-tag` 호출** → Codex 가 remote push 권한 없음. Orchestrator 가 post-Sprint 수동 `git push origin v1.4.1`.
- **Token counter 포맷 변경** → `tokens.json` 스키마 유지, `vibe-status-tick.mjs` 내부 불변.

---

## Codex sandbox caveats

- `scripts/vibe-preflight.mjs` 내부 check 중 `state.schema` / `provider.*` / `git.worktree` 가 샌드박스에서 실패할 수 있음 → **무시하고 진행**.
- `npm test` 전체 실행이 샌드박스에서 timeout / network 제약에 걸리면 관련 테스트 파일만 `node --test ./test/sprint-commit.test.ts ./test/run-codex-wrapper.test.ts` 로 local run. Orchestrator 가 샌드박스 밖에서 full suite 재검증 수행.
- `git tag` 자체는 로컬 operation 이라 샌드박스 OK. `git push` 는 금지.

---

## Estimated LOC

- Production code: **add ~110 / delete ~5 / net ≤ +110** (sprint-commit.mjs +8, run-codex.sh +45, run-codex.cmd +15, config.json +2-2, release notes +30, handoff prompt +110 이지만 release/handoff 는 docs 라 production LOC 에 비해당).
- Strict production LOC (`.mjs` + `.sh` + `.cmd` + `.json` config) net ≤ **+75**.
- Tests: add ~110 / delete ~0. 별도 budget.
- iter-3 누적 net ≤ +150 OK (N1 이 net negative 였음).

---

## Final report contract

Final report 는 다음을 **모두** 포함해야 한다:

1. **Goal recap** (2 lines).
2. **Sandbox-only failures** (none or list).
3. **Files changed** — path + 한 줄 요약.
4. **Sprint-commit 결과** — 다음 세 가지 stdout 원문 인용:
   - `git log -1 --format=%H` 의 commit sha.
   - `[vibe-sprint-commit] harness-tag: created v1.4.1 (prev=1.4.0)` 라인 (또는 실패 시 실제 FAILED 라인).
   - `git tag -l v1.4.1` 출력.
5. **Test run** — `npm test` 또는 범위 제한된 `node --test` 출력의 마지막 20 줄 (pass/fail 카운트 포함).
6. **Tsc run** — `npx tsc --noEmit` 결과 (빈 출력 = pass).
7. **Wiring Integration Checklist** — 위 테이블 그대로, touched 항목에 변경 요약.
8. **Acceptance Criteria 체크** — 9개 항목별 pass/fail.
9. **Archive staging self-test** — `git show --stat HEAD` 에서 `.vibe/archive/prompts/sprint-N2-critical-bug-triage.md` 포함 여부 1줄 확인.
10. **Risks / open questions** (있으면 최대 5줄) — 예: tag push 타이밍, dogfood8 handoff 파일 accuracy, run-codex.cmd 에서 powershell 의존성.
11. **iter-3 budget ledger 업데이트** — 본 Sprint 의 production LOC net + 누적 net.
12. **Next sprint handoff hint** (1 line) — N3 scope preview (progressive MD + mode flag).

---

## Implementation notes (edge cases + parsing details)

### D1 — filter edge cases to keep in mind

- `readdirSync` 가 디렉토리 자체를 리턴하는 경우는 `.md` 필터로 자연 제외 — 추가 `statSync` 호출 불필요.
- dotfile (예: `.sprint-something.md`) 은 기존 로직대로 base 가 sprintId 와 정확히 같거나 `sprintId-` 로 시작하는 경우에만 포함. (현재 repo 에 케이스 없으므로 회귀 테스트 불필요.)
- `normalizePosix(path.join(...))` 는 Windows 역슬래시를 POSIX 슬래시로 변환. `git add --` 에 전달되는 경로는 POSIX 형식이 안전 (git for Windows 가 둘 다 받지만 일관성 유지).
- Export 방식: `export function collectArchivedPromptFiles(...)` 으로 전환. `main()` 내부 호출부는 그대로 유지 (import 사이드이펙트 없도록 `main()` 이 `import.meta.url === entryHref` guard 내부에서만 실행되는 기존 구조 존중).

### D2 — config.json diff minimization

- JSON value 만 수정. key 순서 / indent / trailing newline 은 기존 파일과 동일하게 유지. `JSON.stringify(obj, null, 2) + '\n'` 을 그대로 다시 쓰면 정렬 동일.
- `harnessVersionInstalled` 는 파일 마지막 키로 유지 (기존 line 57 위치).
- 만약 Codex 가 파일을 전체 재기록하면서 key 순서가 바뀌면 diff 노이즈가 커짐 — **reject**. minimal 2 line edit 이 이상적 (value 만 변경).

### D3 — run-codex.sh hook 구현 가이드

- 위치: `scripts/run-codex.sh:345` (`if [[ $rc -eq 0 ]]; then` 블록) 안의 `exit 0` 직전. 새 함수 `status_tick_after_success` 로 분리하여 본문 간결성 유지.
- Sprint ID 해결 헬퍼 (pseudo-contract, 실제 구현은 Codex 재량):
  ```
  resolve_sprint_id() {
    if [[ -n "${VIBE_SPRINT_ID:-}" ]]; then
      printf '%s' "$VIBE_SPRINT_ID"; return 0
    fi
    local status_file=".vibe/agent/sprint-status.json"
    if [[ -f "$status_file" ]]; then
      # grep + sed 기반 extraction. jq 금지 (dependency 추가 금지).
      local sid
      sid="$(grep -Eo '"currentSprintId"[[:space:]]*:[[:space:]]*"[^"]*"' "$status_file" \
             | sed -E 's/.*"currentSprintId"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/' | head -n1)"
      if [[ -n "$sid" && "$sid" != "idle" ]]; then
        printf '%s' "$sid"; return 0
      fi
    fi
    return 1
  }
  ```
- ISO 변환 헬퍼:
  ```
  iso_from_epoch() {
    local ts="$1"
    date -u -d "@$ts" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
      || date -u -r "$ts" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
      || return 1
  }
  ```
- Token 추출: 이미 존재하는 `token_suffix()` 를 참고하되, 별도 `extract_token_count()` 헬퍼로 pure integer 만 리턴하도록. empty string 이면 `--add-tokens` 생략.
- 호출 자체는 best-effort — stderr 리다이렉트 `2>&1` 로 status-tick 의 stderr 도 run-codex stderr 에 합류. parent exit code 는 항상 0 (원래 성공 분기).

### D3 — run-codex.cmd hook 구현 가이드

- 위치: `scripts/run-codex.cmd:30` (`if !_rc! EQU 0 goto :done_ok`) 직전에 inline tick 호출 추가 또는 `:done_ok` 라벨 내부에 추가.
- 최소 호출:
  ```
  if not "%VIBE_SPRINT_ID%"=="" (
    for /f "usebackq tokens=*" %%I in (`powershell -NoProfile -Command "(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')"`) do set "_iso=%%I"
    if defined _iso node scripts\vibe-status-tick.mjs --add-tokens 0 --sprint %VIBE_SPRINT_ID% --elapsed-start "!_iso!" 1>nul 2>nul
  )
  ```
  (위는 reference — Codex 가 CMD escaping 을 실제 작동하도록 미세조정. token=0 으로 전달해도 status-tick 은 누적만 하므로 safe.)
- PowerShell 을 찾을 수 없는 환경 대비: `where powershell >nul 2>&1` 체크 실패 시 silent skip.
- `--add-tokens 0 --sprint <id>` 조합은 `vibe-status-tick.mjs:49` 의 `both must be provided together` 규칙을 만족. `--elapsed-start` 만 단독 전달도 가능 (`addTokens === null && sprintId === null` 허용).

### D3 — 테스트 세부

- 테스트 스텁의 `codex exec` 가 `cat` 로 stdin echo 하는 기존 ok/stdin 모드를 활용 — 추가로 **`tokens: 1234` 를 stdout 에 포함시키는 새 mode `tokens`** 를 `createShellStubBin` 에 추가.
- 실행 후 assertion:
  ```
  const tokensPath = path.join(tempCwd, '.vibe', 'agent', 'tokens.json');
  const parsed = JSON.parse(await readFile(tokensPath, 'utf8'));
  assert.ok(parsed.sprintTokens['sprint-example'] >= 1234);
  assert.ok(parsed.elapsedSeconds >= 0);
  ```
- `cwd` 는 Node 의 `execFile(bashCmd, [script], { cwd: tempCwd })` 로 설정해 Bash 프로세스의 `pwd` 가 temp 가 되도록. `scripts/run-codex.sh` 내부에서 `node scripts/vibe-status-tick.mjs` 를 호출할 때 상대 경로가 temp 에서 resolve 되지 않으므로 — **absolute path 사용** 필요. Codex 는 `run-codex.sh` 내부에서 `SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"` 한 뒤 `node "$SCRIPT_DIR/vibe-status-tick.mjs"` 로 호출하도록 구현.
- `VIBE_SPRINT_ID` 미설정 + sprint-status.json 없음 케이스는 tokens.json 이 생성되지 않거나 `sprintTokens` 가 빈 객체로 남는다 (`loadTokens` 가 파일 없으면 빈 객체 리턴, 쓰기 자체가 일어나지 않음).

### D4 — handoff prompt tone

- 한국어 + 반말은 선택. 문어체 (존댓말) 도 OK. 핵심은 **사용자가 복사-붙여넣기** 로 다음 세션 첫 메시지에 통째로 사용할 수 있는 형태.
- 인라인 code 블록은 3-backtick fence 로 감싸고 language hint (`bash`, `json`) 명시.
- 절대경로는 Windows 형식 (`C:\Users\Tony\Workspace\...`) 사용 — 사용자 환경 그대로.

---

## Verification commands (Codex 측 self-run 권장 순서)

```
node scripts/vibe-preflight.mjs                            # green 또는 사전 양해된 샌드박스 실패만
npx tsc --noEmit
node --test test/sprint-commit.test.ts test/run-codex-wrapper.test.ts
npm test                                                    # 샌드박스에서 실패 시 생략 + 보고
node scripts/vibe-sprint-commit.mjs sprint-N2-critical-bug-triage passed
git tag -l "v1.4.1"
git show --stat HEAD | head -40
```

**주의**: `vibe-sprint-commit` 는 state 파일 + archive + production 파일을 단일 commit 에 묶는다. commit 전에 모든 D1~D4 파일이 저장되어 있어야 하며, git diff 에 unintended 파일 (예: `.vibe/agent/session-log.md` 중 본 Sprint 와 무관한 entry) 이 없어야 한다.

---

## Style rules (요약)

- Intent-first. 구현 pseudocode 금지. 단, CLI contract / 함수 signature 수준 힌트는 허용 (위에서 사용된 `collectArchivedPromptFiles` signature, `--add-tokens` CLI 등).
- Codex sandbox preflight 실패 (`state.schema` / `provider.*` / `git.worktree`) 무시하고 진행.
- CLAUDE.md baseline line count 하드코딩 금지 (런타임 `wc -l CLAUDE.md`).
- dogfood6/7/8 저장소 수정 금지 (경로 문자열 기재만).
- `--push-tag` Codex 에서 호출 금지 (Orchestrator post-Sprint 수동).
- 한글/영문 혼용 허용. 한국어 문장에서 코드 토큰은 backtick 으로 감싼다.
- Commit message template 은 `scripts/vibe-sprint-commit.mjs.buildCommitMessage` 가 자동 생성 — Codex 가 별도 인자 `--message` 로 붙이지 않는다.
