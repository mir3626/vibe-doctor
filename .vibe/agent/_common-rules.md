# Sprint 공용 규칙 (프롬프트 조각)

> **사용법**: Planner는 Sprint 프롬프트를 생성할 때 이 파일의 내용을 "Rules" 섹션 앞에
> 그대로 붙이거나, 프롬프트 상단에 `(공용 규칙은 `.vibe/agent/_common-rules.md` 준수)`
> 한 줄 포함 후 Sprint 고유 규칙만 추가한다. 중복을 피해 토큰 예산을 절약한다.

## 1. 샌드박스 우회 금지 (CRITICAL)

Generator가 샌드박스(예: Codex `workspace-write`) 안에서 실행 중이라는 이유로 **영구
설정 파일에 우회 코드를 남기는 것을 금지**한다. 샌드박스 전용 문제는 Generator가 해결할
책임이 없다. 발견 시 Orchestrator가 즉시 revert하며, Evaluator는 이를 자동 불합격 사유로
삼는다.

금지 예시:
- `next.config.ts`에 `experimental.webpackBuildWorker: false`, `workerThreads: true`
- `package.json` build 스크립트에 `--experimental-build-mode compile` (정적 생성 스킵)
- `tsconfig.json`에 `"skipLibCheck": true`를 샌드박스 회피용으로 추가
- webpack `externals`에 core 모듈 직접 등록

원칙: "샌드박스 안에서 통과 못 하는 빌드는 스킵하고 final report에 'sandbox-only
failure, escalate'라고 명시". 영구 파일을 건드리지 않는다.

## 2. 의존성 설치 금지

`npm install`, `pip install`, `cargo add` 등 **네트워크가 필요한 의존성 설치 명령을
Generator가 실행하지 않는다**. 필요한 패키지는 Sprint 프롬프트에 "이미 설치되어 있음"
또는 "Orchestrator가 사전 설치함"이라고 명시되어 있어야 한다. 없다면 Generator는 Final
report에 요구 패키지 목록을 남기고 코드 작성을 보류한다.

## 3. 수정 금지 목록 존중

각 Sprint 프롬프트의 "Do NOT modify" 목록을 엄격히 준수한다. 해당 파일을 수정해야만
체크리스트를 만족할 수 있다면, 코드 수정 대신 Final report에 "blocked by do-not-modify"
항목으로 보고한다.

## 4. 언어 / 품질 기준 (TypeScript 프로젝트 기본값)

- TypeScript `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` 전제.
- `any` 금지. 경계에서 `unknown` + 타입 가드.
- ESM 전용 — `require()` 금지.
- 주석/문서는 필요한 부분에만. 기존 코드에 장식용 주석 추가 금지.
- 테스트/에러 핸들링은 실제 필요한 범위에만 — 하이포세틱 시나리오 방어 금지.

## 5. 범위 준수

Sprint 체크리스트에 없는 "개선"/"리팩터"/"추가 기능"을 수행하지 않는다. 버그 발견 시
수정은 하되, 수정 범위를 체크리스트 관련 파일로 제한하고 Final report에 별도 항목으로
기록한다.

## 6. 최종 검증 출력

각 Sprint가 지정한 검증 명령을 전부 실행하고 exit code를 Final report에 표로 기록한다.
실행하지 않았거나 실패한 명령이 하나라도 있으면 "완료"라고 보고하지 않는다.

## 7. Sandbox × Orchestrator 계약 (구 sandbox-contract.md 흡수)

Generator는 보통 제한된 샌드박스(현재 기본: Codex `workspace-write`)에서 실행된다. 네트워크 차단 + 워크스페이스 외부 쓰기 금지 + 프로세스 수명 제한이 걸려 있다.

**역할 분담**:

| 단계 | Orchestrator (밖) | Generator (안) |
|---|---|---|
| Preflight | `git init`, 의존성 사전 설치, 환경변수 배치 | — |
| Planning | 체크리스트 생성, Sprint 프롬프트 조립 | — |
| Generation | 대기 | 코드 작성, 스모크 스크립트 추가, 자체 검증 |
| Light verify | 대기 | `tsc --noEmit`, smoke scripts |
| Heavy verify | `npm run build`, E2E, 네트워크 필요 검증 | — |
| Workaround revert | 샌드박스 우회용 영구 설정 발견 시 즉시 revert | — |
| Commit | Sprint 단위 커밋 | — |

**Generator Final report 필수 섹션** — "Sandbox-only failures". 샌드박스 제약 때문에 실행 못 한 명령/검증을 이 섹션에 기록하면 Orchestrator가 밖에서 대신 돌린다. §1(샌드박스 우회 금지)을 우회하기 위한 출구이기도 하다.

**Escalation** — Generator가 3회 이상 같은 샌드박스 에러로 실패하면 Orchestrator가 개입: (1) 밖에서 재현 → (2) 해결책 명시 후 재위임 또는 (3) 직접 수행 + Final report 기록.

## 8. Final report 형식

Short markdown으로 아래 섹션을 순서대로 포함:

```markdown
## Files added
- path — 한 줄 설명

## Files modified
- path — 한 줄 설명

## Verification
| command | exit |
|---|---|
| npx tsc --noEmit | 0 |
| node scripts/xxx-smoke.mjs | 0 |

## Deviations
- (없으면 "none"; 있으면 이유와 함께 나열)
```
