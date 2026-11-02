param(
    [Parameter(Mandatory = $true)]
    [string]$TestPath
)

$ErrorActionPreference = "Stop"
$StartSw = [System.Diagnostics.Stopwatch]::StartNew()

$PesterMod = Get-Module -ListAvailable -Name Pester | Sort-Object Version -Descending | Select-Object -First 1
if (-not $PesterMod) {
    throw "Pester module is not installed."
}

Import-Module Pester -RequiredVersion $PesterMod.Version -Force | Out-Null
$Major = $PesterMod.Version.Major

$Failures = @()
$Total = 0
$Passed = 0
$Failed = 0

if ($Major -ge 5) {
    $Conf = New-PesterConfiguration
    $Conf.Run.Path = $TestPath
    $Conf.Run.PassThru = $true
    $Conf.Output.Verbosity = 'Normal'
    $Res = Invoke-Pester -Configuration $Conf
    $Total  = [int]$Res.TotalCount
    $Passed = [int]$Res.PassedCount
    $Failed = [int]$Res.FailedCount
    foreach ($t in $Res.Failed) {
        $Failures += [PSCustomObject]@{
            name    = $t.ExpandedPath
            message = ($t.ErrorRecord.Exception.Message -join "`n")
            trace   = ($t.ErrorRecord.ScriptStackTrace -join "`n")
        }
    }
} else {
    $Res = Invoke-Pester -Script $TestPath -PassThru
    $Total  = [int]$Res.TotalCount
    $Passed = [int]$Res.PassedCount
    $Failed = [int]$Res.FailedCount
    foreach ($t in ($Res.TestResult | Where-Object { -not $_.Passed })) {
        $Failures += [PSCustomObject]@{
            name    = "$($t.Describe) > $($t.Context) > $($t.Name)"
            message = [string]$t.FailureMessage
            trace   = [string]$t.StackTrace
        }
    }
}

$StartSw.Stop()
$Payload = [PSCustomObject]@{
    suite_path    = $TestPath
    pester_ver    = $PesterMod.Version.ToString()
    total_count   = $Total
    passed_count  = $Passed
    failed_count  = $Failed
    duration_ms   = [int]$StartSw.ElapsedMilliseconds
    success       = ($Failed -eq 0)
    failures      = $Failures
}

Write-Host "<<<PESTER_JSON_START>>>"
Write-Host ($Payload | ConvertTo-Json -Depth 6 -Compress)
Write-Host "<<<PESTER_JSON_END>>>"
exit $(if ($Failed -gt 0) { 1 } else { 0 })
