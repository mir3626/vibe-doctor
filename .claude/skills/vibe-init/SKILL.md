---
name: vibe-init
description: 프로젝트 초기 세팅을 대화형으로 진행합니다. 환경 점검, provider 인증, 프로젝트 맞춤 설정까지 자동으로 안내합니다.
---

이 스킬은 프로젝트 초기 세팅을 Claude Code 대화형으로 진행합니다.
총 5단계(Phase)로 구성되며, 각 Phase를 순서대로 진행합니다.

---

## Phase 1 — 환경 점검 (doctor)

`npm run vibe:init`을 실행하여 기본 파일(`.env`, `.vibe/config.local.json`)을 생성한 뒤,
아래 환경 점검을 직접 수행합니다:

1. **필수 도구 확인** — `node` (>=24, Active LTS), `npm`, `git`, `bash` (Windows는 Git Bash)
   - 하나라도 없으면 설치 방법을 안내하고 중단합니다.

2. **AI Agent CLI 확인** — `claude`, `codex` CLI 등 존재 여부를 확인합니다.
   - Codex는 **CLI** (`codex exec`)로 직접 호출합니다. 플러그인(`codex:rescue`)은 Windows 불안정·속도 저하로 보류.

3. **ouroboros 설치 확인** — `python -m ouroboros --version`으로 ouroboros-ai 패키지 설치 여부를 확인합니다.
   - **패키지명은 `ouroboros-ai`** 입니다 (하이픈 없는 `ouroboros`가 아님). PyPI에서 `ouroboros`로 검색하면 다른 패키지가 나오므로 반드시 `ouroboros-ai`로 설치해야 합니다.
   - **Python 3.12 이상**이 필요합니다. 먼저 `python --version`으로 확인하고, 3.12 미만이면 사용자에게 업그레이드를 먼저 안내합니다 (3.12 미만에서는 `Could not find a version that satisfies the requirement ouroboros-ai` 에러가 발생).
   - 미설치인 경우 아래 순서로 안내하고, 사용자 승인 후 설치합니다:
     1. `pipx install "ouroboros-ai[all]"` (권장 — 격리 환경)
     2. `pip install --user "ouroboros-ai[all]"` (pipx 미설치 시)
     3. `curl -fsSL https://raw.githubusercontent.com/Q00/ouroboros/main/scripts/install.sh | bash` (macOS/Linux 원클릭)
   - 설치 완료 후 `ouroboros setup`을 한 번 실행하도록 안내합니다.
   - **설치 실패 시 최대 3회까지 재시도합니다.** 각 재시도마다 실패 원인을 진단하고 다른 방법을 시도합니다:
     - `Could not find a version...` → Python 버전이 3.12 미만. 업그레이드 안내 후 중단.
     - `externally-managed-environment` (PEP 668) → `pipx` 또는 `--break-system-packages` 대신 가상환경 사용 안내.
     - 네트워크/SSL 오류 → `--index-url https://pypi.org/simple` 재시도.
     - pip 경로 문제 → `python -m pip install ...` 형식으로 재시도.
   - **3회 모두 실패한 경우**: 즉시 수동 Q&A로 전환하지 않습니다. 사용자에게 상황을 설명하고 다음 중 선택하도록 질문합니다:
     ```
     ouroboros 설치가 3회 시도 모두 실패했습니다.
     원인: {마지막 에러 메시지 요약}

     다음 중 선택해주세요:
       1. 수동 Q&A로 진행 — ouroboros 없이 Orchestrator가 직접 질문합니다
       2. 직접 설치 후 재시도 — 터미널에서 직접 설치한 뒤 알려주세요
       3. ouroboros 없이 기본값으로 건너뛰기 — Phase 3를 기본 템플릿으로 진행합니다
     ```
   - 설치 성공 시 `.mcp.json`에 ouroboros MCP 서버가 등록되어 있는지 확인합니다.
   - **MCP 연결 상태 확인 및 stale PID 트러블슈팅 (Windows 필수)**:
     - `claude mcp list` 실행 결과에서 `ouroboros ... ✗ Failed to connect`가 표시되는지 확인합니다.
     - 실패 시 가장 흔한 원인은 **stale PID 파일**입니다. Claude Code나 이전 ouroboros 프로세스가 비정상 종료되면 `~/.ouroboros/mcp-server.pid`에 죽은 PID가 남는데, Windows에서는 `os.kill(pid, 0)`이 `ProcessLookupError` 대신 Python 내부 `SystemError`를 발생시켜 ouroboros(≤ 0.27.1)의 stale detection 로직(`cli/commands/mcp.py`)이 이를 못 잡고 기동 단계에서 크래시합니다.
     - **임시 조치**: `rm -f ~/.ouroboros/mcp-server.pid` 실행 → `claude mcp list`로 재확인 → `✓ Connected`로 바뀌면 완료. 이 조치는 Phase 3에서 `ouroboros_interview` MCP 도구 호출의 전제 조건이므로 Phase 1 단계에서 반드시 처리해야 합니다.
     - PID 파일 삭제 후에도 실패하면 `python -m ouroboros mcp serve --llm-backend claude_code 2>err.log` 를 직접 실행해 stderr 첫 수 줄을 확인하고, 그 에러를 근거로 별도 트러블슈팅을 진행합니다. (upstream 근본 수정은 ouroboros 측 이슈 리포트 대상.)
   - ouroboros는 Phase 3(기획서 작성)에서 소크라테스식 인터뷰 엔진으로 사용됩니다.

   결과를 사용자에게 보여줍니다. 예:
     ```
     환경 점검 결과:
       node (v22.x)      ✓
       npm                ✓
       git                ✓
       claude CLI         ✓
       codex CLI          ✗ (미설치)
       ouroboros          ✓ (v0.27.1)
     ```
   - 이 결과는 Phase 2에서 provider 선택/인증 안내에 사용됩니다.

---

## Phase 2 — Sprint 역할별 Provider 배정 및 인증

사용자에게 Sprint의 3가지 역할에 대해 **각각** 어떤 AI를 사용할지 물어봅니다.

### Step 2-1: 역할별 Provider 선택

> **Fast-path (기본값 일괄 수용)**: 사용자가 "기본", "default", "엔터", "그대로" 등으로
> 답하거나, 이미 `.vibe/config.local.json`이 존재하고 `sprintRoles`가 채워져 있으면
> 세 역할을 모두 기본값(`claude-opus` / `codex` / `claude-opus`)으로 즉시 확정하고
> Step 2-2의 인증 확인으로 바로 넘어갑니다. 역할별 개별 질문을 반복하지 않습니다.
> dogfood/재실행 케이스에서 Phase 2가 불필요하게 질문을 반복하는 것을 방지합니다.

아래와 같이 질문합니다:

```
Sprint 역할별 AI를 설정합니다. 각 역할에 어떤 AI를 사용할지 선택해주세요.
기본값은 괄호 안에 표시됩니다. 그대로 쓰려면 엔터만 누르면 됩니다.
(전체 기본값을 한 번에 수용하려면 "기본" 이라고 답하면 됩니다.)

1. Planner (스펙 정의 — "무엇을" 만들지 정의) [기본: claude-opus]
   선택지: claude-opus / codex / 기타

2. Generator (코드 구현 — 체크리스트 기반 구현) [기본: codex (CLI)]
   선택지: codex / claude-opus / 기타

3. Evaluator (판정 — 합격/불합격 판정) [기본: claude-opus]
   선택지: claude-opus / codex / 기타

"기타"를 선택하면 커스텀 AI agent를 연결할 수 있습니다.
```

사용자가 **"기타"**를 선택한 경우, 추가 질문:

```
커스텀 AI agent 설정:
  - provider 이름은 뭔가요? (예: deepseek, grok, gemini, aider)
  - CLI 명령어는 뭔가요? (예: deepseek, grok)
  - 프롬프트를 전달하는 인자 형식은 어떻게 되나요?
    예시) deepseek --prompt "{prompt}"
    예시) grok chat "{prompt}"
    모르면 비워두세요. 나중에 .vibe/config.local.json에서 직접 수정할 수 있습니다.
```

### Step 2-2: 선택된 Provider 인증 확인

각 선택된 provider에 대해 CLI가 설치되어 있는지 Phase 1 결과를 참조하여 확인합니다.

**CLI가 미설치인 경우**, 해당 provider의 설치 및 인증 방법을 step-by-step으로 안내합니다:

| Provider | 설치 안내 | 인증 안내 |
|----------|-----------|-----------|
| codex | `npm install -g @openai/codex` 으로 Codex CLI 설치. `codex --version`으로 설치 확인 | 아래 인증 방식 선택 안내 참조 |
| claude-opus | Claude Code 사용 중이므로 이미 인증됨 | - |
| 기타 (custom) | 사용자가 알려준 설치 방법 또는 "해당 AI의 공식 문서를 참고하세요" | 사용자에게 인증 방법 확인 |

**Codex CLI 인증 방식 선택** (codex가 선택된 경우):

Codex CLI 설치 후, 사용자에게 인증 방식을 선택하도록 안내합니다:

```
Codex CLI 인증 방식을 선택해주세요:

  1. OAuth 로그인 (기본, 권장)
     → `codex auth login` 실행 후 브라우저에서 OpenAI 계정 로그인
     → API 키 관리 없이 간편하게 사용 가능

  2. API 키 직접 설정
     → OPENAI_API_KEY 환경변수에 API 키를 설정
     → .env 파일에 추가하거나, 터미널에서 직접 설정
```

사용자가 **1 (OAuth)**를 선택한 경우:
- `! codex auth login` 실행을 안내합니다 (사용자가 직접 실행)
- 브라우저 로그인 완료 후 `codex auth status`로 인증 상태를 확인합니다

사용자가 **2 (API 키)**를 선택한 경우:
- `.env` 파일에 `OPENAI_API_KEY=sk-...` 추가를 안내합니다
- 또는 `! export OPENAI_API_KEY=sk-...` 로 현재 세션에서 직접 설정하도록 안내합니다

---

안내 후 사용자에게 확인합니다:
```
설치/인증을 지금 진행하시겠어요?
  - "예" → 사용자가 터미널에서 직접 명령 실행하도록 안내 (! 명령어 prefix 안내)
  - "나중에" → 건너뛰고 다음 단계로 진행
  - "건너뛰기" → 해당 provider를 일단 설정만 해두고 나중에 연결
```

### Step 2-3: 설정 파일 업데이트

선택 결과를 바탕으로 아래 파일들을 업데이트합니다:

#### `CLAUDE.md` (CRITICAL — 반드시 수행)

`<!-- BEGIN:SPRINT_ROLES -->` ~ `<!-- END:SPRINT_ROLES -->` 영역의 역할 테이블을 선택된 provider 이름으로 교체합니다.
또한 CRITICAL 블록 내 `Generator sub-agent(현재 설정: **{이전 값}**)` 부분을 선택된 generator provider로 업데이트합니다.

이 업데이트는 context 압축 후에도 올바른 모델이 참조되도록 보장하기 위해 필수입니다.

예시 (generator를 deepseek로 선택한 경우):
```markdown
<!-- BEGIN:SPRINT_ROLES (vibe-init 자동 업데이트 영역) -->
| 역할 | Provider | 상주 여부 | 책임 |
|------|----------|-----------|------|
| **Orchestrator** | **claude-opus** (메인 대화) | 상주 | Sprint 생명주기 관리, 사용자 소통, context 전달, 보고서 |
| **Planner** | **claude-opus** (sub-agent) | Sprint 내 | "무엇을(WHAT)" 정의 + 완료 체크리스트 작성 |
| **Generator** | **deepseek** (sub-agent) | Sprint 내 | 체크리스트 기반 코드 구현 (HOW는 Generator 재량) |
| **Evaluator** | **claude-opus** (sub-agent) | Sprint 내 | 체크리스트 기준 합격/불합격 판정 |
<!-- END:SPRINT_ROLES -->
```

CRITICAL 블록도 업데이트:
```markdown
> 모든 코드 구현은 반드시 Generator sub-agent(현재 설정: **deepseek**)를 생성하여 위임한다.
```

#### `.vibe/config.local.json`

선택한 Sprint 역할 구성을 반영합니다. 커스텀 provider는 `providers` 맵에 추가합니다.

##### OS 감지 + platform-native 경로 자동 기입 (CRITICAL — Windows 지원)

`config.local.json`을 작성하기 전 Orchestrator가 OS와 설치된 CLI 경로를 탐색하여
`providers.*.command` 를 플랫폼 적합한 형식으로 기입합니다. 이 단계를 건너뛰면 Windows
Git Bash 환경에서 `node` 의 기본 쉘이 cmd.exe로 fallback되어 `./scripts/run-codex.sh`
같은 POSIX 경로가 `vibe-preflight` 의 provider health check에서 실패합니다 (dogfood5
재현 사례).

**탐색 절차**:

1. Node / bash 로 OS 감지:
   - Windows: `node -e "console.log(process.platform)"` → `win32`
2. `codex` CLI 절대 경로 탐색:
   - Windows: `cmd //c "where codex"` → 첫 번째 `.cmd` 라인 추출 (예: `C:\Users\{user}\AppData\Roaming\npm\codex.cmd`)
   - POSIX: `which codex` → 그대로 사용
3. `claude` CLI 절대 경로 탐색 (동일 방식)
4. 탐색 결과를 `.vibe/config.local.json` 의 `providers.*.command` 로 기입:

   **Windows 결과 예시**:
   ```json
   "providers": {
     "claude-opus": {
       "command": "C:\\Users\\{user}\\.local\\bin\\claude.exe",
       "args": ["-p", "{prompt}"],
       "env": {}
     },
     "codex": {
       "command": "C:\\Users\\{user}\\AppData\\Roaming\\npm\\codex.cmd",
       "args": ["exec", "--json", "{prompt}"],
       "env": {}
     }
   }
   ```

   **POSIX (macOS/Linux) 결과 예시**:
   ```json
   "providers": {
     "claude-opus": {
       "command": "claude",
       "args": ["-p", "{prompt}"],
       "env": {}
     },
     "codex": {
       "command": "./scripts/run-codex.sh",
       "args": ["{prompt}"],
       "env": {}
     }
   }
   ```

5. 탐색 실패 시: 해당 CLI가 미설치 상태로 간주하고 Phase 2의 "CLI 미설치" 흐름으로 분기.
   config.local.json에는 기본 POSIX 경로(`./scripts/run-codex.sh` 등)를 임시로 두고,
   사용자에게 "Windows 환경이면 codex 설치 후 `where codex` 결과를 config.local.json
   에 반영해주세요" 1줄 경고 출력.

> Generator 호출 자체는 Orchestrator가 항상 `run-codex.sh` 를 통해 UTF-8 wrapping을 받도록 하지만, `vibe-preflight` 의 `provider.* --version` health check는 config.local.json의 `command` 를 cmd.exe/sh 를 통해 직접 실행하므로 플랫폼 적합한 경로가 필수입니다.

##### 커스텀 generator provider 예시

예시 (generator를 deepseek로 선택한 경우):
```json
{
  "orchestrator": "claude-opus",
  "sprintRoles": {
    "planner": "claude-opus",
    "generator": "deepseek",
    "evaluator": "claude-opus"
  },
  "sprint": {
    "unit": "feature",
    "subAgentPerRole": true,
    "freshContextPerSprint": true
  },
  "providers": {
    "claude-opus": {
      "command": "claude",
      "args": ["-p", "{prompt}"],
      "env": {}
    },
    "codex": {
      "command": "./scripts/run-codex.sh",
      "args": ["{prompt}"],
      "env": {}
    },
    "deepseek": {
      "command": "deepseek",
      "args": ["--prompt", "{prompt}"],
      "env": {}
    }
  }
}
```

#### `AGENTS.md`

Generator로 선택된 provider에 맞게 파일 내용을 수정합니다.
- 기본 codex가 아닌 경우, 파일 상단의 provider 이름을 변경합니다.
- 예: generator가 deepseek인 경우:
  ```markdown
  # DeepSeek project memory

  너의 기본 역할은 Sprint의 **Generator (코드 구현)** 다.
  ...
  ```

#### `CLAUDE.md` 의 `<!-- BEGIN:SPRINT_ROLES -->` 영역

선택된 역할 배정을 이 영역의 표에 반영합니다. 이 표가 Sprint 역할의 single source of truth입니다.

#### `docs/orchestration/providers.md`

커스텀 provider가 추가된 경우, 해당 provider 섹션을 문서에 추가합니다.

---

## Phase 3 ? ???? ?? ?? (native socratic interview: vibe-interview)

Phase 3? ?? ??? ??? ?? `vibe-interview` ???. primary flow??? ouroboros-ai / MCP? ???? ????.
?? ?? ??? `.claude/skills/vibe-interview/SKILL.md` ? authoritative runbook?? ?????.

> **CRITICAL ? Phase 3? ?? ??**: ???? "?? ?? / ?? / ??? ?"?? ??? Phase 3 ??? ???? ????. ? ???? ???? ????, Orchestrator? PO-proxy? ??? ??? ???? ? ?? ?????.

### Step 3-0: ? ? ???? ??

????? ????? ???? ? ?? ?????. ? ? ?? ??? ??, ??? probing, context shard seed? ??????.

?? ??:

1. ????? ? ? ???? ??? ????.
2. `node scripts/vibe-interview.mjs --init --prompt "<one-liner>" [--lang ko|en] [--max-rounds 30] [--output .vibe/interview-log/<session-id>.json]`
3. stdout? `{ phase: "domain-inference", inferencePrompt }` ? Orchestrator? ?? ?????.
4. ??? domain string? ?? ??? ?????.
5. ?? ???? `.claude/skills/vibe-interview/SKILL.md` ? invocation protocol? ??? ????.

### Step 3-1: native socratic interview ??

- `vibe-interview` ? 10? ?? dimension? backbone?? ????, ?? ??? Orchestrator LLM? ?????.
- ? ???? ?? coverage? ?? ?? dimension? ???? 1-3?? ??? ?? ??? ?????.
- ???? "?? / ?? / ???"?? ??? ?? sub-field? deferred? ????, ???? ?? dimension?? ?? ?????.
- ?? ??? ?? ? ?????.
  - ambiguity <= 0.2
  - roundNumber > maxRounds
  - ?? required dimension coverage >= 0.5 ?? ambiguity <= 0.3

#### PO-proxy ??

???? ?? ????? ??? ??? ??, Orchestrator? ??? ?? ?? ? ????. ?? ?? ??? ????.

- ?? ??? ??? PO-proxy ?? ?? ?? pipe(`--continue` ? `--record`) ? ??????.
- ?? ??? ?? ????? ??? ??, ??? ?? ? `session-log.md` ? `[decision][phase3-po-proxy]` ? ? ?? ????.
- ?? ???? ?? ?? ????, ?? ?? ??? ?? ???? ?? ??? rationale? ?????.

### Step 3-2: interview seed? context shards? ??

???? ??? `seedForProductMd` ? dimension coverage? ???? context shards? ?????.
?? shard ?? ??? ????, ?? ??? ?????.

> **?? ? Write ?? Read**: `docs/context/*.md` 3? ??? placeholder ???? ?? ??, ? ??? ??/?????.

| seed field | ?? ?? / ?? |
|---|---|
| `dimensions.goal` | `product.md` one-liner / success criteria |
| `dimensions.target_user` | `product.md` target users |
| `dimensions.platform` | `product.md` platform |
| `dimensions.data_model` | `architecture.md` data model |
| `dimensions.primary_interaction` | `product.md` user flow |
| `dimensions.success_metric` | `product.md` acceptance criteria |
| `dimensions.non_goals` | `product.md` non-goals |
| `dimensions.constraints` | `product.md` core assumptions + `conventions.md` security rules |
| `dimensions.tech_stack` | `architecture.md` tech stack |
| `dimensions.domain_specifics` | `product.md` domain notes + `conventions.md` extra rules |

??? ?? ? Orchestrator? `seedForProductMd` ? `docs/context/product.md` ? `## Phase 3 ?? ?? (native interview)` ???? append ???.

?? ??? ?? `.ouroboros/` ????? ??(???). ???? ??.
### Step 3-3: conventions.md test and lint shard links

After Step 3-2 writes the interview seed, inspect the interview log for `tech_stack.normalized_slugs[]`.
Use `.claude/skills/test-patterns/_index.md` to map each slug to a test shard path, then derive lint shards from the language prefix:

- `ts-*` -> `typescript-debt.md`
- `py-*` -> `python-debt.md`
- `rust-*` -> `rust-debt.md`
- `go-*` -> `go-debt.md`
- always include `universal-debt.md`
- include `canvas-dom-isolation.md` or `shell-bats.md` only when their test slugs are present

Rewrite only the marker blocks below in `docs/context/conventions.md`. If a marker is missing, append the full section. Re-running must be idempotent and must preserve user-authored content outside the markers.

```md
## 테스트 전략
<!-- BEGIN:VIBE:TEST-PATTERNS -->
- TypeScript unit/integration: [.claude/skills/test-patterns/typescript-vitest.md](../../.claude/skills/test-patterns/typescript-vitest.md)
<!-- END:VIBE:TEST-PATTERNS -->

## Lint 규칙
<!-- BEGIN:VIBE:LINT-PATTERNS -->
- TypeScript debt grep: [.claude/skills/lint-patterns/typescript-debt.md](../../.claude/skills/lint-patterns/typescript-debt.md)
- Universal TODO/FIXME: [.claude/skills/lint-patterns/universal-debt.md](../../.claude/skills/lint-patterns/universal-debt.md)
<!-- END:VIBE:LINT-PATTERNS -->
```

### Step 3-4: web/frontend utility opt-in

After Step 3-3, inspect `inferred_domain`, `dimensions.platform`, and `tech_stack.normalized_slugs[]` to decide whether the project is a web/frontend candidate.

Treat the project as a web/frontend candidate when either condition matches:

- `normalized_slugs[]` includes a `ts-` stack slug related to web, browser, or mobile work such as `ts-react`, `ts-vue`, `ts-svelte`, `ts-vite`, or `ts-next`
- `platform` contains `web`, `mobile`, or `browser`

Decision flow:

- PO-proxy mode: infer `bundle.enabled` and `browserSmoke.enabled` from the detected platform/domain signals without asking the user
- Manual mode: ask exactly these questions

```
1) 번들 크기 제약이 있나요? (예: 모바일 웹, 첫 페인트 budget) [y/N]
2) 브라우저 UI 가 있어 smoke 검증을 활성화할까요? [y/N]
```

Apply the result by patching `.vibe/config.json`:

```json
"bundle": {
  "enabled": false,
  "dir": "dist",
  "limitGzipKB": 80,
  "excludeExt": [".map"]
},
"browserSmoke": {
  "enabled": false,
  "configPath": ".vibe/smoke.config.js"
}
```

Always append one session log entry with the rationale:

```md
- 2026-04-16T00:00:00.000Z [decision][phase3-utility-opt-in] bundle=true browserSmoke=false rationale=...
```

If `browserSmoke.enabled` becomes `true`, create `.vibe/smoke.config.js` only when it does not already exist. Use this skeleton:

```js
export default {
  url: 'http://localhost:5173',
  viewport: { width: 375, height: 812 },
  expectDom: ['#stage'],
  expectConsoleFree: true,
  canvasAssertions: []
};
```

Also create a root `README.md` from `.claude/skills/vibe-init/templates/readme-skeleton.md` when the file does not already exist. Replace:

- `{{project_name}}` with the first heading from `docs/context/product.md`
- `{{one_liner}}` with the interview seed one-liner
- `{{status}}` with `WIP (Phase 0 complete)`

If `README.md` already exists, skip it and print:

```text
[vibe-init] README.md exists, skipping skeleton write
```

---

## Phase 4 — 설정 요약 및 완료

### Step 4-0: Git 초기화 (CRITICAL — Codex/에이전트 위임 전제 조건)

Sprint Generator가 **Codex CLI**(또는 trust-based sandbox를 쓰는 다른 provider)인 경우,
프로젝트 루트에 `.git`이 존재하지 않으면 Codex가 `Not inside a trusted directory` 에러로
**첫 Sprint부터 즉시 실패**합니다. 따라서 여기서 git 초기화를 강제합니다.

절차:
1. `git rev-parse --is-inside-work-tree`로 기존 git 저장소 여부 확인
2. 없으면 다음을 **자동 실행** (사용자 추가 승인 불필요 — 이건 템플릿 규약):
   ```bash
   git init
   git add -A
   git -c commit.gpgsign=false commit -m "chore: initial vibe-doctor scaffold"
   ```
3. 실행 실패 시(이름/이메일 미설정 등) 실패 원인을 표시하고 사용자에게 1회 수동 실행을 요청합니다.

이 단계는 Phase 2에서 Codex/기타 샌드박스형 provider를 선택한 경우에만 필수지만,
선택과 무관하게 git 저장소가 있으면 이후 작업(커밋, 리뷰, 복구)이 모두 수월해지므로
**언제나 실행**하는 것을 기본값으로 삼습니다.

### Step 4-0a: Phase 0 seal commit

Immediately after Step 4-0 finishes, run:

```bash
node scripts/vibe-phase0-seal.mjs
```

Expected outcomes:

- exit `0` with `[phase0-seal] committed: ...` after staging the Phase 0 artifacts and creating the seal commit
- exit `0` with `[phase0-seal] already sealed (no changes)` when nothing changed
- exit `0` with `[phase0-seal] no candidate files present` when the Phase 0 files are absent

If the command exits non-zero, print the reason, tell the user to run it manually once, and continue Phase 4 without blocking.

### Step 4-0b: Agent delegation 권한 프리셋 (opt-in)

Orchestrator asks:

> Sprint 자율 실행 시 권한 프롬프트를 줄이는 agent-delegation 프리셋을 적용하시겠습니까?
> (npm install/build/test/git 등 scope 제한된 명령만 자동 허용)
> [Y/n]

- User answers Y (or PO-proxy auto-yes): run `node scripts/vibe-sprint-mode.mjs on`.
- User answers N: skip. Print "프리셋 미적용. 나중에 `/vibe-sprint-mode on`으로 활성화할 수 있습니다."
- If the script exits non-zero, print warning and continue.

### Step 4-1: 설정 요약 출력

모든 단계가 끝나면 아래를 출력합니다:

```
초기 세팅이 완료되었습니다!

  환경:
    node {버전}  ✓
    npm          ✓
    git          ✓

  Sprint 역할 설정:
    Orchestrator : claude-opus (기본)
    Planner      : {선택된 planner}  {✓ 인증됨 / ⚠ 미연결}
    Generator    : {선택된 generator}  {✓ 인증됨 / ⚠ 미연결}
    Evaluator    : {선택된 evaluator}  {✓ 인증됨 / ⚠ 미연결}

  작성/수정된 파일:
    - CLAUDE.md                        (Sprint 역할 테이블 + CRITICAL 블록)
    - .vibe/config.local.json          (Sprint 역할 + provider 설정)
    - docs/context/product.md          (프로젝트 목표)
    - docs/context/architecture.md     (기술 스택)
    - docs/context/conventions.md      (코드 규칙)
    - AGENTS.md                        (Generator 규칙)

이제 목표를 말씀해주시면 Sprint 단위로 작업을 시작할 수 있습니다.
예) "Goal: 로그인 페이지를 만들어줘"
```

---

## 중요 규칙

- 질문은 **친절하고 쉬운 말**로 합니다. 코딩을 모르는 사용자를 대상으로 합니다.
- 각 Phase/Step을 순서대로 진행하며, 답변을 받은 후 파일을 작성하고 다음으로 넘어갑니다.
- 사용자가 "모름", "잘 모름", "패스", "기본" 등으로 답하면 기본값을 사용합니다.
- 빈 답변도 허용합니다. 빈 값은 기본값으로 채웁니다.
- `npm run vibe:init` 실행이 실패하면 원인을 파악하여 해결 후 재시도합니다.
- provider 인증 시, 사용자가 직접 터미널 명령을 실행해야 하는 경우 `! 명령어` 형식을 안내합니다.
- 커스텀 provider의 CLI 인자 형식을 모르는 경우, 기본 템플릿(`["--prompt", "{prompt}"]`)을 사용하고 나중에 `.vibe/config.local.json`에서 수정 가능하다고 안내합니다.
- AGENTS.md는 파일명은 유지하되, 내용만 선택된 Generator provider에 맞게 수정합니다.
