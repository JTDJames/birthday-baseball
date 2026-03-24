param(
    [int]$MaxCycles = 8,
    [int]$CycleTimeoutSeconds = 900,
    [int]$StableSeconds = 20,
    [int]$PollSeconds = 3
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot

$ConfigPath = Join-Path $RepoRoot "mini-game-dev-ui-config.json"

$InitialPrompt = "Do an initial review pass by looking up both classic baseball pinball games and well reviewed digital baseball minigames. Make 2 improvements."
$FollowupPrompt = "Run another review pass using looking up both classic baseball pinball games and well reviewed digital baseball minigames. Make the next 2 improvements"

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Missing config file: $ConfigPath. Create it from mini-game-dev-ui-config.example.json first."
}

$Config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json

if (-not ("System.Windows.Forms" -as [type])) {
    Add-Type -AssemblyName System.Windows.Forms
}
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
}
"@

$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004

function Get-WorkspaceFingerprint {
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

function Click-At {
    param(
        [int]$X,
        [int]$Y
    )
    [Win32]::SetCursorPos($X, $Y) | Out-Null
    Start-Sleep -Milliseconds 120
    [Win32]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    Start-Sleep -Milliseconds 60
    [Win32]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
}

function Send-PromptToMiniGameDev {
    param([string]$Prompt)

    Set-Clipboard -Value $Prompt

    Click-At -X $Config.agentListX -Y $Config.agentListY
    Start-Sleep -Milliseconds 250
    Click-At -X $Config.chatInputX -Y $Config.chatInputY
    Start-Sleep -Milliseconds 200

    [System.Windows.Forms.SendKeys]::SendWait("^v")
    Start-Sleep -Milliseconds 120
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
}

function Wait-ForChange {
    param(
        [string]$BeforeHash,
        [int]$TimeoutSeconds,
        [int]$StableSeconds,
        [int]$PollSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $firstDifferentAt = $null
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds $PollSeconds
        $current = Get-WorkspaceFingerprint
        if ($current -ne $BeforeHash) {
            if ($null -eq $firstDifferentAt) {
                $firstDifferentAt = Get-Date
                Write-Host "Detected repo changes, waiting for stabilization..." -ForegroundColor Green
            } else {
                $elapsedStable = ((Get-Date) - $firstDifferentAt).TotalSeconds
                if ($elapsedStable -ge $StableSeconds) {
                    return $true
                }
            }
        }
    }
    return $false
}

Write-Host ""
Write-Host "Mini Game Dev full automation" -ForegroundColor Cyan
Write-Host "Max cycles: $MaxCycles"
Write-Host "Cycle timeout (s): $CycleTimeoutSeconds"
Write-Host ""
Write-Host "Starting in 5 seconds. Keep Cursor visible and avoid touching mouse/keyboard." -ForegroundColor Yellow
Start-Sleep -Seconds 5

for ($cycle = 1; $cycle -le $MaxCycles; $cycle++) {
    $prompt = if ($cycle -eq 1) { $InitialPrompt } else { $FollowupPrompt }
    Write-Host "=== Cycle $cycle/$MaxCycles ===" -ForegroundColor Yellow
    $before = Get-WorkspaceFingerprint

    Send-PromptToMiniGameDev -Prompt $prompt
    Write-Host "Prompt sent to Mini Game Dev." -ForegroundColor Cyan

    $changed = Wait-ForChange -BeforeHash $before -TimeoutSeconds $CycleTimeoutSeconds -StableSeconds $StableSeconds -PollSeconds $PollSeconds
    if (-not $changed) {
        Write-Host "Timed out waiting for repo changes. Stopping." -ForegroundColor Red
        break
    }

    $shortstat = (git diff --shortstat | Out-String).Trim()
    if (-not [string]::IsNullOrWhiteSpace($shortstat)) {
        Write-Host "Cycle change summary: $shortstat" -ForegroundColor Green
    } else {
        Write-Host "Cycle changed files, but shortstat is empty (likely staged/untracked-only deltas)." -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Automation run complete." -ForegroundColor Cyan
