# Pester Integration Test for Live Network & Container Hardening on wsh.panoramadr.com
$scriptPath = Resolve-Path "$PSScriptRoot/../../../PanoramaDrSuite/tools/server-setup/Test-WshNetworkHardening.ps1"
$keyPath = "C:/Users/rodrigo/.ssh/rsa-key-deployment"
$targetHost = "root@wsh.panoramadr.com"

Describe "Live WSH Network Hardening Invariant Integration Suite" {
    # Verify SSH reachability first
    $connectivity = $false
    try {
        $sshTest = & ssh.exe -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=3 -i $keyPath $targetHost "echo PING_OK" 2>$null
        if ($sshTest -match "PING_OK") {
            $connectivity = $true
        }
    } catch {
        $connectivity = $false
    }

    It "Can reach remote host ($targetHost) over SSH" {
        $connectivity | Should Be $true
    }

    if ($connectivity) {
        # Execute the penetration audit script non-interactively
        $report = & $scriptPath -RemoteHost $targetHost -SshKeyPath $keyPath -Quiet

        It "Returns an active hardening report" {
            $report | Should Not BeNullOrEmpty
            $report.total_checks | Should Be 8
        }

        It "Achieves a 100% Security Audit Score" {
            $report.score | Should Be 100
            $report.all_passed | Should Be $true
            $report.failed_count | Should Be 0
            $report.passed_count | Should Be 8
        }

        Context "Individual Invariant Audits" {
            foreach ($inv in $report.invariants) {
                It "Invariant [$($inv.id)] $($inv.title) passes" {
                    $inv.status | Should Be "PASS"
                }
            }
        }
    }
}
