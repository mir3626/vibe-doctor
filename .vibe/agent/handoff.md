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

## 2. Status: IDLE - Sprint sprint-M8-audit-review-gaps passed

하네스 싱크 메커니즘(`vibe:sync`) 구현 완료. 인프라·코드·비코드 파일 모두 포함. tsc/tests 34/34 통과.

## 3. 완료된 Sprint 이력 (감사 기록)

| Sprint | 요약 | 상태 |
|---|---|---|
| `self-evolution-0` | P0: handoff 박제, trigger matrix, schema/status 확장, preflight 실행화, re-incarnation 프로토콜 | passed |
| `self-evolution-1` | Fine-tuning: startup footprint(A2~A5) + compaction survivability(B1~B6, PreCompact hook + session-log) | passed |
| `self-evolution-2` | 스크립트 훅 기반 강제 메커니즘: Phase 0 gate + 규칙 자동주입 + sprint-complete 자동화 | passed |
| `self-evolution-3` | Planner 역할 확장: 기술 사양 + Sprint 프롬프트 초안 출력 + 프롬프트 작성 원칙 | passed |
| `harness-sync` | 업스트림 하네스 싱크 메커니즘(section-merge + json-deep-merge + sidecar full-replace) + 레거시 부트스트랩 + SessionStart 버전 체크 훅 | passed |
| `v1.1.0-process-refactor` | v1.1.0-process-refactor | passed |
| `sprint-M1-schema-foundation` | sprint-M1-schema-foundation | passed |
| `sprint-M2-platform-wrappers` | sprint-M2-platform-wrappers | passed |
| `sprint-M3-sprint-flow-automation` | sprint-M3-sprint-flow-automation | passed |
| `sprint-M4-model-tier` | sprint-M4-model-tier | passed |
| `sprint-M5-native-interview` | sprint-M5-native-interview | passed |
| `sprint-M6-pattern-shards` | sprint-M6-pattern-shards | passed |
| `sprint-M7-phase0-seal-and-utilities` | sprint-M7-phase0-seal-and-utilities | passed |
| `sprint-M8-audit-review-gaps` | sprint-M8-audit-review-gaps | passed |

상세는 `sprint-status.json`의 `sprints[]` + `session-log.md` Archived 섹션 참조.

## 4. 산출물 — harness-sync

### 비코드 파일 (Orchestrator 직접):
- `.vibe/config.json` — `harnessVersion: "1.0.0"` 필드
- `.vibe/sync-manifest.json` — 파일 소유권 매니페스트 (harness/hybrid/project)
- `CLAUDE.md` — 7개 `<!-- BEGIN:HARNESS:* -->` 섹션 마커 + `PROJECT:custom-rules`
- `.claude/settings.json` — `SessionStart` 훅 (`vibe-version-check.mjs`)
- `.claude/skills/vibe-sync/SKILL.md` — 신규 슬래시 스킬 정의
- `package.json` — `vibe:sync` 스크립트 추가
- `.gitignore` — `.vibe/sync-backup/`, `.vibe/sync-cache.json`, `.vibe/sync-hashes.json` 추가
- `README.md` — `/vibe-sync` 슬래시 + `npm run vibe:sync` 문서
- `docs/prompts/sync-implementation.md` — Generator 위임용 구현 사양 (보존)

### 코드 파일 (Codex Generator 위임):
- `src/lib/config.ts` — VibeConfig에 `harnessVersion?`, `harnessVersionInstalled?`, `upstream?` 추가
- `src/lib/paths.ts` — `syncManifest`, `syncHashes`, `syncBackupDir`, `syncCache`, `migrationsDir`
- `src/lib/sync.ts` — 핵심 엔진 (sectionMerge, jsonDeepMerge, buildSyncPlan, applySyncPlan, runMigrations, createBackup, computeFileHash, loadManifest)
- `src/commands/sync.ts` — CLI 진입점 (`--dry-run`, `--force`, `--from`, `--ref`, `--no-backup`, `--no-verify`, `--json`)
- `scripts/vibe-version-check.mjs` — SessionStart 훅 (git ls-remote + 24h 캐시)
- `scripts/vibe-sync-bootstrap.mjs` — 레거시 원샷 부트스트랩
- `scripts/vibe-preflight.mjs` — `harness.version` 체크 추가 (non-blocking)
- `migrations/1.0.0.mjs` — 초기 버전 스탬프 마이그레이션
- `test/sync.test.ts` — 단위 테스트 (7 케이스, 모두 통과)

### 검증 결과:
- `npx tsc --noEmit` → exit 0
- `node --import tsx --test test/*.test.ts` → **34/34 pass** (sync.test.ts 7 + 기존 27)
- `node scripts/vibe-preflight.mjs` → exit 0

### 주요 버그 수정 (rescue round):
- `sync.ts` section-marker regex `[A-Z0-9:_-]+` → `[A-Za-z0-9:_-]+` (3곳). 소문자 포함 섹션명(`HARNESS:core-framing`, `PROJECT:custom-rules`) 매칭 실패 회귀 해결.

## 5. Next action

- 업스트림 릴리스 태깅 시 `.vibe/config.json`의 `harnessVersion` bump + 다운스트림 업그레이드 가이드 정리 (P2).
- 레거시 프로젝트 부트스트랩 실제 검증은 별도 프로젝트에서 수동 확인 필요.

## 6. 이월된 P1/P2

- **P1**: Sprint 프롬프트 template/slot, `run-codex.sh` final report 추출 + heartbeat,
  `.gitattributes` 자동화, Partial shard read.
- **P2**: 병렬 Sprint 지침 원인 조사 (`docs/orchestration/sprint.md`), Tribunal 모드 Evaluator.

## 7. 사용자 합의 상태 (영속)

- 산출물까지 자율 권한 유지
- 한국어 반말 유지
- `main`은 dogfood 1·2 P0 반영본까지 푸시 완료, `self_evolution`은 self-evolution-0/1/2/3 반영본까지 푸시 완료.
- `claude/sync-vibe-doctor-harness-JbymN` 브랜치에서 harness-sync 완료 (로컬 CLI 재개 포함).
- A1(CLAUDE.md 기계적 오버라이드 글로벌 이전) **거부** — 템플릿 배포 대상.
