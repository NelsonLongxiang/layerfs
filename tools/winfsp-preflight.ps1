#requires -Version 7.0
# Read-only native request-path preflight; pwsh -File tools/winfsp-preflight.ps1 [-Installer <msi>].
# No driver/service start, installation, mount or feature change. Exit 0 candidate, 2 unavailable, 1 error.
param([string]$Installer)
$ErrorActionPreference='Stop'
$result=[ordered]@{checkedAt=(Get-Date -Format o);status='missing-component';elevated=$false;installRoots=@();drivers=@();library=$null;libraryLoaded=$false;exports=[ordered]@{};installer=$null;liveMountVerified=$false;workspaceQualified=$false}
$handle=[IntPtr]::Zero
$code=2
try {
    if (-not $IsWindows) { $result.status='unsupported-host' }
    else {
        $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
        try { $result.elevated=([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }
        finally { $identity.Dispose() }
        # RegistryKey avoids provider/path escaping mistakes and checks both registry views.
        $roots=[Collections.Generic.List[string]]::new()
        foreach($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)) {
            $hive=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,$view)
            try {
                $key=$hive.OpenSubKey('SOFTWARE\WinFsp')
                if($key) { try { $value=$key.GetValue('InstallDir');if($value){$roots.Add([string]$value)} } finally {$key.Dispose()} }
            } finally { $hive.Dispose() }
        }
        foreach($base in @([Environment]::GetEnvironmentVariable('ProgramFiles(x86)'),$env:ProgramFiles)) { if($base){$roots.Add((Join-Path $base 'WinFsp'))} }
        $result.installRoots=@($roots | Select-Object -Unique | ForEach-Object { @{path=$_;exists=(Test-Path -LiteralPath $_)} })
        # Since WinFsp 2.x driver names may contain a side-by-side instance suffix.
        $result.drivers=@(Get-CimInstance Win32_SystemDriver | Where-Object {$_.Name -like 'WinFsp*'} | Select-Object Name,State,StartMode,PathName)
        $architecture=[Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString().ToLowerInvariant()
        $suffix=switch($architecture){'x64'{'x64'} 'x86'{'x86'} 'arm64'{'a64'} default{throw "Unsupported architecture $architecture"}}
        foreach($root in ($roots | Select-Object -Unique)) {
            $candidate=Join-Path $root "bin/winfsp-$suffix.dll"
            if(Test-Path -LiteralPath $candidate -PathType Leaf){$result.library=(Resolve-Path -LiteralPath $candidate).Path;break}
        }
        if($result.library) {
            $sig=Get-AuthenticodeSignature -LiteralPath $result.library
            $result.librarySignature=[string]$sig.Status
            if($sig.Status -ne 'Valid'){throw 'Refusing to load an installed WinFsp DLL without valid Authenticode'}
            $result.libraryLoaded=[Runtime.InteropServices.NativeLibrary]::TryLoad($result.library,[ref]$handle)
            if($result.libraryLoaded) {
                foreach($name in @('FspFileSystemCreate','FspFileSystemDelete','FspFileSystemSetMountPoint','FspFileSystemRemoveMountPoint','FspFileSystemStartDispatcher','FspFileSystemStopDispatcher')) {
                    $address=[IntPtr]::Zero
                    $result.exports[$name]=[Runtime.InteropServices.NativeLibrary]::TryGetExport($handle,$name,[ref]$address)
                }
                if(-not ($result.exports.Values -contains $false) -and $result.drivers.Count -gt 0){$result.status='api-load-candidate';$code=0}
                else {$result.status='missing-driver-or-exports'}
            } else {$result.status='library-load-failed'}
        }
        if($Installer) {
            $path=(Resolve-Path -LiteralPath $Installer).Path
            $sha=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
            $sig=Get-AuthenticodeSignature -LiteralPath $path
            $expected='293ffb9bcc0b625c85079fe85fa77f8fe98170aba51a02ac9c83d58f6c3b0e2f'
            $result.installer=@{path=$path;sha256=$sha;expectedSha256=$expected;hashMatches=($sha -eq $expected);signature=[string]$sig.Status;signer=$sig.SignerCertificate.Subject;version='2.2.26286';prerelease=$true;source='https://github.com/winfsp/winfsp/releases/tag/v2.2B5';verified=($sha -eq $expected -and $sig.Status -eq 'Valid')}
            if(-not $result.installer.verified){throw 'Installer verification failed; do not install'}
        }
        $result.note='Availability only; not a mounted native request or Overlay/Commit proof. Driver installation requires owner authorization and elevation; never initiated by this probe.'
    }
} catch { $result.status='probe-error';$result.error=$_.Exception.Message;$code=1 }
finally { if($handle -ne [IntPtr]::Zero){[Runtime.InteropServices.NativeLibrary]::Free($handle)} }
$result | ConvertTo-Json -Depth 7
exit $code
