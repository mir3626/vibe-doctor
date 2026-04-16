try {
  $root = (Get-Location).Path

  function Read-JsonOptional([string]$Path) {
    try {
      if (Test-Path $Path) {
        return Get-Content $Path -Raw | ConvertFrom-Json
      }
    } catch {
      return $null
    }

    return $null
  }

  function Get-NonEmptyString($Value) {
    if ($Value -is [string] -and $Value.Trim().Length -gt 0) {
      return $Value.Trim()
    }

    return $null
  }

  function Normalize-Version([string]$Version) {
    return $Version.Trim() -replace "^[vV]", ""
  }

  function Get-VersionParts([string]$Version) {
    $normalized = Normalize-Version $Version
    if ($normalized -notmatch "^\d+(\.\d+)*$") {
      return $null
    }

    return @($normalized.Split(".") | ForEach-Object { [int]$_ })
  }

  function Compare-VersionParts($Left, $Right) {
    $length = [math]::Max($Left.Count, $Right.Count)
    for ($index = 0; $index -lt $length; $index += 1) {
      $leftPart = if ($index -lt $Left.Count) { [int]$Left[$index] } else { 0 }
      $rightPart = if ($index -lt $Right.Count) { [int]$Right[$index] } else { 0 }
      if ($leftPart -ne $rightPart) {
        if ($leftPart -gt $rightPart) {
          return 1
        }

        return -1
      }
    }

    return 0
  }

  function Get-HarnessVersionSuffix([string]$Root) {
    $config = Read-JsonOptional (Join-Path $Root ".vibe/config.json")
    $installedRaw = Get-NonEmptyString $config.harnessVersionInstalled
    if ($null -eq $installedRaw) {
      $installedRaw = Get-NonEmptyString $config.harnessVersion
    }

    $installedParts = if ($null -ne $installedRaw) { Get-VersionParts $installedRaw } else { $null }
    if ($null -eq $installedRaw -or $null -eq $installedParts) {
      return $null
    }

    $installedVersion = Normalize-Version $installedRaw
    $syncCache = Read-JsonOptional (Join-Path $Root ".vibe/sync-cache.json")
    $latestRaw = Get-NonEmptyString $syncCache.latestVersion
    $latestParts = if ($null -ne $latestRaw) { Get-VersionParts $latestRaw } else { $null }
    if ($null -ne $latestRaw -and $null -ne $latestParts -and (Compare-VersionParts $installedParts $latestParts) -lt 0) {
      return "v$installedVersion $([char]0x26A0) v$(Normalize-Version $latestRaw) (/vibe-sync)"
    }

    return "v$installedVersion"
  }

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
  $versionSuffix = Get-HarnessVersionSuffix $root
  if ($null -ne $versionSuffix) {
    $parts.Add($versionSuffix)
  }
  [Console]::Out.Write(($parts -join " | "))
} catch {
  exit 0
}

exit 0
