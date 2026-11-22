param(
    [string]$InstallerPath = (Join-Path $PSScriptRoot '../release/LeadCut-1.4.0-waveform.2-windows-x64.exe')
)

$ErrorActionPreference = 'Stop'
if (-not ('LeadCutInstallerWindowProbe' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class LeadCutInstallerWindowProbe {
    private delegate bool EnumProc(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int capacity);
    public static string FindWizard(int processId) {
        string title = null;
        EnumWindows((window, parameter) => {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != processId) return true;
            var text = new StringBuilder(512);
            GetWindowText(window, text, text.Capacity);
            if (text.ToString().Contains("LeadCut")) { title = text.ToString(); return false; }
            return true;
        }, IntPtr.Zero);
        return title;
    }
}
'@
}
$taskInstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
$taskInstallerStartedAt = Get-Date
$taskInstallerProcess = Start-Process -FilePath $taskInstallerPath -WindowStyle Hidden -PassThru
try {
    $taskInstallerDeadline = (Get-Date).AddSeconds(30)
    $taskWindowFound = $false
    while ((Get-Date) -lt $taskInstallerDeadline) {
        $taskInstallerProcess.Refresh()
        if ($taskInstallerProcess.HasExited) {
            throw ('Installer exited before creating a wizard: ' + $taskInstallerProcess.ExitCode)
        }
        $taskWizardTitle = [LeadCutInstallerWindowProbe]::FindWizard($taskInstallerProcess.Id)
        if ($taskWizardTitle) {
            $taskWindowFound = $true
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if (-not $taskWindowFound) { throw 'Installer did not create a wizard within 30 seconds.' }
    Start-Sleep -Seconds 2
    $taskInstallerProcess.Refresh()
    if ($taskInstallerProcess.HasExited) { throw 'Installer crashed after creating its wizard.' }
    if (-not [LeadCutInstallerWindowProbe]::FindWizard($taskInstallerProcess.Id)) { throw 'The installer wizard disappeared.' }
    $taskCrashes = @(Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=$taskInstallerStartedAt; Id=1000} -ErrorAction SilentlyContinue |
        Where-Object { $_.Message.Contains($taskInstallerPath) })
    if ($taskCrashes.Count -gt 0) { throw 'Windows recorded an installer crash.' }
    [PSCustomObject]@{
        Success = $true
        Installer = $taskInstallerPath
        WizardTitle = $taskWizardTitle
    } | ConvertTo-Json -Compress
} finally {
    # Stop only this test's wizard. No installation action was requested here.
    $taskInstallerProcess.Refresh()
    if (-not $taskInstallerProcess.HasExited) { Stop-Process -Id $taskInstallerProcess.Id }
}
