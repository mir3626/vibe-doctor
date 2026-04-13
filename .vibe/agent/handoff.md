# Orchestrator Handoff — idle

> 이 파일은 Orchestrator 재인스턴스화의 **연료**다. 컨텍스트 압축/세션 종료 후 새
> Orchestrator가 부팅될 때 `CLAUDE.md → MEMORY → sprint-status.json → session-log.md →
> **이 파일**` 순으로 읽어 직전 상태를 복원한다. 체크포인트마다 이 파일을 갱신한다.
> 역할 제약·트리거 매트릭스는 `CLAUDE.md`, handoff 필드 스키마는
> `.vibe/agent/sprint-status.schema.json` 참조 (중복 금지).

## 1. Identity

- **branch**: `claude/sync-vibe-doctor-harness-JbymN` (하네스 싱크 기능 구현 중)
- **working dir**: (로컬 환경에서 설정)
- **language/tone**: 한국어 반말 (memory: `feedback_language_tone.md`)

## 2. Status: IN-PROGRESS — harness-sync Sprint 1/4 완료, 코드 구현 대기

하네스 싱크 메커니즘(`vibe:sync`) 구현 중. 비코드 파일(인프라) 완료, 코드 파일은 Generator(Codex) 위임 필요.

## 3. 완료된 Sprint 이력 (감사 기록)

| Sprint | 요약 | 상태 |
|---|---|---|
| `self-evolution-0` | P0: handoff 박제, trigger matrix, schema/status 확장, preflight 실행화, re-incarnation 프로토콜 | passed |
| `self-evolution-1` | Fine-tuning: startup footprint(A2~A5) + compaction survivability(B1~B6, PreCompact hook + session-log) | passed |
| `self-evolution-2` | 스크립트 훅 기반 강제 메커니즘: Phase 0 gate + 규칙 자동주입 + sprint-complete 자동화 | passed |
| `self-evolution-3` | Planner 역할 확장: 기술 사양 + Sprint 프롬프트 초안 출력 + 프롬프트 작성 원칙 | passed |
| `harness-sync` | 하네스 싱크 메커니즘 — 비코드 인프라 완료, 코드 구현 대기 | **in-progress** |

상세는 `sprint-status.json`의 `sprints[]` + `session-log.md` Archived 섹션 참조.

## 4. 현재 작업 상태 — harness-sync

### 완료 (비코드 파일, 커밋 완료):
- `.vibe/config.json` — `harnessVersion: "1.0.0"` 필드 추가
- `.vibe/sync-manifest.json` — 파일 소유권 매니페스트 (harness/hybrid/project 분류) 생성
- `CLAUDE.md` — 7개 `<!-- BEGIN:HARNESS:* -->` 섹션 마커 + `PROJECT:custom-rules` 섹션 추가
- `.claude/settings.json` — `SessionStart` 훅 추가 (`vibe-version-check.mjs`)
- `docs/prompts/sync-implementation.md` — Generator 위임용 상세 구현 프롬프트 작성

### 미완료 (코드 파일, Generator 위임 필요):
- `src/lib/config.ts` — VibeConfig에 `harnessVersion?`, `harnessVersionInstalled?`, `upstream?` 추가
- `src/lib/paths.ts` — `syncManifest`, `syncHashes`, `syncBackupDir`, `syncCache`, `migrationsDir` 경로 추가
- `src/lib/sync.ts` — 핵심 싱크 엔진 (sectionMerge, jsonDeepMerge, buildSyncPlan, applySyncPlan)
- `src/commands/sync.ts` — CLI 진입점 (`--dry-run`, `--force`, `--from`, `--json`)
- `scripts/vibe-version-check.mjs` — SessionStart 훅 스크립트 (git ls-remote + 24h 캐시)
- `scripts/vibe-sync-bootstrap.mjs` — 레거시 프로젝트 원샷 부트스트랩
- `scripts/vibe-preflight.mjs` — `harness.version` 체크 추가
- `migrations/1.0.0.mjs` — 초기 마이그레이션
- `test/sync.test.ts` — 단위 테스트
- `.claude/skills/vibe-sync/SKILL.md` — 스킬 정의 (비코드지만 미생성)
- `package.json` — `vibe:sync` 스크립트 추가
- `.gitignore` — `sync-backup/`, `sync-cache.json` 추가
- `README.md` — 싱크 문서 추가

### Generator 프롬프트:
`docs/prompts/sync-implementation.md`에 전체 구현 사양이 작성되어 있음.
로컬에서 `cat docs/prompts/sync-implementation.md | ./scripts/run-codex.sh -` 로 위임.

## 5. Next action (재부팅 시 여기부터)

1. `git checkout claude/sync-vibe-doctor-harness-JbymN` (이 브랜치에서 작업)
2. `cat docs/prompts/sync-implementation.md | ./scripts/run-codex.sh -` 로 Generator 호출
3. Generator 완료 후: `.claude/skills/vibe-sync/SKILL.md` 생성, `package.json`에 `vibe:sync` 추가, `.gitignore` 업데이트, `README.md` 업데이트
4. `npx tsc --noEmit` + `node --import tsx --test test/*.test.ts` 검증
5. 커밋 + 푸시

### 플랜 전문: `/root/.claude/plans/bright-strolling-sutherland.md` (클라우드 세션 로컬)
→ 동일 내용이 `docs/prompts/sync-implementation.md`에 Generator용으로 요약됨

## 6. 이월된 P1/P2

- **P1**: Sprint 프롬프트 template/slot, `run-codex.sh` final report 추출 + heartbeat,
  `.gitattributes` 자동화, Partial shard read.
- **P2**: 병렬 Sprint 지침 원인 조사 (`docs/orchestration/sprint.md`), Tribunal 모드 Evaluator.

## 7. 사용자 합의 상태 (영속)

- 산출물까지 자율 권한 유지
- 한국어 반말 유지
- `main`은 dogfood 1·2 P0 반영본까지 푸시 완료, `self_evolution`은 self-evolution-0/1/2/3 반영본까지 푸시 완료.
- 현재 `claude/sync-vibe-doctor-harness-JbymN` 브랜치에서 harness-sync 작업 진행 중.
- A1(CLAUDE.md 기계적 오버라이드 글로벌 이전) **거부** — 템플릿 배포 대상.
