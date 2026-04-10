# Sprint self-evolution-2: 스크립트 훅 기반 강제 메커니즘

## 목표
3개 스크립트를 수정/생성하여, 기존 MD 문서 의존 규칙을 스크립트 게이트로 강제한다.

## 현재 파일 상태
- `scripts/run-codex.sh` — Codex CLI wrapper (UTF-8 + 재시도). 현재는 프롬프트를 그대로 전달.
- `scripts/vibe-preflight.mjs` — Sprint 시작 전 기계적 체크. git/deps/provider/status/handoff 체크.
- `scripts/vibe-sprint-complete.mjs` — **존재하지 않음**. 신규 생성.

## 변경 1: `scripts/run-codex.sh` — _common-rules.md 자동 prepend

### 요구사항
stdin으로 프롬프트가 들어올 때, `.vibe/agent/_common-rules.md` 파일이 존재하면 프롬프트 앞에 자동으로 붙인다.

### 수정 위치
"4. Buffer stdin so retries can replay it" 섹션 (line ~79) 이후에 규칙 주입 로직 추가.

### 구현
```bash
# ---------- 4b. Inject common rules into prompt ----------
RULES_FILE=".vibe/agent/_common-rules.md"
if [[ -n "$stdin_buf" && -f "$RULES_FILE" ]]; then
  rules_content=$(cat "$RULES_FILE")
  stdin_buf="$(printf '%s\n\n---\n\n%s' "$rules_content" "$stdin_buf")"
  echo "[run-codex] injected common rules from $RULES_FILE" >&2
fi
```

### 제약
- rules 파일이 없으면 건너뛰기 (경고 없음)
- 위치 인자로 프롬프트가 전달된 경우(stdin 없음)에는 주입하지 않음
- 기존 재시도 로직, UTF-8 설정, sandbox 설정에 영향 없어야 함

## 변경 2: `scripts/vibe-preflight.mjs` — bootstrap 모드 + product.md 체크

### 요구사항
1. `--bootstrap` 플래그 추가: 첫 커밋이 없는 새 프로젝트에서도 실행 가능하도록 git.worktree와 git.clean 체크를 건너뜀
2. `docs/context/product.md` 존재 여부 체크 추가: 없으면 FAIL (Phase 0 인터뷰 필요)
3. `--bootstrap` 모드에서는 product.md 체크는 유지하되, git/deps/sprint.status/sprint.handoff 체크를 skip 또는 warning으로 전환

### 구현 가이드

파일 상단에 플래그 파싱 추가:
```javascript
const BOOTSTRAP_MODE = process.argv.includes('--bootstrap');
```

기존 git.worktree, git.clean 체크를 조건부로 실행:
```javascript
if (!BOOTSTRAP_MODE) {
  // 기존 git 체크 로직
}
```

product.md 체크 추가 (6번 체크로):
```javascript
// 6. product.md existence (Phase 0 gate)
const productPath = resolve('docs/context/product.md');
const hasProduct = existsSync(productPath);
if (hasProduct) {
  const content = readFileSync(productPath, 'utf8').trim();
  record('phase0.product', content.length > 50, content.length > 50 ? 'product.md present and populated' : 'product.md exists but too short (<50 chars)');
} else {
  record('phase0.product', false, 'missing docs/context/product.md — run Phase 0 (Ouroboros PM interview) first');
}
```

bootstrap 모드에서 sprint.status/sprint.handoff 체크를 warning으로:
```javascript
if (BOOTSTRAP_MODE) {
  record('sprint.status', true, 'bootstrap mode — sprint status check skipped');
  record('sprint.handoff', true, 'bootstrap mode — handoff check skipped');
} else {
  // 기존 로직
}
```

## 변경 3: `scripts/vibe-sprint-complete.mjs` — 신규 생성

### 요구사항
Sprint 완료 시 호출하여 상태 파일 3개를 자동 갱신하는 스크립트.

### 사용법
```
node scripts/vibe-sprint-complete.mjs <sprintId> <passed|failed> [--summary "요약 텍스트"]
```

### 구현

1. **sprint-status.json 갱신**:
   - `sprints[]` 배열에 새 Sprint 엔트리 추가 (id, name=sprintId, status, completedAt=now ISO)
   - `handoff.currentSprintId` 를 `"idle"`로 갱신
   - `handoff.lastActionSummary` 를 `--summary` 값 또는 `"Sprint <id> completed with <status>"`로 갱신
   - `handoff.updatedAt` 를 현재 시각 ISO로 갱신

2. **handoff.md 갱신**:
   - `## 2. Status:` 섹션의 내용을 `"IDLE — Sprint <sprintId> <status>"` 로 교체
   - `## 3. 완료된 Sprint 이력` 테이블에 새 행 추가
   - 파일 전체를 다시 쓰지 말고, 정규식으로 해당 섹션만 갱신

3. **session-log.md 갱신**:
   - `## Entries` 섹션 바로 아래에 새 줄 append:
     `- <ISO timestamp> [sprint-complete] <sprintId> → <status>. <summary>`

### 에러 처리
- sprint-status.json이 없으면 exit 1 + 에러 메시지
- 이미 같은 sprintId가 sprints[]에 있으면 경고 출력 후 갱신 (중복 추가 방지)
- handoff.md/session-log.md가 없으면 경고만 출력하고 해당 파일 갱신 건너뜀

### 코드 스타일
- ESM (`import`), strict mode
- `node:fs`, `node:path` 사용
- 최소 의존성 (외부 패키지 없음)
- 기존 `vibe-preflight.mjs`, `vibe-checkpoint.mjs`와 동일한 패턴

## 체크리스트
- [ ] run-codex.sh: _common-rules.md 자동 prepend 동작
- [ ] vibe-preflight.mjs: --bootstrap 플래그 동작
- [ ] vibe-preflight.mjs: product.md 존재 체크 동작
- [ ] vibe-sprint-complete.mjs: sprint-status.json 갱신
- [ ] vibe-sprint-complete.mjs: handoff.md 갱신
- [ ] vibe-sprint-complete.mjs: session-log.md append
- [ ] 기존 vibe-preflight.mjs (--bootstrap 없이) 동작 무관
