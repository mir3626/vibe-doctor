# Sprint M11 — Ouroboros 완전 제거 (v1.2.1 패치)

## 배경

v1.2.0 Sprint M5 가 Ouroboros 를 **"optional enhancement / 고급 모드"** 수준으로만 다루고 설치 가이드·fallback 코드·MCP 서버 등록을 그대로 보존함. 사용자 지시는 "Item 22 Native dynamic 인터뷰로 Ouroboros 를 완전 대체, fallback 불필요" 였으므로 **전량 제거** 가 필요. 본 Sprint M11 은 v1.2.1 패치로 이 정리를 완결한다.

## 범위 (정확히 이 파일들만 수정)

### 1. `.mcp.json` — ouroboros MCP 서버 엔트리 제거

```json
{
  "mcpServers": {}
}
```

혹은 파일 자체를 삭제 (MCP 서버 없으면 빈 객체 유지). 선호: 빈 `mcpServers` 유지 (다른 MCP 추가 편의).

### 2. `CLAUDE.md` — 4곳 Ouroboros 문자열 교체

- Line 35: "Phase 0 Ouroboros 인터뷰 직후" → "Phase 0 네이티브 인터뷰 (`scripts/vibe-interview.mjs`) 직후"
- Line 64: Policy table 의 "Phase 0 Ouroboros 인터뷰" → "Phase 0 네이티브 소크라테스식 인터뷰"
- Line 89: "네이티브 소크라테스식 인터뷰 (Ouroboros fallback)" → "네이티브 소크라테스식 인터뷰" (fallback 문구 제거)
- Line 139: "Ouroboros 소크라테스식 인터뷰 — /vibe-init Phase 3 (vibe-interview (scripts/vibe-interview.mjs))" → "네이티브 소크라테스식 인터뷰 — /vibe-init Phase 3 (`scripts/vibe-interview.mjs`)"

### 3. `.claude/skills/vibe-init/SKILL.md` — Ouroboros 설치 섹션 전량 삭제 + mojibake 복구

- Phase 1 에서 "ouroboros 설치 확인" 섹션 **전체 삭제** (현재 line 22-51 영역). 대체: 간단한 "Native interview 는 설치 불필요 — `scripts/vibe-interview.mjs` 는 Node 24+ 만으로 동작" 1줄 안내.
- Phase 1 환경 점검 예시 결과에서 `ouroboros          ✓ (v0.27.1)` 라인 제거.
- 기타 `ouroboros` / `ouroboros_interview` / `.ouroboros/` 참조 모두 네이티브 equivalent 로 교체 또는 삭제.
- **mojibake 복구** — line 305, 362 영역의 `?? ??? ???` 같은 깨진 한글을 올바른 문장으로 재작성. 기존 의미:
  - line 305 부근: "Phase 3 인터뷰 시 `vibe-interview` 를 사용한다. Ouroboros-ai / MCP 는 사용하지 않는다." → 단순화: "Phase 3 인터뷰는 `vibe-interview.mjs` 만 사용한다."
  - line 362 부근: "기존 세션에 남은 `.ouroboros/` 디렉토리는 삭제(선택적). 현재는 사용하지 않음." → 유지: "기존 세션에 `.ouroboros/` 디렉토리가 있어도 vibe-doctor 는 사용하지 않음 (사용자가 직접 제거 가능)."
- Phase 3 로직 재작성 시 `ouroboros_interview` / `ouroboros_pm_interview` MCP 도구 호출 언급 완전 삭제.

### 4. `README.md` — Python / Ouroboros 섹션 삭제

- Line 11: "Native socratic interview — Ouroboros MCP 의존 제거. ..." 은 feature list 니까 **보존** (v1.2 업적 기록).
- Line 108-143 영역의 "Python 3.12+", "ouroboros-ai 설치", "고급 인터뷰 모드" 섹션 **전량 삭제**.
- 요구사항 섹션: "Node.js 24+, Claude Code CLI, Codex CLI" 만 남김. Python / ouroboros-ai 요구사항 삭제.

### 5. `scripts/vibe-preflight.mjs` — Ouroboros 문자열 1곳

- Line 284: `'missing docs/context/product.md - run Phase 0 (Ouroboros PM interview) first'` → `'missing docs/context/product.md - run Phase 0 native interview (vibe-interview.mjs) first'`

### 6. `scripts/vibe-stop-qa-gate.mjs` — `.ouroboros/` 경로

- Line 19: ignore 경로 리스트에서 `.ouroboros/` **유지** (legacy 디렉토리 무시 목적). 단 주석으로 "legacy — safe to ignore" 추가. 혹은 제거도 무방 (legacy 디렉토리는 이제 생성 안 됨). 선호: **제거** (깨끗하게).

### 7. `docs/context/product.md`

- Line 28: "ouroboros-ai (Python 3.12+, /vibe-init Phase 3의 소크라테스식 인터뷰 엔진)" → 이 라인 **삭제** (Native interview 로 대체되었으므로 의존 목록에 둘 필요 없음).

### 8. `docs/context/orchestration.md` — 6곳

- Line 23, 47, 66, 83, 84, 185 의 "Ouroboros" / "`ouroboros_interview`" 언급을 모두 "네이티브 인터뷰" / "`scripts/vibe-interview.mjs`" 로 교체. 의미 유지, 엔진만 교체.

### 9. `docs/context/tokens.md`

- Line 12: "No external token cost vs Ouroboros (which ran out-of-process)" → "No external token cost — native interview is in-window Orchestrator evaluation." (Ouroboros 비교 문구 제거, 긍정 진술만 남김.)

### 10. `.gitignore`

- `.ouroboros/` 엔트리 **유지**. 이유: 기존 downstream 프로젝트가 legacy `.ouroboros/` 디렉토리를 가지고 있을 수 있고, 어쨌든 무시하는 것이 안전. 주석 "# legacy ouroboros sessions (no longer written)" 추가.

### 11. `docs/context/harness-gaps.md`

- 신규 entry 추가:
  ```markdown
  - [gap-XX] ouroboros-dependency-purge
    - symptom: v1.2.0 에서 Ouroboros 참조가 docs/scripts 잔존 (optional enhancement 수준으로 보존).
    - covered_by: Sprint M11 (v1.2.1)
    - status: covered
  ```

### 12. `docs/release/v1.2.1.md` (신규) — 패치 릴리스 노트

- 한 단락 요약: "Ouroboros 의존 완전 제거. native interview 가 유일한 엔진." + 업그레이드 경로 (`npm run vibe:sync`).

### 13. `package.json` — harnessVersion "1.2.1"
### 14. `.vibe/config.json` — harnessVersion "1.2.1"
### 15. `migrations/1.2.1.mjs` (신규, 간단):
  - `.mcp.json` 에 ouroboros 엔트리 있으면 제거 (idempotent).
  - `harnessVersionInstalled` 를 1.2.1 로 bump (downgrade 없음).
  - `sync-manifest.json.migrations` 에 `"1.2.1": "migrations/1.2.1.mjs"` 추가.

### 16. `.vibe/sync-manifest.json`
  - `migrations["1.2.1"]` 엔트리 추가.
  - 신규 파일 `migrations/1.2.1.mjs`, `docs/release/v1.2.1.md` harness 등록.

## 범위 밖 (손대지 말 것)

- `docs/prompts/sprint-M*.md` (아카이브 — 역사 기록)
- `docs/reports/*.md` (완료된 보고서)
- `docs/plans/dogfood6-improvements.md` (역사)
- `docs/release/v1.2.0.md` (릴리스 노트 자체는 v1.2.0 상태 보존; v1.2.1 은 별도 파일)
- `docs/prompts/sprint-M5-native-interview.md` 포함 아카이브 파일들

## 검증

| 조건 | 명령 |
|---|---|
| tsc 0 errors | `npx tsc --noEmit` |
| 기존 테스트 pass 유지 | `npm test` |
| 하드-grep: live docs 에 "ouroboros" 0 히트 (docs/release/v1.2.0.md 의 언급 빼고) | `rg -i ouroboros CLAUDE.md README.md .claude/skills/vibe-init/SKILL.md scripts/*.mjs docs/context/*.md .mcp.json` → 결과 없음 |
| mojibake 복구 | `.claude/skills/vibe-init/SKILL.md` line 305, 362 에 깨진 한글 없음 |
| migration 1.2.1 idempotent | 2회 실행 시 2번째는 no-op |

## Final report 형식
§_common-rules §9. Verification 표에 위 조건.
