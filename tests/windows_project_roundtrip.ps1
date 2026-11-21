# Runs on an isolated Windows test runner after installing the real NSIS package.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$element = [System.Windows.Automation.AutomationElement]
$tree = [System.Windows.Automation.TreeScope]
$root = $element::RootElement
$binary = [IO.Path]::GetFullPath((Join-Path $env:RUNNER_TEMP 'viewer-install/phasesmith-viewer.exe'))
$dir = Join-Path $env:RUNNER_TEMP 'Viewer document check'
New-Item -ItemType Directory $dir | Out-Null
$cif = Join-Path $dir 'Distance check.cif'
$project = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Distance check.psv'
if (Test-Path $project) { throw "Project already exists: $project" }
Copy-Item (Join-Path $PSScriptRoot 'known-distance.cif') $cif

function Find-By($parent, $scope, $property, $value) {
    $condition = New-Object System.Windows.Automation.PropertyCondition($property, $value)
    $parent.FindFirst($scope, $condition)
}

function Wait-For($description, [scriptblock]$probe) {
    $deadline = (Get-Date).AddSeconds(45)
    do {
        $result = & $probe
        if ($result) { return $result }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    throw "Timed out waiting for $description"
}

function Wait-Control($id) {
    Wait-For $id { Find-By $window $tree::Descendants $element::AutomationIdProperty $id }
}

function Invoke-Control($control) {
    Write-Host "Activating $($control.Current.Name)"
    $pattern = $null
    if ($control.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        $pattern.Invoke()
    } else {
        $control.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand()
    }
}

function Open-Document($path, $profile) {
    $ext = [IO.Path]::GetExtension($path)
    $classes = [Microsoft.Win32.Registry]::ClassesRoot
    $class = $classes.OpenSubKey($ext).GetValue('')
    $command = $classes.OpenSubKey("$class\shell\open\command").GetValue('')
    if ($command -ne ('"{0}" "%1"' -f $binary)) { throw "Unexpected registered handler for ${ext}: $command" }
    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $dir $profile
    Start-Process -FilePath $path -Verb Open
    $script:viewer = Wait-For 'installed viewer process' {
        Get-Process -Name phasesmith-viewer -ErrorAction SilentlyContinue | Where-Object Path -eq $binary
    }
    $script:window = Wait-For 'viewer window' {
        Find-By $root $tree::Children $element::ClassNameProperty 'Tauri Window'
    }
    if ($window.Current.ProcessId -ne $viewer.Id) { throw 'Unexpected window owner' }
    Write-Host "Opened $path through the installed file association."
}

function Close-Viewer {
    $window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close()
    if (!$viewer.WaitForExit(30000)) { throw 'The viewer did not exit normally' }
}

function Wait-ForFixture {
    Wait-For 'imported crystal' {
        $info = Find-By $window $tree::Descendants $element::AutomationIdProperty 'structure-info-open'
        $info -and $info.Current.Name -match 'periodic_distance'
    } | Out-Null
}

try {
    Open-Document $cif 'CIF profile'
    Wait-ForFixture
    $atoms = (Wait-Control 'show-atoms').GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    if ($atoms.Current.ToggleState -ne 'On') { throw 'Expected atoms to start visible' }
    $atoms.Toggle()
    Invoke-Control (Wait-Control 'file-menu-button')
    Invoke-Control (Wait-Control 'project-save')
    $dialog = Wait-For 'native Windows Save dialog' {
        Find-By $window $tree::Descendants $element::NameProperty 'Save As'
    }
    # Accept the viewer's suggested filename in the runner's Documents folder.
    # This split Save button does not expose UIA Invoke on all Windows builds.
    Add-Type -Namespace ViewerTest -Name Dialog -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern IntPtr GetDlgItem(IntPtr dialog, int id);
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
'@
    $handle = [IntPtr]$dialog.Current.NativeWindowHandle
    $save = [ViewerTest.Dialog]::GetDlgItem($handle, 1)
    if ($save -eq [IntPtr]::Zero -or ![ViewerTest.Dialog]::PostMessage($save, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)) {
        throw 'Could not click the Save button in the Windows file dialog'
    }
    Wait-For 'saved project on disk' { Test-Path $project } | Out-Null
    $saved = [IO.File]::ReadAllText($project) | ConvertFrom-Json
    if ($saved.format -ne 'phasesmith-viewer-project' -or $saved.document.filename -ne 'Distance check.cif' -or
        $saved.document.text -cne [IO.File]::ReadAllText($cif) -or $saved.state.block -ne 'periodic_distance' -or
        $saved.state.atoms.show -ne $false) { throw 'Saved project did not preserve the CIF and display setting' }
    Write-Host 'Native Save dialog wrote the project; original CIF text and the edited setting match.'
    Close-Viewer
    Remove-Item -LiteralPath $cif
    Open-Document $project 'PSV profile'
    Wait-ForFixture
    $atoms = (Wait-Control 'show-atoms').GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    if ($atoms.Current.ToggleState -ne 'Off') { throw 'Reopened project did not restore atom visibility' }
    Invoke-Control (Wait-Control 'file-menu-button')
    Wait-For 'opened project confirmation' {
        Find-By $window $tree::Descendants $element::NameProperty 'Opened Distance check.psv.'
    } | Out-Null
    Close-Viewer
    Write-Host 'Reopened the PSV through its association and verified the crystal and saved display setting.'
} catch {
    if ($window) {
        $window.FindAll($tree::Descendants, [System.Windows.Automation.Condition]::TrueCondition) |
            Select-Object -First 110 | ForEach-Object { Write-Host "Control: $($_.Current.AutomationId) $($_.Current.Name)" }
    }
    throw
}
