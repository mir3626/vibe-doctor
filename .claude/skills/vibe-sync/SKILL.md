---
name: vibe-sync
description: 다운스트림 프로젝트가 업스트림 vibe-doctor 템플릿의 하네스(스크립트·스킬·에이전트 설정)를 프로젝트 커스터마이징을 보존하면서 안전하게 싱크합니다.
---

이 스킬은 `.vibe/sync-manifest.json`의 소유권 분류(harness / hybrid / project)에 따라
업스트림 변경만 반영하고 프로젝트 고유 섹션은 건드리지 않습니다.

## 언제 소환하나

- `SessionStart` 훅(`vibe-version-check.mjs`)이 "하네스 업데이트 가능" 메시지를 출력했을 때
- 사용자가 `/vibe-sync` 또는 `npm run vibe:sync`를 직접 요청했을 때
- `vibe-preflight.mjs`가 `harness.version` 불일치를 경고로 보고했을 때

## 실행 흐름

1. `npx tsx src/commands/sync.ts --dry-run` 먼저 실행 — plan 테이블 확인
2. plan에 `conflict` 항목이 있으면 사용자에게 항목별로 제시:
   - `conflict`: 로컬이 이전 싱크 이후 수정됨 → 덮어쓸지(`--force` 또는 프롬프트 `y`) 유지할지(`n`) 선택
   - `new-file`, `replace`, `section-merge`, `json-merge`는 기본 진행
3. 사용자 승인 후 `npx tsx src/commands/sync.ts` 본 실행
4. 자동 검증: `npx tsc --noEmit` + `node scripts/vibe-preflight.mjs --bootstrap`
5. 실패 시 `.vibe/sync-backup/<timestamp>/`에서 롤백 경로 안내

## 옵션

| 플래그 | 용도 |
|---|---|
| `--dry-run` | plan만 출력, 실제 적용 없음 |
| `--force` | conflict를 모두 upstream으로 덮어씀 (비대화형) |
| `--from <path>` | 로컬 디렉터리를 업스트림 소스로 (git clone 대신) |
| `--ref <tag>` | 업스트림 git 참조 override |
| `--no-backup` | 백업 생략 (비권장) |
| `--no-verify` | 싱크 후 tsc/preflight 생략 |
| `--json` | plan을 JSON으로 출력 |

## 레거시 프로젝트 부트스트랩

마커(`<!-- BEGIN:HARNESS:* -->`)가 없는 구형 프로젝트는 정규 `/vibe-sync`로 업그레이드할
수 없습니다. 한 번만 `scripts/vibe-sync-bootstrap.mjs`를 실행해 마커/매니페스트/버전
필드를 부트스트랩한 뒤 `/vibe-sync`를 정상 사용합니다.

```bash
node /path/to/vibe-doctor/scripts/vibe-sync-bootstrap.mjs
```

## 주의

- `.vibe/config.json`의 `upstream` 필드가 없으면 동작하지 않습니다. `/vibe-init` 이후 수동
  추가 필요: `{ "type": "git", "url": "https://github.com/mir3626/vibe-doctor", "ref": "main" }`.
- `PROJECT:*` 마커 섹션과 `<!-- BEGIN:PROJECT:custom-rules -->` 블록은 **절대** 수정되지 않습니다.
- 싱크 후 `.vibe/config.json`의 `harnessVersionInstalled`가 `harnessVersion`과 일치해야 합니다.
