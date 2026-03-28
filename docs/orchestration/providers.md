# Provider runners

각 provider는 `.vibe/config.json`에서 프로젝트 기본값을 정의하고,
`.vibe/config.local.json`으로 로컬 override할 수 있다.
`config.local.json`이 없으면 `config.json`의 기본값으로 작동한다.

## 기본 Provider 구성

| Provider | Sprint 역할 | 명령어 |
|----------|-------------|--------|
| `claude-opus` | Orchestrator, Planner, Evaluator | `claude -p "{prompt}"` |
| `codex` | Generator | `codex exec --json "{prompt}"` |

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

### Codex 에이전트 프로필

`.codex/agents/`에 정의된 에이전트:
- `coder` — 코드 작성, workspace-write 샌드박스
- `explorer` — 코드 탐색/조사, read-only 샌드박스
