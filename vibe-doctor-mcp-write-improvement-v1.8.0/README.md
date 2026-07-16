# Vibe Doctor MCP App Write-Path Improvement

- Repository: `mir3626/vibe-doctor`
- Reviewed `main`: `60511059e787301216b4ece7706c4c7b1328e6a7`
- Reviewed release: `v1.8.0`
- Review date: 2026-07-15 KST
- Scope: Vibe Pro Bridge MCP tool discovery, write invocation, result publication, auth/permissions, diagnostics, Web review completion contract

## 결론

현재 tool catalog에는 write operation이 이미 존재한다.

```text
create_request
create_design_request
claim_request
begin_result
put_result_file
finalize_result
acknowledge_import
cancel_request
```

문제는 `write`라는 이름의 tool 부재가 아니다.

현재 Web reviewer의 사용자 작업은:

```text
완료된 review/design package를 CLI import용으로 게시
```

인데, model-facing tool surface는 이를 다음 여러 transport operation으로 분해한다.

```text
claim_request
→ begin_result
→ put_result_file × N
→ finalize_result
```

이 때문에 모델이 GitHub 리뷰와 Markdown 출력까지만 수행하고,
mailbox publication을 완료 조건으로 인식하지 않을 가능성이 높다.

## 권장 개선

```text
Primary model tool:
  publish_review_package

Fallback transport tools:
  begin_result
  put_result_file
  finalize_result
```

`publish_review_package`는 새로운 storage protocol이 아니다.
현재 v1.8.0의 검증·hash·immutable manifest·mailbox state machine을 내부에서 재사용하는
고수준 facade다.

함께 적용할 변경:

1. 모든 tool에 explicit MCP annotations와 model visibility 선언
2. `get_request`에 machine-readable completion contract 추가
3. generated Web review prompt에 `result-ready` 완료 조건 추가
4. low-level upload tool description을 fallback 전용으로 변경
5. OAuth write scope와 reauthorization contract 정리
6. `bridge_capabilities` 및 CLI `doctor` 진단 추가
7. tool-catalog CI snapshot과 Developer Mode golden prompt test 추가
8. metadata 변경 후 ChatGPT app Refresh/plugin republish 절차 문서화

## 예상 릴리스

현재 v1.8.0과 storage 호환성을 유지하는 additive patch이므로:

```text
v1.8.1
```

을 권장한다.

## 문서 순서

1. `00_CURRENT_MAIN_AND_DIAGNOSIS.md`
2. `01_CHANGE_SUMMARY.md`
3. `02_TOOL_CATALOG_ASIS_TOBE.md`
4. `03_PUBLISH_REVIEW_PACKAGE_SPEC.md`
5. `04_METADATA_AUTH_PERMISSION_SPEC.md`
6. `05_COMPLETION_CONTRACT_AND_PROMPT_SPEC.md`
7. `06_DIAGNOSTICS_AND_APP_REFRESH.md`
8. `07_TEST_AND_ACCEPTANCE_PLAN.md`
9. `08_ROLLOUT_COMPATIBILITY.md`
10. `09_TRACEABILITY_MATRIX.md`
11. `specs/MCP-001...MCP-007`
12. `prompt/UPSTREAM_IMPLEMENTATION_PROMPT.md`
