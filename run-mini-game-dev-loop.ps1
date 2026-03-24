param(
    [int]$MaxCycles = 8,
    [string]$AgentName = "Mini Game Dev",
    [switch]$RequireApprovalEachCycle = $true,
    [string]$ValidateCommand = "",
    [string]$InitialPrompt = "Do an initial review pass by looking up both classic baseball pinball games and well reviewed digital baseball minigames. Make 2 improvements.",
    [int]$MaxWaitRetriesPerCycle = 6
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$FixedPrompt = "Run another review pass using looking up both classic baseball pinball games and well reviewed digital baseball minigames. Make the next 2 improvements"

function Run-OneCycle {
    param(
        [int]$CycleNumber,
        [int]$TotalCycles,
        [string]$PromptToSend
    )

    Write-Host "=== Cycle $CycleNumber/$TotalCycles ===" -ForegroundColor Yellow

    $before = Get-WorkspaceFingerprint
    Set-Clipboard -Value $PromptToSend

    Write-Host "Prompt copied to clipboard." -ForegroundColor Cyan
    Write-Host "Send this to '$AgentName':"
    Write-Host "$PromptToSend" -ForegroundColor Gray
    Write-Host ""
    Write-Host "After '$AgentName' finishes and applies changes, press Enter."
    [void](Read-Host)

    $after = Get-WorkspaceFingerprint
    $waitTry = 0
    while ($before -eq $after) {
        $waitTry++
        Write-Host "No new changes detected yet." -ForegroundColor Yellow
        if ($waitTry -ge $MaxWaitRetriesPerCycle) {
            Write-Host "Reached max wait retries for this cycle. Stopping loop." -ForegroundColor Yellow
            return $false
        }

        $retryChoice = Read-Host "If '$AgentName' is still running, press Enter to wait/recheck. Type 's' to stop"
        if ($retryChoice -in @("s", "S", "stop", "STOP")) {
            Write-Host "Stopped by user." -ForegroundColor Yellow
            return $false
        }

        $after = Get-WorkspaceFingerprint
    }

    $diffSummary = Get-DiffSummary
    $changedFiles = Get-ChangedFiles

    Write-Host "Changes detected: $diffSummary" -ForegroundColor Green
    if ($changedFiles.Count -gt 0) {
        Write-Host "Files changed:"
        $changedFiles | ForEach-Object { Write-Host " - $_" }
    }

    if (-not (Run-Validation -Command $ValidateCommand)) {
        Write-Host "Validation failed. Stopping loop for review." -ForegroundColor Red
        return $false
    }

    return $true
}

function Get-StatusSnapshot {
    return (git status --porcelain | Out-String).Trim()
}

function Get-WorkspaceFingerprint {
    # Content-based fingerprint so edits inside already-modified files are detected.
    $unstaged = (git diff --no-color | Out-String)
    $staged = (git diff --cached --no-color | Out-String)
    $untrackedFiles = @(git ls-files --others --exclude-standard)
    $untrackedFingerprintLines = @()

    foreach ($file in $untrackedFiles) {
        if (Test-Path -LiteralPath $file -PathType Leaf) {
            $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
            $untrackedFingerprintLines += "$file::$hash"
        } else {
            $untrackedFingerprintLines += "$file::<missing>"
        }
    }

    $payload = @(
        "UNSTAGED_START"
        $unstaged
        "UNSTAGED_END"
        "STAGED_START"
        $staged
        "STAGED_END"
        "UNTRACKED_START"
        ($untrackedFingerprintLines -join "`n")
        "UNTRACKED_END"
    ) -join "`n"

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hashBytes = $sha.ComputeHash($bytes)
    } finally {
        $sha.Dispose()
    }
    return [BitConverter]::ToString($hashBytes).Replace("-", "").ToLowerInvariant()
}

function Get-DiffSummary {
    $line = (git diff --shortstat | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($line)) {
        return "No diff."
    }
    return $line
}

function Get-ChangedFiles {
    $files = git diff --name-only
    if (-not $files) {
        return @()
    }
    return @($files)
}

function Run-Validation {
    param([string]$Command)

    if ([string]::IsNullOrWhiteSpace($Command)) {
        return $true
    }

    Write-Host "Running validation: $Command" -ForegroundColor Cyan
    & powershell -NoProfile -Command $Command
    return ($LASTEXITCODE -eq 0)
}

Write-Host ""
Write-Host "Mini Game Dev loop controller" -ForegroundColor Green
Write-Host "Agent: $AgentName"
Write-Host "Max cycles: $MaxCycles"
Write-Host "Initial kickoff prompt enabled."
Write-Host ""

if (-not (Run-OneCycle -CycleNumber 1 -TotalCycles $MaxCycles -PromptToSend $InitialPrompt)) {
    Write-Host ""
    Write-Host "Loop finished." -ForegroundColor Green
    return
}

for ($cycle = 2; $cycle -le $MaxCycles; $cycle++) {
    if ($RequireApprovalEachCycle) {
        $choice = Read-Host "Continue to next cycle? (y/N)"
        if ($choice -notin @("y", "Y", "yes", "YES")) {
            Write-Host "Stopped by user." -ForegroundColor Yellow
            break
        }
    }

    if (-not (Run-OneCycle -CycleNumber $cycle -TotalCycles $MaxCycles -PromptToSend $FixedPrompt)) {
        break
    }

    if ($cycle -eq $MaxCycles) {
        Write-Host "Reached max cycles." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Loop finished." -ForegroundColor Green
