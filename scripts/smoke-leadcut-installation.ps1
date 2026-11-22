param(
    [string]$InstallerPath = (Join-Path $PSScriptRoot '../release/LeadCut-1.4.0-waveform.2-windows-x64.exe')
)

$ErrorActionPreference = 'Stop'
$taskWorkspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskTestRoot = [IO.Path]::GetFullPath((Join-Path $taskWorkspace '.tmp/installation-smoke'))
$taskInstallDir = [IO.Path]::GetFullPath((Join-Path $taskTestRoot 'LeadCut'))
if (-not $taskInstallDir.StartsWith($taskTestRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The test installation path is outside the intended test directory.'
}
$taskRegistryPath = 'HKCU:/Software/7f2c259d-50da-5cc6-9f1b-d672aaeee5ec'
if (Test-Path -LiteralPath $taskRegistryPath) { throw 'An existing LeadCut installation must be preserved; test skipped.' }
if (Test-Path -LiteralPath $taskInstallDir) { throw 'The isolated installation directory must be unused.' }
$taskInstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
$taskExe = Join-Path $taskInstallDir 'LeadCut.exe'
$taskUninstaller = Join-Path $taskInstallDir 'Uninstall LeadCut.exe'

try {
    $taskProcess = Start-Process -FilePath $taskInstallerPath -ArgumentList "/S /currentuser --no-desktop-shortcut /D=$taskInstallDir" -WindowStyle Hidden -PassThru
    $taskDeadline = (Get-Date).AddSeconds(90)
    while (-not $taskProcess.HasExited -and (Get-Date) -lt $taskDeadline) {
        Start-Sleep -Milliseconds 500
        $taskProcess.Refresh()
    }
    if (-not $taskProcess.HasExited) { Stop-Process -Id $taskProcess.Id; throw 'Silent installation timed out.' }
    if ($taskProcess.ExitCode -ne 0) { throw ('Silent installation failed: ' + $taskProcess.ExitCode) }
    if (-not (Test-Path -LiteralPath $taskExe)) { throw 'Installed executable is missing.' }
    $taskRegisteredDir = (Get-ItemProperty -LiteralPath $taskRegistryPath).InstallLocation
    if ([IO.Path]::GetFullPath($taskRegisteredDir).TrimEnd('\') -ne $taskInstallDir) { throw 'The installer ignored the requested test directory.' }
    $env:LEADCUT_RELEASE_SMOKE_EXE = $taskExe
    Push-Location -LiteralPath $taskWorkspace
    try {
        node (Join-Path $PSScriptRoot 'smoke-leadcut-export.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'Installed app export verification failed.' }
    } finally { Pop-Location }
    Write-Output 'Installed app launch and subtitle export passed.'
} finally {
    if (Test-Path -LiteralPath $taskUninstaller) {
        # The uninstaller recursively removes its installation, so verify its
        # registered target remains inside this task's explicit test directory.
        $taskRegisteredDir = (Get-ItemProperty -LiteralPath $taskRegistryPath -ErrorAction SilentlyContinue).InstallLocation
        if ($taskRegisteredDir -and [IO.Path]::GetFullPath($taskRegisteredDir).TrimEnd('\') -eq $taskInstallDir) {
            Start-Process -FilePath $taskUninstaller -ArgumentList '/S /currentuser' -WindowStyle Hidden | Out-Null
            $taskCleanupDeadline = (Get-Date).AddSeconds(45)
            while (((Test-Path -LiteralPath $taskExe) -or (Test-Path -LiteralPath $taskRegistryPath)) -and (Get-Date) -lt $taskCleanupDeadline) {
                Start-Sleep -Milliseconds 500
            }
            if ((Test-Path -LiteralPath $taskExe) -or (Test-Path -LiteralPath $taskRegistryPath)) { throw 'Isolated installation cleanup failed.' }
            Write-Output 'Isolated installation removed; existing applications and settings preserved.'
        }
    }
    Remove-Item Env:/LEADCUT_RELEASE_SMOKE_EXE -ErrorAction SilentlyContinue
}
