param(
    [Parameter(Mandatory)][ValidateSet('Open', 'Save', 'Close')][string]$Action,
    [string]$Document
)
$ErrorActionPreference = 'Stop'
$binary = [IO.Path]::GetFullPath((Join-Path $env:RUNNER_TEMP 'viewer-install/phasesmith-viewer.exe'))

if ($Action -eq 'Open') {
    # Use the installed shell association, as Explorer does on a double-click.
    Start-Process -FilePath $Document
    return
}

$viewer = @(Get-Process -Name phasesmith-viewer | Where-Object Path -eq $binary)
if ($viewer.Count -ne 1) { throw "Expected one installed viewer, found $($viewer.Count)" }
if ($Action -eq 'Close') {
    if (!$viewer[0].CloseMainWindow() -or !$viewer[0].WaitForExit(30000)) {
        throw 'The viewer did not close normally'
    }
    return
}

# Operate the actual Windows Save dialog without depending on keyboard focus.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$element = [System.Windows.Automation.AutomationElement]
$children = [System.Windows.Automation.TreeScope]::Children
$descendants = [System.Windows.Automation.TreeScope]::Descendants
function ById([string]$id) {
    New-Object System.Windows.Automation.PropertyCondition($element::AutomationIdProperty, $id)
}
$owned = New-Object System.Windows.Automation.PropertyCondition($element::ProcessIdProperty, $viewer[0].Id)
$deadline = (Get-Date).AddSeconds(45)
do {
    foreach ($window in $element::RootElement.FindAll($children, $owned)) {
        if ($window.Current.ClassName -ne '#32770') { continue }
        $filename = $window.FindFirst($descendants, (ById '1001'))
        $save = $window.FindFirst($descendants, (ById '1'))
        if (!$filename -or !$save) { continue }
        $filename.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($Document)
        $save.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        Write-Host 'Confirmed the filename in the native Windows Save dialog.'
        return
    }
    Start-Sleep -Milliseconds 200
} while ((Get-Date) -lt $deadline)
throw 'Could not find the native Save dialog and its filename and Save controls'
