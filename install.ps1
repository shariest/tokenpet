#requires -Version 5.1
[CmdletBinding()]
param([switch]$Local, [string]$Endpoint)

function Install-TokenPet {
    param([switch]$Local, [string]$Endpoint)
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    if ($env:OS -ne 'Windows_NT') { throw 'Use install.sh on macOS, Linux, or WSL.' }
    if ($Local -and $Endpoint) { throw 'Choose -Local or -Endpoint, not both.' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $OutputEncoding = [Console]::OutputEncoding

    $installDir = if ($env:TOKENPET_INSTALL_DIR) { $env:TOKENPET_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'TokenPet' }
    $binDir = if ($env:TOKENPET_BIN_DIR) { $env:TOKENPET_BIN_DIR } else { Join-Path $installDir 'bin' }
    $installDir = [IO.Path]::GetFullPath($installDir)
    $binDir = [IO.Path]::GetFullPath($binDir)
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ('tokenpet-' + [guid]::NewGuid().ToString('N'))
    $release = Join-Path $installDir ('releases\' + [guid]::NewGuid().ToString('N'))
    $activated = $false
    $originalKey = $env:TOKENPET_API_KEY
    New-Item -ItemType Directory -Force -Path $temporary, $binDir, (Join-Path $installDir 'releases') | Out-Null
    try {
        $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        $node = if ($nodeCommand) { $nodeCommand.Source } else { $null }
        $major = 0
        if ($node) {
            $version = & $node -p 'process.versions.node'
            if ($LASTEXITCODE -eq 0) { $major = [int]($version.Split('.')[0]) }
        }
        if ($major -lt 24) {
            $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
            $arch = switch ($architecture.ToUpperInvariant()) { 'AMD64' { 'x64' } 'ARM64' { 'arm64' } default { throw '64-bit Windows (x64 or arm64) is required.' } }
            Write-Host 'Installing a private Node.js 24 runtime (no administrator rights required).'
            $checksums = (Invoke-WebRequest -UseBasicParsing 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt').Content
            $nodeMatches = [regex]::Matches($checksums, "(?m)^([0-9a-f]{64})\s+(node-v24\.\d+\.\d+-win-$arch\.zip)\r?$")
            if ($nodeMatches.Count -ne 1) { throw 'Could not identify the official Node.js download.' }
            $filename = $nodeMatches[0].Groups[2].Value
            $version = $filename.Split('-')[1]
            $archive = Join-Path $temporary 'node.zip'
            Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$version/$filename" -OutFile $archive
            if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $nodeMatches[0].Groups[1].Value) {
                throw 'Node.js checksum verification failed. The existing installation was preserved.'
            }
            Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $temporary 'runtime')
            $runtimeName = [IO.Path]::GetFileNameWithoutExtension($filename)
            $runtime = Join-Path $installDir $runtimeName
            if (-not (Test-Path -LiteralPath $runtime)) { Move-Item -LiteralPath (Join-Path $temporary "runtime\$runtimeName") -Destination $runtime }
            $node = Join-Path $runtime 'node.exe'
        }
        $nodeDir = Split-Path -Parent $node
        $npm = Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js'
        if (-not (Test-Path -LiteralPath $npm)) { throw 'npm is missing from this Node.js installation. Reinstall Node.js 24 or newer.' }
        $env:Path = "$nodeDir;$env:Path"
        $ref = if ($env:TOKENPET_REF) { $env:TOKENPET_REF } else { 'v1.0.1' }
        if ($ref -notmatch '^[A-Za-z0-9._/-]+$') { throw 'Invalid TOKENPET_REF.' }
        Write-Host 'Downloading TokenPet. Git and repository cloning are not required.'
        $archive = Join-Path $temporary 'tokenpet.zip'
        Invoke-WebRequest -UseBasicParsing "https://codeload.github.com/shariest/tokenpet/zip/$ref" -OutFile $archive
        Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $temporary 'source')
        $source = @(Get-ChildItem -LiteralPath (Join-Path $temporary 'source') -Directory)
        if ($source.Count -ne 1) { throw 'Unexpected TokenPet archive layout.' }
        Push-Location -LiteralPath $source[0].FullName
        try {
            & $node $npm ci --include=dev --ignore-scripts --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. The existing installation was preserved.' }
            & $node $npm run build --if-present
            if ($LASTEXITCODE -ne 0) { throw 'TypeScript build failed. The existing installation was preserved.' }
            & $node $npm prune --omit=dev --ignore-scripts --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'Production dependency setup failed. The existing installation was preserved.' }
        } finally { Pop-Location }

        $command = Join-Path $binDir 'tokenpet.cmd'
        if ((Test-Path -LiteralPath $command) -and -not ([IO.File]::ReadAllText($command).Contains('rem TokenPet launcher'))) {
            throw "Refusing to replace an unrelated command: $command"
        }
        Move-Item -LiteralPath $source[0].FullName -Destination $release
        $entrypoint = Join-Path $release 'bin\tokenpet.mjs'
        $lines = @('@echo off', 'rem TokenPet launcher', 'setlocal DisableDelayedExpansion', 'chcp 65001 >nul')
        foreach ($name in @('TOKENPET_DATA_DIR', 'TOKENPET_PORT', 'NODE_EXTRA_CA_CERTS')) {
            $value = [Environment]::GetEnvironmentVariable($name)
            if ($value) {
                if ($value -match '["\r\n]') { throw "Invalid $name value." }
                $lines += 'set "' + $name + '=' + $value.Replace('%', '%%') + '"'
            }
        }
        $lines += '"' + $node.Replace('%', '%%') + '" "' + $entrypoint.Replace('%', '%%') + '" %*'
        $lines += 'exit /b %errorlevel%'
        $pending = "$command.new"
        try {
            [IO.File]::WriteAllText($pending, ($lines -join "`r`n") + "`r`n", [Text.UTF8Encoding]::new($false))
            if (Test-Path -LiteralPath $command) { [IO.File]::Replace($pending, $command, [NullString]::Value) }
            else { [IO.File]::Move($pending, $command) }
        } finally { if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending -Force } }
        $activated = $true
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if (@($userPath -split ';') -notcontains $binDir) { [Environment]::SetEnvironmentVariable('Path', "$binDir;$userPath", 'User') }
        $env:Path = "$binDir;$env:Path"

        if ($Endpoint -and -not $env:TOKENPET_API_KEY -and -not $env:TOKENPET_API_KEY_FILE) {
            $secureKey = Read-Host 'Server access key (hidden)' -AsSecureString
            $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
            try { $env:TOKENPET_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
            finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secureKey.Dispose() }
        }
        if ($Local) { & $node $entrypoint connect local }
        elseif ($Endpoint) { & $node $entrypoint connect $Endpoint }
        else { & $node $entrypoint setup }
        if ($LASTEXITCODE -ne 0) { throw "Connection setup failed. Retry with: $command connect" }
        Write-Host "`nTokenPet is ready. Start codex or claude as usual. Management command: $command help"
        Write-Host 'Run the same installer to update. Your game data is preserved.'
    } finally {
        $env:TOKENPET_API_KEY = $originalKey
        Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
        if (-not $activated -and (Test-Path -LiteralPath $release)) { Remove-Item -LiteralPath $release -Recurse -Force }
    }
}

Install-TokenPet @PSBoundParameters
