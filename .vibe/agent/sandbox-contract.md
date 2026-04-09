# Sandbox × Orchestrator 계약

> 이 문서는 Generator가 제한된 샌드박스(현재 기본: Codex `workspace-write`)에서 실행될
> 때 Orchestrator와 Generator가 각각 무엇을 책임지는지 공식화한다. 2026-04 dogfood에서
> 발생한 "Generator가 샌드박스 우회 코드를 커밋한다" 문제의 재발 방지.

## 샌드박스 기본 제약 (Codex `workspace-write`)

- **네트워크 차단** — `npm install`, `git push`, `pip install`, 외부 HTTP fetch 모두 실패.
- **파일 쓰기 허용 범위** — 현재 워크스페이스 디렉토리 내부만.
- **프로세스 수명 제한** — Orchestrator가 스트리밍 output을 기다림; 프리징과 정상 작업
  구분이 어렵다 (#8 heartbeat 참조).

## 역할 분담 매트릭스

| 단계 | Orchestrator (샌드박스 밖) | Generator (샌드박스 안) |
|---|---|---|
| **Preflight** | `git init` 확인, 의존성 사전 설치(`npm install`), 환경변수 배치 | (수행 안 함) |
| **Planning** | Planner sub-agent 호출, 체크리스트 생성, Sprint 프롬프트 조립 | (수행 안 함) |
| **Generation** | (대기) | 체크리스트 기반 코드 작성, 스모크 스크립트 추가, 자체 검증(`tsc`, smoke) |
| **Verification (light)** | (대기) | 샌드박스 내에서 가능한 검증: `tsc --noEmit`, smoke scripts |
| **Verification (heavy)** | `npm run build`, E2E, 네트워크 필요한 테스트 실행 | (수행 안 함) |
| **Revert of workarounds** | Generator가 샌드박스 우회용 영구 설정을 남겼으면 즉시 revert | (수행 안 함) |
| **Commit** | Sprint 단위로 커밋 | (수행 안 함) |

## Orchestrator preflight 체크리스트

새 Sprint 시작 전 Orchestrator가 반드시 확인한다:

1. **Git repo** — `git rev-parse --is-inside-work-tree` → true. 아니면 `git init`.
2. **의존성 동기화** — `package.json`에 새 의존성이 추가됐는지 확인. 있으면 `npm install`을
   Orchestrator가 Bash로 직접 실행 (CLAUDE.md "코드 작성 금지" 규칙은 소스 파일 한정;
   의존성 설치는 환경 세팅이라 허용).
3. **Provider health** — `codex --version` 등 한 번 체크.
4. **Sprint 프롬프트 조립** — `.vibe/agent/_common-rules.md` + Sprint 고유 체크리스트 +
   `Do NOT modify` 리스트 + Verification 리스트 순으로 구성.

## Generator final report 필수 항목

Generator는 Final report에 **"Sandbox-only failures"** 섹션을 별도로 추가한다.
샌드박스 제약 때문에 실행 못 한 명령이나 검증이 있으면 여기에 기록해 Orchestrator가
샌드박스 밖에서 대신 돌린다. 예:

```markdown
## Sandbox-only failures
- `npm run build` — 샌드박스 네트워크 차단으로 dependency fetch 실패. Orchestrator 측에서 검증 필요.
```

## Escalation

Generator가 3회 이상 같은 샌드박스 에러로 실패하면 Orchestrator가 개입한다:
1. 샌드박스 밖에서 문제 재현 시도
2. 재현되면 Generator에게 보내는 프롬프트에 해결책 명시 후 재위임
3. 재현 안 되면 (샌드박스 전용) Orchestrator가 대신 수행하고 Final report에 기록
