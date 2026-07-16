# Vibe Pro Bridge golden prompt replay

이 디렉터리의 `dataset.json`은 런타임 권한이 아니라 커밋된 회귀 fixture다. 자동 테스트는 strict schema, 도구 카탈로그 참조, model visibility, 범주별 publish/fallback/cancel 불변식, 완료 계약 문구를 검증한다. 실제 모델의 도구 선택 품질은 아래 수동 replay로만 측정한다.

## ChatGPT Developer Mode 수동 replay

1. `docs/context/pro-bridge-setup.md`의 ChatGPT 메타데이터 Refresh 절차를 완료하고 새 대화에 GitHub와 Vibe Pro Bridge 앱을 attach한다.
2. direct, indirect, negative 범주를 각각 최소 10회 replay한다. fallback과 cancel도 각 fixture를 최소 한 번 실행한다.
3. 매 실행에서 선택된 도구 순서, 최종 Bridge status, write call 수, 부분 결과 노출 여부를 기록한다.
4. 목표는 direct recall 100%, negative false publication 0%, completion 100%, median write calls 1, partial visibility 0이다.
5. facade가 `chunked-upload-required`를 반환한 경우만 `put_result_file`과 `finalize_result` fallback을 허용한다. `status=result-ready` receipt 전에는 완료로 판정하지 않는다.

## MCP Inspector 증거

각 release 후보에서 다음 다섯 가지를 보존한다.

1. `tools/list`에 `publish_review_package`와 `bridge_capabilities`가 model-visible로 노출된 화면.
2. publish descriptor의 write annotations, input/output schema, `bridge.result.write` scope가 보이는 화면.
3. canonical direct prompt가 `get_request → publish_review_package`를 선택한 호출 transcript.
4. negative prompt가 publication 도구를 호출하지 않은 transcript.
5. 최종 `status=result-ready` receipt와 requestId/resultId/proposedFolder/resultManifestSha256가 보이는 응답.

## Selection record

record는 `GoldenSelectionRecordSchema`에 맞춰 별도 작업 artifact로 저장하고 이 fixture 디렉터리에는 커밋하지 않는다. 필드는 schemaVersion, caseId, replayedAt(ISO 8601), surface, selectedTools, finalStatus, pass, 선택적 notes다.

```json
{
  "schemaVersion": "vibe-pro-bridge-golden-selection-v1",
  "caseId": "direct-01",
  "replayedAt": "2026-07-16T12:00:00.000Z",
  "surface": "chatgpt-developer-mode",
  "selectedTools": ["get_request", "publish_review_package"],
  "finalStatus": "result-ready",
  "pass": true,
  "notes": "Single facade write call; no partial package was shown."
}
```

앱 metadata가 오래된 경우 `docs/context/pro-bridge-setup.md`의 **ChatGPT 메타데이터 Refresh** 절을 먼저 따른다.
