# Product context

이 저장소는 **vibe-doctor** — Claude Code 오케스트레이션 기반 Sprint 개발 템플릿입니다.

> ℹ️ **템플릿 사용자 안내**: 이 문서는 vibe-doctor 저장소 자체의 product context 입니다.
> 이 템플릿을 clone해 본인 프로젝트를 시작하는 경우 `/vibe-init` 을 실행하면
> 이 파일이 사용자의 프로젝트 인터뷰 결과로 **덮어씌워집니다**. downstream 프로젝트에
> vibe-doctor의 product 설명이 남지 않습니다.

## 한 줄 설명

`git clone` → `/vibe-init` → 첫 Sprint까지 빠르게 도달할 수 있는, Windows/macOS/Linux 공용 Claude Code Sprint 개발 베이스 템플릿.

## 성공 기준

- **Zero-setup 온보딩** — 신규 저장소에서 `claude` → `/vibe-init` 흐름 하나로 환경 점검, provider 인증, 프로젝트 맞춤 설정이 끝난다. 사용자는 수동으로 고칠 파일이 없다.
- **Sprint 프로세스 강제** — 모든 코드 변경은 Planner → Generator → Evaluator 3단계를 거친다. Orchestrator(Claude Opus)는 직접 소스코드(`.ts`, `.tsx`, `.py` 등)를 편집하지 않고 문서/설정만 쓴다. Generator는 `Bash("codex exec ...")` 로 Codex CLI에 위임한다.
- **Cross-platform** — 동일한 명령이 Windows / macOS / Linux에서 같은 결과를 낸다. CI(Ubuntu)는 `typecheck` → `build` → `test` → `vibe:config-audit` 4단계를 모두 통과해야 한다. `.gitattributes` 가 줄 끝을 강제해 CRLF 드리프트를 차단한다.
- **Provider-agnostic** — `claude-opus`, `codex`를 기본으로 하되 `.vibe/config*.json` 의 `providers` 맵을 통해 Gemini, DeepSeek, Grok 등 임의의 CLI를 Sprint 역할(Planner/Generator/Evaluator)에 연결할 수 있다. 하드코딩된 provider 이름이 코드에 없다.
- **얇은 루트 컨텍스트** — `CLAUDE.md` 는 200줄 이내로 유지. 상세 규칙은 `docs/context/*` shard에서 필요할 때만 읽는다. 컨텍스트 폭주를 방지하기 위해 Sprint 마다 fresh sub-agent를 생성/소멸한다.
- **자기-적용성** — `src/commands/*` 의 8개 `vibe:*` 스크립트는 (1) 템플릿 자체의 QA/보고/감사 도구인 동시에 (2) Sprint 프로세스의 실사용 예시 역할을 한다. 템플릿이 자기 자신을 검증한다.

## 플랫폼 / 런타임

- **Node.js 24+** (Active LTS, ESM, TypeScript strict 모드)
- **Claude Code CLI** (Opus 4.6 기본 오케스트레이터)
- **Codex CLI** (기본 Generator, `codex exec` 로 직접 호출 — 플러그인 경로는 Windows 불안정 이슈로 잠정 보류)
- 선택: Gemini, 임의 CLI provider를 `/vibe-init` "기타" 옵션으로 연결 가능

## 핵심 가정

- 사용자는 Claude Code를 설치했거나 설치할 수 있다.
- Sprint 기반 반복 개발의 비용이 one-shot 코드 생성보다 가치 있다는 데 동의한다.
- Orchestrator(Opus)가 직접 코딩하지 않고 Generator CLI에 위임하는 구조를 수용한다 — 비용 방어와 컨텍스트 보호 목적.
- 다운스트림 프로젝트는 clone 직후 `/vibe-init` 을 실행해 이 context 파일들을 자신의 것으로 교체한다.
- 민감 정보는 `.env` / `secrets/` 에만 두고 git에 커밋하지 않는다 (`vibe:config-audit` 이 매 커밋 전 hook + 매 CI에서 감시).
- Windows 한국어 환경에서도 mojibake 없이 UTF-8 round-trip이 안전해야 한다 (`scripts/run-codex.sh` 의 `chcp.com` 처리가 이것을 강제).

## 비-goal (의도적 배제)

- **멀티 에이전트 병렬 실행 프레임워크**가 아니다. Sprint는 직렬이며, 에스컬레이션은 트리거 매트릭스에 따라 Evaluator(Tribunal) → Planner 재소환 순으로 처리한다 (`CLAUDE.md` 의 "실패 에스컬레이션" 참조).
- **코드 생성 속도 경쟁 도구**가 아니다. context checkpoint(Planner/Evaluator 소환)가 필요한 순간에 그걸 건너뛰는 방향의 최적화는 거부된다.
- **범용 AI 에이전트 SDK**가 아니다. Claude Code 오케스트레이터 하나에 최적화한다.
