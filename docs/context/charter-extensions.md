# Charter extensions — Legacy 프로필의 역할·트리거·Sprint 절차와 스크립트 표

> `CLAUDE.md` 가 매 세션과 매 context 압축 뒤에 통째로 싣던 Extensions 를 v1.24.0 에서 이 문서로 옮겼다.
> 대부분이 Legacy 프로필의 절차이고 Astra 프로필에는 적용되지 않는다.
>
> - **Legacy 프로필**: 세션의 첫 Sprint 전과 context 압축 직후에 이 문서를 읽는다. `CLAUDE.md` 의 Charter 는 이 문서 없이도 동작하도록 쓰여 있고, 둘이 어긋나면 Charter 가 우선한다.
> - **Astra 프로필**: 이 문서는 적용되지 않는다. 스크립트 표나 스킬 목록처럼 여기 적힌 사실이 필요할 때 그 절만 읽는다.
>
> `npm run vibe:rule-audit` 는 `CLAUDE.md` 와 이 문서의 명령형 규칙을 함께 센다.

## 역할 제약 상세 (legacy profile)

- Legacy profile에서는 Charter의 역할 제약이 우선한다. Astra에는 문서 상단의 모델 분기를 적용한다.
- Orchestrator는 문서(.md), 보고서, 설정(JSON/YAML/TOML) 등 비코드 파일만 직접 편집할 수 있다.
- 모든 소스코드 작성/수정은 Generator(Codex CLI) 위임으로 수행한다.
- Generator 호출은 반드시 `Bash("... | ./.vibe/harness/scripts/run-codex.sh -")` 로 한다.

## Sub-agent 소환 트리거 매트릭스 상세

### Sprint 로드맵 분할 — **Orchestrator 책임** (위임 금지)

Orchestrator는 Phase 0 네이티브 인터뷰 (`.vibe/harness/scripts/vibe-interview.mjs`) 직후 **product 맥락을 가장 풍부하게 보유한 상태**다. 이 시점에 직접 Sprint 분할을 수행하여 `docs/plans/sprint-roadmap.md`에 저장한다. N개 Sprint × `{id, name, 한 줄 목표, 의존, 예상 LOC}` 형태. **로드맵 작성을 Planner에 위임하지 않는다** — 위임 시 인터뷰 context 손실로 품질이 떨어진다.

### Planner 소환 — **Sprint 단위** fresh context 공급

**원칙**: Planner는 **매 Sprint 시작 전 소환**한다. Sprint가 진행될수록 Orchestrator context는 누적·오염되므로, Planner의 격리된 fresh context가 해당 Sprint의 **타입·API 시그니처·파일 구조·프롬프트 초안**을 독립적으로 도출하여 Sprint 간 재현성을 담보한다. 입력은 `product.md` + `architecture.md` + `sprint-roadmap.md`의 해당 slot + 직전 Sprint 결과 2~3줄 요약.

- 🟥 **Must**: **매 Sprint 시작 전**
- 🟢 **예외 (프로토타입)**: 사용자가 "자율 + 간소화" 명시 + 아래 **세 조건 전부 충족** 시에만 Planner 생략 가능. 생략 근거를 `node .vibe/harness/scripts/vibe-planner-skip-log.mjs <sprintId> <reason>` 으로 session-log 에 `[decision][planner-skip]` 태그로 **강제 기록** 한다 (수동 편집 금지).
  1. 직전 Sprint 패턴을 **그대로 계승** (새 파일 유형 / 새 모듈 경계 / 새 schema 없음).
  2. **아키텍처 결정 없음** — 기존 구조 내부의 정제/수정만.
  3. **스펙 변경 작음** — 체크리스트 항목 ≤3 개 + 완전 기계 검증 가능 (`tsc`, grep, test).
  LOC 수치는 예외 판정 기준에 포함하지 **않는다** (gameable). 세 조건 중 하나라도 불확실하면 Planner 소환이 기본값.

### Evaluator 소환
- 🟥 **Must**: Orchestrator self-QA 실패 (Tribunal) / context pressure 높음 / 비-executable AC 존재
- 🟥 **Must**: >5 파일 또는 >500 LOC / 작성자=평가자 역할 충돌
- 🟥 **Must**: `LOC_THRESHOLD_BREACH` pendingRisk가 열려 있으면 프로토타입 예외를 적용하지 않는다.
- 🟢 **예외** (프로토타입 세션): 사용자가 자율 진행 승인 + self-QA 1회 통과 + LOC < 2000이면 Evaluator 트리거 면제

상세: `docs/context/orchestration.md` (역할 × Phase 매트릭스).

## 추론 강도 정책

기획 품질이 최종 산출물 품질을 결정한다. 단계별 책임 주체 + 최소 추론 강도:

| 단계 | 책임 | 최소 추론 강도 | 강제 메커니즘 |
|------|------|---------------|-------------|
| Phase 0 네이티브 소크라테스식 인터뷰 | Orchestrator (PO 대행 포함) | **maximum** | `.vibe/harness/scripts/vibe-interview.mjs` + extended thinking |
| Sprint 로드맵 분할 | **Orchestrator** | **maximum** | 인터뷰 직후 맥락 활용 → `docs/plans/sprint-roadmap.md` |
| Sprint 기술 사양 / 프롬프트 초안 | **Planner** (매 Sprint 소환) | **maximum** | fresh subagent context → `docs/prompts/sprint-NN-*.md` |
| 코드 생성 | Generator | Generator 기본 | `run-codex.sh` (자동 규칙 주입) |
| 검증 | Orchestrator + (트리거 시) Evaluator | **high** | 기계적 검증 + Evaluator (트리거 시) |

## 훅 강제 메커니즘 — MD보다 스크립트

규칙은 문서가 아닌 **스크립트 게이트**로 강제하는 것이 목표다. MD에 쓰인 규칙을 Orchestrator가
"까먹는" 것은 프로세스 실패이므로, 게이트가 없는 규칙은 `vibe-rule-audit`가 uncovered 후보로 드러낸다.

| 시점 | 스크립트 | 역할 |
|------|---------|------|
| Sprint 시작 전 | `node .vibe/harness/scripts/vibe-preflight.mjs` | git·deps·provider·product.md·handoff 체크 |
| Generator 호출 시 | `./.vibe/harness/scripts/run-codex.sh` | `_common-rules.md` 자동 prepend + 명시 참조된 rule/context MD 자동 주입 + UTF-8 + 재시도 |
| Sprint 완료 시 | `node .vibe/harness/scripts/vibe-sprint-complete.mjs` | sprint-status·handoff·session-log 자동 갱신 + 활성 Pro flow exact-HEAD 누적/최종 보고 gate |
| Context 압축 전 | `node .vibe/harness/scripts/vibe-checkpoint.mjs --auto-refresh` | 기계적 git 스냅샷(브랜치·HEAD·변경파일·diffstat·최근커밋)을 git 무시 `.vibe/runs/precompact-snapshot.md`에 쓰고(추적 파일·`updatedAt`은 건드리지 않음), freshness/budget/session-log/`docs.integrity`(tracked∧exists first-read 문서가 비었거나 64B 미만이면 FAIL) 검증. 서사(narrative)는 Orchestrator가 작성. |
| 세션 시작 시 | `node .vibe/harness/scripts/vibe-agent-session-start.mjs --hook` | 일일 lifecycle 이벤트 + 버전/model registry 점검. 동일 `session_id + source`의 60초 내 중복 전달은 원자적으로 1회만 실행하고 source 전환은 보존 |
| 턴 종료 시 (Stop) | `node .vibe/harness/scripts/vibe-stop-qa-gate.mjs` | sync manifest 기준 하네스 소유 변경만 감지 → detached hidden worker에 `vibe:typecheck` + `vibe:self-test` 예약 후 즉시 반환. 제품 QA는 실행하지 않으며 동일 상태·동시 Stop은 잠금/결과 지문으로 중복 제거 |
| Sprint 커밋 시 | `node .vibe/harness/scripts/vibe-sprint-commit.mjs` | state 갱신 + auto-stage + 템플릿 커밋 메시지 |
| session-log 정리 | `node .vibe/harness/scripts/vibe-session-log-sync.mjs` | 타임스탬프 정규화 + 중복 제거 + 정렬 |
| 모델 해석 시 | `node .vibe/harness/scripts/vibe-resolve-model.mjs` | config + registry 결합 → 현재 SOTA 모델 ID |
| 세션 시작 시 | `node .vibe/harness/scripts/vibe-model-registry-check.mjs` | upstream registry 비교 + 변경 감지 (24h 캐시) |
| Phase 3 인터뷰 | `node .vibe/harness/scripts/vibe-interview.mjs` | 네이티브 소크라테스식 인터뷰 |
| Phase 0 커밋 | `node .vibe/harness/scripts/vibe-phase0-seal.mjs` | Phase 0 산출물 자동 stage + commit |
| 브라우저 smoke | `node .vibe/harness/scripts/vibe-browser-smoke.mjs` | Stagehand headless Chrome DOM/console 계약 검증 (opt-in, 시스템 Chrome) |
| Sprint 완료 시 | `node .vibe/harness/scripts/vibe-audit-lightweight.mjs` | diff stats / spec keyword / test coverage / tmp 잔존 / app-code LOC threshold — pendingRisks INFO 주입 |
| 사전 준비 / CI | `node .vibe/harness/scripts/vibe-gen-schemas.mjs --check` | Zod source ↔ `.schema.json` drift 감지 |
| audit 카운터 리셋 | `node .vibe/harness/scripts/vibe-audit-clear.mjs` | sprintsSinceLastAudit 리셋 + pendingRisks 정리 |
| 토큰/시간 기록 | `node .vibe/harness/scripts/vibe-status-tick.mjs` | Agent 호출 전후 tokens.json 갱신 |
| Sprint 모드 토글 | `node .vibe/harness/scripts/vibe-sprint-mode.mjs` | permission preset 병합/해제 (agent-delegation) |
| Sprint 시작 전 (Planner skip) | `node .vibe/harness/scripts/vibe-planner-skip-log.mjs` | session-log `[decision][planner-skip]` 엔트리 기록 (trivial 예외 발동 시 필수) |
| Post sprint commit | `node .vibe/harness/scripts/vibe-sprint-commit.mjs --push-tag` | Detects upward harnessVersion deltas and creates annotated `vX.Y.Z` tags; push is opt-in (`gap-release-tag-automation`) |
| Rule audit | `node .vibe/harness/scripts/vibe-rule-audit.mjs` | Compares CLAUDE.md imperative rules with harness-gaps coverage and retrospective transcript tiering |
| Context dependency audit | `node .vibe/harness/scripts/vibe-context-audit.mjs` | Report-only scan of skill/runbook path dependencies, hard/soft/ambiguous strength, missing references, and context byte overhead. Never gates preflight, commits, push, or tags. |
| Web Pro 왕복 | `node .vibe/harness/scripts/vibe-pro-go.mjs` | GitHub append-only flow 최신 이벤트 sync, immutable Sprint packet, evidence/report/approval/close gate |
| Audit skip directive | `node .vibe/harness/scripts/vibe-audit-skip-set.mjs` | Sets or clears `.vibe/config.local.json` userDirectives.auditSkippedMode and records a session-log `[decision]` |
| PowerShell 실행 시 | `node .vibe/harness/scripts/vibe-ps.mjs` (`npm run vibe:ps --`) | 인라인 `powershell -Command "…"` 대신. 코드는 `.ps1` 파일(또는 `-c` 한 줄)에, 글·경로·이름은 인자·`--param`·`--param-file`·`--env` 로만. UTF-8 로 읽고, 주석 밖의 타이포그래피 따옴표·대시(“ ” ‘ ’ – —)와 구문 오류는 실행 전에 exit 65 로 거부. 종료 코드는 스크립트의 `exit N`, 오류는 1 |
| Codex 호출 실패 시 | `.vibe/harness/scripts/run-codex.sh` + `.vibe/agent/codex-unavailable.flag` | 3회 retry 소진 시 flag touch + stderr CODEX_UNAVAILABLE 블록 출력. Orchestrator 는 flag 존재 시 Generator 위임 대신 사용자 승인 분기 진입. 다음 성공 호출 시 flag auto-remove. |

**원칙**: 스크립트가 FAIL을 반환하면 다음 단계로 진행하지 않는다. Claude Code 훅 명령은 `${CLAUDE_PROJECT_DIR}`에 절대 결합하고 hook mode를 사용한다. hook mode의 정상·skip 결과는 stdout을 비우며, 사용자에게 알려야 하는 비차단 결과만 단일 JSON `systemMessage`로 출력한다. PreCompact는 상태 파일 없음·문서 손상일 때만 stdout 없이 exit 2 + stderr로 압축을 막고, 서술이 묵은 것은 `systemMessage` 경고만 낸다. PostToolUse config-audit는 `git add`/`git commit` Bash 호출 뒤에만 돈다(`if` 조건). Stop foreground는 하네스 소유 변경 판정과 detached worker 예약만 수행하고 즉시 exit 0 한다. worker는 제품 `vibe:qa` 대신 하네스 `vibe:typecheck`와 `vibe:self-test`만 실행하고, `CLAUDE_PROJECT_DIR`를 제거하며 `VIBE_SKIP_AGENT_SESSION_START=1`을 강제한 hidden child에서 수행한다. 실패 결과는 다음 Stop에서 단 한 번 JSON 알림으로 전달한다. 동일 상태·동시 Stop은 원자적 잠금과 SHA-256 결과 receipt로 중복 제거한다. 동일 SessionStart lifecycle 전달은 `session_id + source` 기준 60초 동안 중복 제거하되 startup/resume/clear/compact 전환은 별도 이벤트로 보존한다. 하네스와 무관한 세션(예: 프로젝트 API/CLI가 같은 repo에서 spawn하는 헤드리스 에이전트)은 spawn 환경에 `VIBE_HARNESS_HOOKS=off`를 설정하면 모든 하네스 훅 진입점(Stop QA·SessionStart·Notification·PostToolUse config-audit·PreCompact checkpoint)이 즉시 exit 0으로 skip된다.

> **CRITICAL — provider별 호출 방법**:
> - **Claude 계열** (`claude-opus`, `claude-sonnet`) → Agent 도구 사용 (model 파라미터)
> - **Codex** → `Bash("... | ./.vibe/harness/scripts/run-codex.sh -")`. Agent 도구는 Claude만 지원하므로 Generator에 사용 금지.
> - **기타 비-Claude 계열** (`gemini` 등) → Bash 도구로 CLI 실행 (`.vibe/config.json`의 `providers` 섹션 참조)
>
> Agent 도구의 model 파라미터는 Claude 전용(sonnet/opus/haiku)이다.
>
> ```
> ✅ 올바른 Generator 호출 (Codex):
>    Bash("cat docs/prompts/task.md | ./.vibe/harness/scripts/run-codex.sh -")
>    # run-codex.sh가 UTF-8 locale + shell_environment_policy + 3회 재시도를 자동 적용.
>    # 상세 배경: docs/context/codex-execution.md
>
> ❌ 잘못된 Generator 호출 (Claude가 실행됨):
>    Agent(model: "sonnet", prompt: "코드 구현...")
>    Agent(model: "opus", prompt: "코드 구현...")
>    Agent(subagent_type: "codex:codex-rescue", prompt: "...")
> ```
>
> **참고**: `codex:rescue` 플러그인은 잠정 보류 (Windows 환경에서 불안정·속도 저하 이슈).

### Planner 소환 — subagent_type 지정 필수

```
✅ 올바른 Planner 호출 (fresh opus subagent, sprint-planner.md frontmatter 기반):
   Agent({ subagent_type: 'sprint-planner', model: 'opus', prompt: '...' })

⚠️  혼동 주의 — Claude Code 내장 "Plan" agent 는 read-only (Write/Edit 도구 없음).
   `docs/prompts/sprint-<id>-*.md` 생성이 조용히 실패한다. 반드시 subagent_type
   을 `sprint-planner` 로 명시할 것. subagent_type 생략 또는 `planner` 사용 금지.
```

## Sprint 흐름 — 2단 구조

### Phase 0 — 프로젝트 최초 1회 (Orchestrator 전담)

0-1. **네이티브 소크라테스식 인터뷰** — `/vibe-init` Phase 3 (`.vibe/harness/scripts/vibe-interview.mjs`). 사용자가 "자율 진행"을 지시해도 **인터뷰 자체는 스킵 금지**. Orchestrator가 PO 대행으로 답변하며 flow 완주, 모호성 점수 ≤ 0.2 수렴. PO 대행 답변의 rationale은 **매 Phase 종료 시 요약 1회** session-log에 `[decision]` 태그로 기록. 상세 프로토콜: `.claude/skills/vibe-init/SKILL.md` §Phase 3.
0-2. **seed → context shards 자동 변환**: `docs/context/product.md` / `architecture.md` / `conventions.md` 작성.
0-3. **Orchestrator가 Sprint 로드맵 작성** → `docs/plans/sprint-roadmap.md`. N개 Sprint × `{id, name, 한 줄 목표, 의존, 예상 LOC}`. (로드맵 분할은 Orchestrator 책임 — 트리거 매트릭스 참조. Planner에 위임 금지.)
0-4. `node .vibe/harness/scripts/vibe-preflight.mjs --bootstrap` → exit 0 확인.

### 매 Sprint 반복

1. `node .vibe/harness/scripts/vibe-preflight.mjs` → exit 0
2. **Planner 소환** (Agent 도구, model: opus, fresh subagent — 매 Sprint Must 트리거)
   - 입력: `product.md` + `architecture.md` + `sprint-roadmap.md`(해당 slot) + 직전 Sprint 결과 2~3줄 요약
   - 출력: 해당 Sprint 기술 사양 + 프롬프트 초안 → `docs/prompts/sprint-NN-*.md`
3. **Generator 위임**: `cat docs/prompts/sprint-NN-*.md | ./.vibe/harness/scripts/run-codex.sh -`
   3-1. `node .vibe/harness/scripts/vibe-status-tick.mjs` — Generator 호출 전후 토큰/시간 기록
4. Orchestrator 샌드박스 밖 재검증 (tsc/test/build)
5. Orchestrator self-QA (체크리스트 대조)
6. (트리거 시) Evaluator 소환
7. `node .vibe/harness/scripts/vibe-sprint-complete.mjs <sprintId> <passed|failed>` → sprint-status.json + handoff.md + session-log.md 자동 갱신 (**파일만 업데이트, 자동 커밋 X**)
8. **단일 커밋 원칙 (v1.1.1+)**: `node .vibe/harness/scripts/vibe-sprint-commit.mjs <sprintId> passed [--scope <glob>]` 래퍼가 Generator 산출 파일 + 3종 state 파일(`.vibe/agent/sprint-status.json`, `handoff.md`, `session-log.md`) + 아카이브 prompts 를 **한 git commit** 에 묶어 생성. pending risk 가 열려있으면 거부. LOC 자동 계산.
9. 다음 Sprint → (1)로 반복. **로드맵 마지막 sprint 완료 시 자동**: `.vibe/harness/scripts/vibe-sprint-complete.mjs` 가 `.vibe/harness/scripts/vibe-project-report.mjs` 호출 → `docs/reports/project-report.html` 생성 + 브라우저 1회 오픈(짧은 시간 내 중복 오픈은 suppress). 이후 추가 개선은 `/vibe-iterate` 로 다음 iteration 진입 (차등 인터뷰 + carryover + iteration-history.json 갱신). `/vibe-iterate` 종료 단계에서 같은 report 명령을 다시 실행하지 않는다.

> Planner / Generator / Evaluator는 Sprint 내에서만 존재하고 Sprint 간 context를 공유하지 않는다. Sprint 간 상태는 `.vibe/agent/sprint-status.json` + `handoff.md` + `session-log.md` 3종으로만 전달하고, **context 압축 직후**에는 작업 전에 먼저 이 세 파일 + 관련 memory shard를 읽어 상태를 복원한다(Astra 는 handoff 「현재」 절).

## Sprint 프롬프트 작성자

Sprint 프롬프트 **본문은 Planner가 작성**한다 (매 Sprint 소환 시 산출). Orchestrator는 메타데이터·포맷 보정만 허용 — scope expansion 헤더 prepend, "이미 설치된 deps" 안내 prepend, 직전 Sprint 결과 요약 첨부 등. 본문 자체를 Orchestrator가 작성하는 경우는 `_common-rules.md`의 예외 규칙 하에서만 허용되며 session-log에 `[decision]` 태그로 사유 기록. 작성 원칙:

- **의도(intent)를 명시하고 구현 세부사항은 Generator에 위임한다.**
  - ✅ "시각적으로 구분 가능한 색상 팔레트" / "행·열 완료 시 단서가 비활성 스타일로 변경"
  - ❌ 구체적 hex 코드(`#2C3E50`), 함수 시그니처, 내부 변수명
- **타입 정의와 API 시그니처는 Planner의 fresh context에서 도출한다.** Orchestrator가 이전
  프로젝트 경험에서 가져온 구현 세부사항을 주입하면 재현성이 깨진다.
- **체크리스트 항목은 검증 가능해야 한다.** 기계 검증 가능한 항목은 "npx tsc --noEmit 통과"처럼 명시하고, 제품 정체성·사용감·시각/상호작용 품질처럼 자동화하기 어려운 항목은 inspection/demo AC 로 분리해 Evaluator 또는 사용자 확인 대상으로 둔다. 자동화가 어렵다는 이유로 중요한 품질 기준을 버리지 않는다. frontend/game/visual/canvas/WebGL/Three.js/editor/dashboard Sprint는 screenshot, Stagehand UI-test output, browser-smoke output, 또는 playthrough note를 product identity/payoff와 연결한 evidence item 없이 pass 처리하지 않는다. 무엇을 봐야 증거인지는 `CLAUDE.md` 의 「증거는 사용자가 보게 될 것을 본 것이어야 한다」를 따른다.

## Agent 오케스트레이션 레이어 (`.vibe/agent/`)

상태/핸드오프/재인스턴스화 프로토콜 + Sprint 프롬프트 공용 조각. 파일별 역할은 `.vibe/agent/README.md` 참조. 압축 직후 최우선 읽기 대상은 `handoff.md` + `session-log.md` + `sprint-status.json`(legacy. Astra 는 `astra-rules.md` 상태 계약대로 handoff 맨 위 「현재」 절).

## 관련 스킬
`/vibe-init`, `/vibe-interview`, `/vibe-iterate`, `/vibe-sync`, `/vibe-sprint-mode`, `/vibe-review`, `/goal-to-plan`, `/self-qa`, `/write-report`, `/maintain-context`, `$vibe-pro-go`.

- `/vibe-iterate`: 최초 Sprint 로드맵 소진 후 재개. handoff + report.html + iteration-history.json 기반 차등 인터뷰 → 새 iteration sprint roadmap append → Sprint 사이클 재돌입. context isolation 유지(Planner 는 여전히 fresh), 사용자는 report.html 의 iteration 타임라인으로 전체 build-up follow-up.
- `/vibe-review`: 4-tier rubric (🔴/🟡/🟢/🔵) + regression 검증 (이전 리뷰 이슈 3-signal 커버리지) + priority_score 공식 `10·agent + 5·token + 1·user`, recommended_approach `script-wrapper > md-rule > config-default > user-action`.
- `$vibe-pro-go`: GitHub의 append-only `vibe-pro-bridge`를 통해 Web Pro 상세설계/리뷰와 CLI 구현/보고를 왕복한다. 인자 없는 bare 호출은 로컬 `ACTIVE.json` 상태만 읽고 worktree/packet scaffolding이나 remote flow 선택을 만들지 않은 채 멈춘다. 실제 재개는 유효한 active pointer를 쓰는 명시적 `go`, exact flow, 또는 date/slug selector가 필요하다. 잘못 선택되어 정상 이벤트 체인으로 닫을 수 없는 flow는 exact flow + one-line reason의 `force-close` dry-run 후 사용자가 확인한 `--publish --user-approved`로만 append-only operator terminal 처리하며, 승인/정상 완료로 표기하지 않는다. `confirm-skip on|off|status`로 `.vibe/config.local.json`의 `userDirectives.proGoAutoPublish`를 토글하며, `go`/`status`가 `autoPublish: true`를 보고하면 일반 발행 전 사용자 확인 대기를 생략하고 발행마다 session-log `[decision][auto-approved]`를 기록한다. Pro 설계/feedback을 받아오면 상태 변경 명령 전에 사용자 언어 alignment brief(`brief` 명령, intent 추적 분류 + 분기 제안)가 hard gate로 강제되고, non-blocking 리뷰(P0/P1 0건)는 `accept-review --publish --user-approved`로 웹 왕복 없이 CLI에서 종료한다 — alignment 판단, review acceptance, force-close는 모두 autoPublish로 우회 불가. 상세: `.claude/skills/vibe-pro-go/references/CLI-CONTRACT.md`, `docs/context/workflow-integrity.md` §12.

## Mode flag calling convention (human / agent — iter-4 defer)

`.vibe/config.json.mode` 는 `human` / `agent` 2값 flag이며 현재는 선언만 한다. 아래 5 분기점은 calling convention이고 실제 분기 로직은 작성하지 않는다.

1. Interview mode — human: `.vibe/harness/scripts/vibe-interview.mjs` 인터랙티브 prompt. agent: seed prompt → synthesizer 자동 재귀 없이 dimension 전량 seed 주입 + 자동 answer — 구현: iter-4+ (defer)
2. Error output format — human: 한국어 + emoji + 친화적 다음 행동 제안. agent: JSON `{ "code": "...", "message": "...", "hint": "..." }` 한 줄 — 구현: iter-4+ (defer)
3. Confirmation gates — human: 사용자 approve 대기. agent: risk-tier ≤ N (정의 defer) auto-approve, initialized `[decision][auto-approved]` session-log 기록 — 구현: iter-4+ (defer)
4. Doc verbosity — human: Charter + Extensions 자동 확장 읽기. agent: Charter only 우선, Extensions 는 explicit `docs/context/*.md` 읽기 요구에만 — 구현: iter-4+ (defer)
5. Status display — human: statusline emoji + 한국어. agent: JSON log line (`{ "sprint": "...", "elapsed": N, "tokens": N }`) — 구현: iter-4+ (defer)
