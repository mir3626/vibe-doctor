# Traceability Matrix

| Observed issue | Root cause | Change | Spec |
|---|---|---|---|
| User perceives no write tool | Domain tools are not labeled as one obvious publish action | Add primary `publish_review_package` | MCP-001 |
| Model prints Markdown but does not upload | No protocol-level final completion condition | Add completion contract | MCP-003 |
| Normal review needs many calls | Transport tools exposed as main workflow | High-level facade, low-level fallback | MCP-001, MCP-002 |
| Tool selection ambiguous | Descriptions explain implementation, not selection | Rewrite metadata with `Use this when` | MCP-004 |
| Write/read classification unclear | UI list omits raw annotations | Explicit annotations and catalog audit | MCP-004 |
| Model may not see write tool | Visibility may be implicit/stale | Explicit model visibility + Refresh | MCP-004, MCP-006 |
| Read works but write auth fails | Token may lack write scope | Per-tool scopes and auth challenge | MCP-005 |
| User cannot determine server capability | No capability handshake | Add `bridge_capabilities` | MCP-006 |
| Main/skill catalog may drift | No version handshake | Catalog version and doctor | MCP-006 |
| Update can regress discovery | No golden prompt matrix | Developer Mode regression suite | MCP-007 |
| Large packages cannot use facade | Tool argument limits | Explicit chunk fallback | MCP-002 |
