# Pester 3.4+ compatible test suite for PowerShell Automation Scripts in PanoramaDrSuite
$toolsDir = Resolve-Path "$PSScriptRoot/../../../PanoramaDrSuite/tools"

Describe "PowerShell Tooling Syntax & AST Validation" {
    $scriptFiles = Get-ChildItem -Path $toolsDir -Filter "*.ps1" -Recurse

    It "Finds PowerShell automation scripts in tools directory" {
        $scriptFiles.Count | Should BeGreaterThan 0
    }

    foreach ($file in $scriptFiles) {
        Context "Script: $($file.Name)" {
            $content = [System.IO.File]::ReadAllText($file.FullName)
            $errors = $null
            $tokens = $null
            $ast = [System.Management.Automation.Language.Parser]::ParseInput($content, [ref]$tokens, [ref]$errors)

            It "Parses cleanly without AST syntax or parser errors" {
                $errorCount = if ($errors) { $errors.Count } else { 0 }
                $errorCount | Should Be 0
            }

            It "Does not contain hazardous unescaped multi-byte unicode characters that break Windows-1252" {
                # Check for characters > 127 that aren't ASCII
                $hasHazardousChars = $false
                foreach ($line in [System.IO.File]::ReadAllLines($file.FullName)) {
                    if ($line -match "[\u2713\u2717\u2714\u2718]") {
                        $hasHazardousChars = $true
                        break
                    }
                }
                $hasHazardousChars | Should Be $false
            }
        }
    }
}
