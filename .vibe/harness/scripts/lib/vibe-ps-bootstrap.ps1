# vibe-ps bootstrap: run by vibe-ps.mjs with `-File`, never edited per call. Keep this file ASCII-only:
# Windows PowerShell 5.1 reads a BOM-less script in the ANSI code page, which is the bug this helper avoids.
#
# Everything per call arrives as data in environment variables, so no shell, quoting or code page ever
# touches it:
#   VIBE_PS_FILE / VIBE_PS_CODE  the code: a .ps1 path, or the code itself
#   VIBE_PS_ARGS                 JSON array of positional arguments (strings)
#   VIBE_PS_PARAMS               JSON object of named parameters (string values; true for a switch)
#   VIBE_PS_CHECK=1              parse and check only
#   VIBE_PS_ALLOW_TYPOGRAPHIC=1  skip the typographic quote/dash check
# Exit codes: the script's own `exit N`; 1 when an error stops it; 0 when it ends; 65 when the code does not
# parse or carries typographic quotes/dashes outside comments.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$vibePsUtf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $vibePsUtf8
$OutputEncoding = $vibePsUtf8
# PowerShell 7.2+ colours warnings and errors with escape codes; the output is read by programs, so plain text.
if (Get-Variable -Name PSStyle -ErrorAction SilentlyContinue) { $PSStyle.OutputRendering = 'PlainText' }

$vibePsFile = $env:VIBE_PS_FILE
$vibePsCode = $env:VIBE_PS_CODE
$vibePsArgsJson = $env:VIBE_PS_ARGS
$vibePsParamsJson = $env:VIBE_PS_PARAMS
$vibePsCheck = $env:VIBE_PS_CHECK -eq '1'
$vibePsAllowTypographic = $env:VIBE_PS_ALLOW_TYPOGRAPHIC -eq '1'
foreach ($vibePsName in @('VIBE_PS_FILE', 'VIBE_PS_CODE', 'VIBE_PS_ARGS', 'VIBE_PS_PARAMS', 'VIBE_PS_CHECK', 'VIBE_PS_ALLOW_TYPOGRAPHIC')) {
  Remove-Item -Path "Env:$vibePsName" -ErrorAction SilentlyContinue
}

function Write-VibePsError([string]$Text) {
  [Console]::Error.WriteLine($Text)
}

if ($vibePsFile) {
  $vibePsLabel = $vibePsFile
  # Always UTF-8 (a BOM, when present, is skipped), whatever the PowerShell version or the system code page.
  $vibePsText = [System.IO.File]::ReadAllText($vibePsFile, $vibePsUtf8)
  $vibePsSource = $vibePsFile
} else {
  $vibePsLabel = '<code>'
  $vibePsText = [string]$vibePsCode
  $vibePsSource = $null
}

$vibePsTokens = $null
$vibePsErrors = $null
$vibePsAst = [System.Management.Automation.Language.Parser]::ParseInput($vibePsText, $vibePsSource, [ref]$vibePsTokens, [ref]$vibePsErrors)
if ($vibePsErrors.Count -gt 0) {
  foreach ($vibePsError in $vibePsErrors) {
    Write-VibePsError ('{0}:{1}:{2}: {3}' -f $vibePsLabel, $vibePsError.Extent.StartLineNumber, $vibePsError.Extent.StartColumnNumber, $vibePsError.Message)
  }
  exit 65
}

if (-not $vibePsAllowTypographic) {
  # PowerShell reads the typographic quotes as quotes and the dashes as '-'. Text pasted into code with them
  # ends a string early or turns into an operator, so they must come in as data instead. A comment is
  # harmless; a here-string body keeps quotes; any string keeps dashes.
  $vibePsComments = @()
  $vibePsHereStrings = @()
  $vibePsStrings = @()
  foreach ($vibePsToken in $vibePsTokens) {
    $vibePsSpan = @($vibePsToken.Extent.StartOffset, $vibePsToken.Extent.EndOffset)
    switch ($vibePsToken.Kind.ToString()) {
      'Comment' { $vibePsComments += , $vibePsSpan }
      'HereStringLiteral' { $vibePsHereStrings += , $vibePsSpan; $vibePsStrings += , $vibePsSpan }
      'HereStringExpandable' { $vibePsHereStrings += , $vibePsSpan; $vibePsStrings += , $vibePsSpan }
      'StringLiteral' { $vibePsStrings += , $vibePsSpan }
      'StringExpandable' { $vibePsStrings += , $vibePsSpan }
    }
  }
  function Test-VibePsInside([int]$Offset, [object[]]$Spans) {
    foreach ($span in $Spans) {
      if ($Offset -ge $span[0] -and $Offset -lt $span[1]) { return $true }
    }
    return $false
  }
  $vibePsFound = 0
  foreach ($vibePsMatch in [regex]::Matches($vibePsText, '[\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u2013\u2014\u2015]')) {
    $vibePsOffset = $vibePsMatch.Index
    if (Test-VibePsInside $vibePsOffset $vibePsComments) { continue }
    $vibePsIsDash = $vibePsMatch.Value -match '[\u2013\u2014\u2015]'
    if ($vibePsIsDash -and (Test-VibePsInside $vibePsOffset $vibePsStrings)) { continue }
    if (-not $vibePsIsDash -and (Test-VibePsInside $vibePsOffset $vibePsHereStrings)) { continue }
    $vibePsBefore = $vibePsText.Substring(0, $vibePsOffset)
    $vibePsLine = ([regex]::Matches($vibePsBefore, "`n")).Count + 1
    $vibePsColumn = $vibePsOffset - ($vibePsBefore.LastIndexOf("`n") + 1) + 1
    $vibePsCodePoint = 'U+{0:X4}' -f [int][char]$vibePsMatch.Value
    if ($vibePsIsDash) {
      $vibePsWhy = 'PowerShell reads it as "-" (an operator or parameter dash)'
    } else {
      $vibePsWhy = 'PowerShell reads it as a quote and ends or starts a string'
    }
    Write-VibePsError ('{0}:{1}:{2}: {3} {4} outside a comment: {5}. Pass text as data (arguments, --param, --param-file, --env), not inside the code, or use --allow-typographic.' -f $vibePsLabel, $vibePsLine, $vibePsColumn, $vibePsCodePoint, $vibePsMatch.Value, $vibePsWhy)
    $vibePsFound += 1
  }
  if ($vibePsFound -gt 0) { exit 65 }
}

if ($vibePsCheck) {
  [Console]::Out.WriteLine(('{0}: ok' -f $vibePsLabel))
  exit 0
}

$vibePsPositional = @()
if ($vibePsArgsJson) {
  foreach ($vibePsValue in (ConvertFrom-Json $vibePsArgsJson)) { $vibePsPositional += [string]$vibePsValue }
}
$vibePsNamed = @{}
if ($vibePsParamsJson) {
  foreach ($vibePsProperty in (ConvertFrom-Json $vibePsParamsJson).PSObject.Properties) {
    if ($vibePsProperty.Value -is [bool]) {
      $vibePsNamed[$vibePsProperty.Name] = [bool]$vibePsProperty.Value
    } else {
      $vibePsNamed[$vibePsProperty.Name] = [string]$vibePsProperty.Value
    }
  }
}

$global:LASTEXITCODE = 0
try {
  # The scriptblock keeps the file name, so $PSScriptRoot and $PSCommandPath are the script's own. An `exit N`
  # inside it ends this process with N.
  & ($vibePsAst.GetScriptBlock()) @vibePsPositional @vibePsNamed
} catch {
  $vibePsRecord = $_
  Write-VibePsError ('{0}: {1}' -f $vibePsLabel, $vibePsRecord.Exception.Message)
  # Where it stopped in the script: the error's own position, unless that is this bootstrap's call line (an error
  # from Write-Error), then the script's frames of the stack.
  $vibePsWhere = $vibePsRecord.InvocationInfo
  if ($vibePsWhere -and $vibePsWhere.PositionMessage -and $vibePsWhere.ScriptName -ne $PSCommandPath) {
    Write-VibePsError $vibePsWhere.PositionMessage
  } elseif ($vibePsRecord.ScriptStackTrace) {
    foreach ($vibePsFrame in ($vibePsRecord.ScriptStackTrace -split "`r?`n")) {
      if ($vibePsFrame -and -not $vibePsFrame.Contains($PSCommandPath)) { Write-VibePsError $vibePsFrame }
    }
  }
  exit 1
}
exit 0
