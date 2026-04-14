# Harness sync mechanism — web→local continuation

**Date**: 2026-04-14
**Sprint**: `harness-sync`
**Branch**: `claude/sync-vibe-doctor-harness-JbymN`
**Outcome**: 4 commits pushed, tsc clean, 34/34 tests pass.

## Why

다운스트림 프로젝트가 업스트림 `vibe-doctor` 템플릿의 하네스(스크립트·스킬·에이전트
설정·매니페스트·훅)를 받아오면서 프로젝트 고유 섹션(`PROJECT:*`, 로컬 커스터마이징)을
덮어쓰지 않도록 하는 싱크 경로를 만들기 위함. 기존에는 업스트림 업데이트를 수동 diff로
반영해야 해서 드리프트 발생.

## What shipped

### Infrastructure (prior web session — commits `a8e1cb5`, `ebb81ca`)
- `.vibe/config.json` → `harnessVersion: "1.0.0"` 필드
- `.vibe/sync-manifest.json` — harness/hybrid/project 소유권 매니페스트
- `CLAUDE.md` — 7개 `<!-- BEGIN:HARNESS:* -->` 섹션 마커 + `PROJECT:custom-rules`
- `.claude/settings.json` — `SessionStart` 훅
- `docs/prompts/sync-implementation.md` — Generator 위임용 구현 사양

### Feature implementation (local CLI continuation — commit `ad4dc9f`)
| 파일 | 역할 |
|---|---|
| `src/lib/sync.ts` | 싱크 엔진 — `sectionMerge`, `jsonDeepMerge`, `buildSyncPlan`, `applySyncPlan`, `runMigrations`, `createBackup`, `computeFileHash`, `loadManifest` |
| `src/commands/sync.ts` | CLI 진입점 (`--dry-run`/`--force`/`--from`/`--ref`/`--no-backup`/`--no-verify`/`--json`) + 대화형 conflict 해결 + tsc/preflight 검증 |
| `src/lib/config.ts` | `VibeConfig`에 `harnessVersion?`, `harnessVersionInstalled?`, `upstream?` 추가 |
| `src/lib/paths.ts` | sync 관련 경로 5개 추가 |
| `scripts/vibe-version-check.mjs` | SessionStart 훅 — `git ls-remote` + 24h 캐시 |
| `scripts/vibe-sync-bootstrap.mjs` | 레거시 원샷 부트스트랩 |
| `scripts/vibe-preflight.mjs` | non-blocking `harness.version` 체크 추가 |
| `migrations/1.0.0.mjs` | 초기 버전 스탬프 |
| `test/sync.test.ts` | 7 케이스 (sectionMerge / jsonDeepMerge / computeFileHash / buildSyncPlan) |
| `.claude/skills/vibe-sync/SKILL.md` | 슬래시 스킬 정의 |
| `package.json` / `.gitignore` / `README.md` | 배선 |

### Sprint close (commit `425505e`)
- `vibe-sprint-complete.mjs` 자동 갱신 + handoff §2/§4 수동 정리

## 3-tier 전략 (최종 배선)

| Tier | 적용 대상 | 메커니즘 |
|---|---|---|
| 1 — section-merge | `CLAUDE.md` 같이 마커 있는 혼성 파일 | 업스트림 base에서 upstream을 순회, `PROJECT:*` 또는 `preserveMarkers` 매치면 로컬 블록으로 치환, 외부 콘텐츠는 upstream |
| 2 — sidecar full-replace | 순수 하네스 파일 (`scripts/*.mjs`, 스킬, 에이전트) | SHA-256 hash를 `.vibe/sync-hashes.json`에 저장 → 로컬이 이전 싱크 이후 수정됐으면 `conflict`, 아니면 `replace` |
| 3 — json-deep-merge | `.claude/settings.json`, `package.json` | `harnessKeys` → upstream 값, `projectKeys` → 로컬 값, glob 패턴 `scripts.vibe:*` 지원 |

## Orchestrator self-QA가 잡아낸 회귀

1차 Codex 생성 후 `node --import tsx --test test/sync.test.ts`에서 1개 실패:

```
✖ replaces harness sections and preserves project sections
  AssertionError: false !== true
```

원인: `sync.ts`의 3개 regex 문자 클래스가 `[A-Z0-9:_-]+`로 제한되어 있어
`HARNESS:core-framing`, `PROJECT:custom-rules` 같이 소문자 섞인 섹션명을 매칭하지 못함.
실제 CLAUDE.md 마커는 모두 소문자 포함 — 바로 프로덕션 깨짐 수준의 버그.

Codex rescue 라운드로 3곳 모두 `[A-Za-z0-9:_-]+`로 확장. 재검증 → 34/34 통과.

**교훈**: Codex 샌드박스에서 `node --import tsx --test`가 `spawn EPERM`으로 실패해서
Generator 본인은 이 버그를 감지 못 함. **Orchestrator가 샌드박스 밖에서 재검증하는
패턴이 없었으면 머지됐을 회귀.** self-QA 루프의 방어 가치 재확인.

## 남은 작업 (P2)

- 업스트림 릴리스 태깅 시 `.vibe/config.json`의 `harnessVersion` bump + 다운스트림
  업그레이드 가이드 정리.
- 실제 레거시 프로젝트 대상 `vibe-sync-bootstrap.mjs` 동작 검증 (별도 테스트 프로젝트 필요).

## 검증

- `npx tsc --noEmit` → exit 0
- `node --import tsx --test test/*.test.ts` → 34 pass / 0 fail
- `node scripts/vibe-preflight.mjs` → exit 0
- `git push origin claude/sync-vibe-doctor-harness-JbymN` → 성공

## 프로세스 비고 — web→local 세션 핸드오프

웹 Claude 세션은 Codex CLI 미설치 환경이라 인프라만 작성 후 `docs/prompts/
sync-implementation.md`로 코드 위임을 blob화. 로컬 CLI에서 `handoff.md` §5의
next-action을 그대로 따라 `git checkout` → `run-codex.sh` 위임 → 검증 → 커밋
경로가 **문서만 보고 이어받기 가능**함을 확인. handoff/session-log/sprint-status
3종이 실제로 re-incarnation 연료로 기능.
