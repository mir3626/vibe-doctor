try {
  $root = (Get-Location).Path
  $statusPath = Join-Path $root ".vibe/agent/sprint-status.json"
  if (-not (Test-Path $statusPath)) {
    exit 0
  }

  $status = Get-Content $statusPath -Raw | ConvertFrom-Json
  $sprints = @($status.sprints)
  $pendingRisks = @($status.pendingRisks)
  $sprintsSinceLastAudit = if ($null -ne $status.sprintsSinceLastAudit) {
    [int]$status.sprintsSinceLastAudit
  } else {
    0
  }
  $currentSprintId = if ($status.handoff -and $status.handoff.currentSprintId) {
    [string]$status.handoff.currentSprintId
  } else {
    "idle"
  }
  $passedCount = @($sprints | Where-Object { $_.status -eq "passed" }).Count
  $totalCount = $sprints.Count
  $openRisks = @($pendingRisks | Where-Object { $_.status -eq "open" }).Count
  $parts = [System.Collections.Generic.List[string]]::new()
  $parts.Add("S $currentSprintId ($passedCount/$totalCount)")
  [void]$sprintsSinceLastAudit

  $tokensPath = Join-Path $root ".vibe/agent/tokens.json"
  if (Test-Path $tokensPath) {
    $tokens = Get-Content $tokensPath -Raw | ConvertFrom-Json
    $elapsedSeconds = if ($null -ne $tokens.elapsedSeconds) { [double]$tokens.elapsedSeconds } else { 0 }
    $cumulativeTokens = if ($null -ne $tokens.cumulativeTokens) { [double]$tokens.cumulativeTokens } else { 0 }
    $parts.Add("$([math]::Round($elapsedSeconds / 60))m")
    $parts.Add("$([math]::Floor($cumulativeTokens / 1000))K tok")
  }

  $parts.Add("$openRisks risks")
  [Console]::Out.Write(($parts -join " | "))
} catch {
  exit 0
}

exit 0
