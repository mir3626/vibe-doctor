# Provider runners

각 provider는 `.vibe/config.json`에서 프로젝트 기본값을 정의하고,
`.vibe/config.local.json`으로 로컬 override할 수 있다.
`config.local.json`이 없으면 `config.json`의 기본값으로 작동한다.

## 기본 Provider 구성

> 아래는 기본값 예시이다. 실제 역할 배정은 `/vibe-init` 또는 `.vibe/config.json` → `sprintRoles`에서 사용자가 자유롭게 설정한다.

| Provider | 호출 방법 | 비고 |
|----------|-----------|------|
| `claude-opus` | Agent 도구 (model: opus) | Claude 계열 |
| `claude-sonnet` | Agent 도구 (model: sonnet) | Claude 계열 |
| `codex` | Agent 도구 (`subagent_type: "codex:codex-rescue"`) 또는 Skill 도구 (`codex:rescue`) | **Codex 플러그인** 사용 |
| `gemini` | Bash 도구 (`gemini "{prompt}"`) | CLI 직접 실행 |

> **⚠️ Provider 호출 규칙**:
> - **Claude 계열** provider → Claude Code의 **Agent 도구** 사용 (model 파라미터 지정)
> - **Codex** → **Codex 플러그인** 사용. `codex:codex-rescue` 에이전트 (Agent 도구) 또는 `codex:rescue` 스킬 (Skill 도구)로 호출한다. Bash 도구로 CLI를 직접 호출하지 않는다.
> - **기타 비-Claude 계열** provider → **Bash 도구**로 CLI/API 명령 실행
>
> Agent 도구의 model 파라미터는 Claude 전용(sonnet/opus/haiku)이다.
> 비-Claude provider를 Agent 도구로 호출할 때는 반드시 해당 플러그인의 `subagent_type`을 지정해야 한다.

## 템플릿형 인자 치환

이 베이스는 특정 CLI 버전에 강하게 결합되지 않도록 **템플릿형 인자 치환**을 사용한다.

치환 가능한 변수:
- `{prompt}`
- `{promptFile}`
- `{cwd}`
- `{role}`
- `{taskId}`

## 병렬 실행 (run-parallel)

여러 프롬프트를 동시에 실행한다. 각 에이전트는 별도 git worktree에서 격리 실행된다.

```bash
npx tsx src/commands/run-parallel.ts \
  docs/prompts/task-a.md \
  docs/prompts/task-b.md \
  docs/prompts/task-c.md \
  --provider codex
```

- 각 프롬프트 → 별도 worktree + branch (`agent/<timestamp>-<name>`)
- 성공한 branch는 보존, 실패한 worktree는 자동 정리
- 결과는 `.vibe/runs/<date>/parallel-<batchId>.jsonl`에 기록
- `--dry-run` 플래그로 실제 실행 없이 계획만 확인 가능

### Codex 플러그인 (Claude Code 통합)

OpenAI 공식 Codex 플러그인 (`openai/codex-plugin-cc`)을 통해 Claude Code 내에서 직접 호출한다.

**설치**: `/plugin marketplace add openai/codex-plugin-cc` → `/reload-plugins`

**사용 가능한 스킬/에이전트**:
- `codex:rescue` (스킬) — Codex에 조사/수정/후속 작업 위임
- `codex:codex-rescue` (에이전트) — Agent 도구로 Codex 호출 (`subagent_type: "codex:codex-rescue"`)
- `codex:setup` (스킬) — Codex CLI 준비 상태 확인
- `codex:gpt-5-4-prompting` (내부) — Codex/GPT-5.4 프롬프트 가이드

### Codex 에이전트 프로필 (레거시 CLI)

`.codex/agents/`에 정의된 에이전트 (병렬 실행 등 CLI 직접 호출 시 사용):
- `coder` — 코드 작성, workspace-write 샌드박스
- `explorer` — 코드 탐색/조사, read-only 샌드박스
