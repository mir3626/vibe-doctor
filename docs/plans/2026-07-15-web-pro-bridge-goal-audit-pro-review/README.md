
Vibe Pro Bridge Goal Audit
Review identity
Request: AUD-20260715-tlo6jc
Repository: mir3626/vibe-doctor
Base: 64ffad48e01eeab1b0c73389cc809c008b11fe32
Reviewed HEAD: 9b002fe3235185a9a27dddec51bfc4248f768549
Branch: main
Authoritative local delta: supplied patch, SHA-256 78f9696e5bc30a86ac3224514c9848acdeb1f0883e2a00cee5d0f8d201dc84d0
Review date: 2026-07-15
Disposition: remediation required before original-goal closure
Findings: P0 0 · P1 5 · P2 4 · P3 2
Executive verdict

The implementation substantially realizes the Hybrid v2 Vibe Pro Bridge architecture:

$vibe-goal-audit and $vibe-pro-design entry points;
layered goal-source discovery and repository-scope reconstruction;
GitHub visibility handling with bounded patch support;
A–I review-prompt composition;
manual vibe-bundle fallback;
local-first MCP mailbox;
chunked result upload and manifest hashing;
result-package validation and atomic installation;
Web-origin design handling;
optional adapters kept behind explicit configuration;
no implicit Git push, GitHub write path, browser DOM automation, or automatic implementation after import.

Those capabilities align with the design’s immutable goals and modular transport/importer model. The design explicitly requires exact repository/ref grounding, structured P0–P3 findings, immutable result packages, and an atomic importer under docs/plans.

The original goal is nevertheless not complete at the requested HEAD plus supplied patch. Five P1 issues remain:

mailbox state mutations are not serialized or fenced;
result finalization has a restart-unsafe commit window;
an install-before-acknowledgement crash leaves the request permanently result-ready;
mailbox sync can fail open on current-repository identity;
the exact goal’s real Web Pro/GitHub/MCP acceptance and release boundary are not established inside the reviewed snapshot.

The public commit 47219847626cde24d2307c2773b5e15fce14b903 is a direct child of the requested HEAD and has a file roster matching the supplied patch roster. It was used only as a corroborating representation of the conceptual local delta; the supplied patch remains the authoritative delta, and its bytes were not independently available for hash recomputation.

A later commit, 6051105, declares the v1.8.0 release and claims successful test and live-round-trip evidence, but it is outside the requested snapshot. Its own maintenance handoff also states that real Pro-mode ChatGPT use of the GitHub connector and MCP write tool still awaited user confirmation. It therefore cannot retroactively satisfy the requested HEAD-plus-patch audit boundary.

Strong implementation evidence

The following design intent is present and should be preserved during remediation:

The bridge remains explicitly invoked rather than lifecycle-coupled.
Manual and mailbox transports converge on one importer.
The importer enforces safe relative paths, bounded text payloads, required file presence, per-file hashes when a result manifest exists, staging-directory containment, provenance creation, fsync where supported, and final rename.
Fully bound mailbox results carry request, result, repository, reviewed-ref, file-roster, and reviewer declarations.
Manual fallback records skipped validations instead of falsely asserting cryptographic provenance.
The implementation does not automatically start the generated implementation prompt after import.
Optional Workspace Agent, Responses API, and cloud-apply adapters default to disabled.
The browser convenience path is not treated as a correctness dependency, and the design forbids implicit push and DOM/model-picker automation.
Why closure is blocked

The checked-in dogfood artifacts do not prove the intended real Web Pro review path:

the mailbox Web-origin provenance identifies surface: chatgpt-web and requestedMode: pro, but records githubConnectorUsed: false and the limitation synthetic live-audit round trip;
the manual review artifact is explicitly marked synthetic and exists only to validate the installation path;
its provenance has no reviewer declaration or result manifest and records eight skipped binding validations, including repository, request hash, result hash, reviewed HEAD, file roster, and per-file SHA validation.
at the corroborating patch state, package.json still reports package version 0.1.0 and harness version 1.7.30, so the required version bump/tag/pristine release boundary is not part of this snapshot.
Recommended disposition

Do not declare the original goal complete and do not publish a release from this reviewed state.

Close P1 findings in this order:

current-repository identity must fail closed;
serialize/fence mailbox mutations;
make finalize recoverable across every crash boundary;
make install/no-op acknowledgement recoverable and idempotent;
run non-synthetic Web Pro acceptance with the actual GitHub connector and Bridge MCP write tools;
rerun the whole-workflow audit until no P1 remains;
only then perform sync-manifest verification, clean-state restoration, versioning, release commit, and tag creation.
Reviewer declaration
{
  "surface": "chatgpt-web",
  "requestedMode": "pro",
  "githubConnectorUsed": false,
  "limitations": [
    "The authenticated ChatGPT GitHub connector was not available; public GitHub repository pages were used.",
    "The supplied patch bytes were not exposed for independent SHA-256 recomputation or byte-for-byte application.",
    "Commit 47219847626cde24d2307c2773b5e15fce14b903 was used only as a public corroborating child commit whose parent and file roster match the supplied patch metadata.",
    "No repository checkout was available, so tests, builds, race tests, crash injection, tunnel behavior, tag state, and worktree cleanliness were not executed locally.",
    "No actual ChatGPT Developer Mode session using both the GitHub connector and Vibe Pro Bridge MCP write tools was observed.",
    "Commit 6051105 and its v1.8.0 release claims are outside the requested HEAD-plus-patch review boundary."
  ]
}
Package contents
REVIEW.md reconstructs the complete workflow and gives repository-grounded findings.
FINDINGS.json contains the machine-readable P0–P3 result.
prompt/CLI_MAIN_SESSION_PROMPT.md is the ordered remediation and release-closure prompt.