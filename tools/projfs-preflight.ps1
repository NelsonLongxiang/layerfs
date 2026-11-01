#requires -Version 7.0
# Read-only preflight: no enable, mount, host restart or Store access.
# pwsh -NoProfile -File tools/projfs-preflight.ps1
# 0 = native API load candidate, 2 = missing/unavailable, 1 = probe error.
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) {
    @{ status = 'unsupported-host'; platform = [Environment]::OSVersion.Platform.ToString(); liveMountVerified = $false } | ConvertTo-Json
    exit 2
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
try {
    $elevated = ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
} finally { $identity.Dispose() }
$library = Join-Path $env:windir 'System32/ProjectedFSLib.dll'
$driver = Join-Path $env:windir 'System32/drivers/prjflt.sys'
$exports = @('PrjMarkDirectoryAsPlaceholder', 'PrjStartVirtualizing', 'PrjStopVirtualizing', 'PrjWritePlaceholderInfo', 'PrjWriteFileData', 'PrjFillDirEntryBuffer', 'PrjGetOnDiskFileState')
$result = [ordered]@{
    checkedAt = Get-Date -Format o
    platform = [Environment]::OSVersion.VersionString
    elevated = $elevated
    library = $library
    libraryPresent = Test-Path -LiteralPath $library -PathType Leaf
    driverPresent = Test-Path -LiteralPath $driver -PathType Leaf
    libraryLoaded = $false
    exports = [ordered]@{}
    liveMountVerified = $false
    status = 'missing-component'
    enableCommand = 'DISM /Online /Enable-Feature /FeatureName:Client-ProjFS /All /NoRestart'
    note = 'Run enableCommand in an elevated PowerShell only when authorized; a loadable DLL does not prove mount/capture/Commit semantics.'
}
$handle = [IntPtr]::Zero
$code = 2
try {
    if ($result.libraryPresent) {
        $result.libraryLoaded = [Runtime.InteropServices.NativeLibrary]::TryLoad($library, [ref]$handle)
        if ($result.libraryLoaded) {
            foreach ($name in $exports) {
                $address = [IntPtr]::Zero
                $result.exports[$name] = [Runtime.InteropServices.NativeLibrary]::TryGetExport($handle, $name, [ref]$address)
            }
            if (-not ($result.exports.Values -contains $false)) {
                $result.status = 'api-load-candidate'
                $code = 0
            } else { $result.status = 'missing-exports' }
        } else { $result.status = 'library-load-failed' }
    }
} catch {
    $result.status = 'probe-error'
    $result.error = $_.Exception.Message
    $code = 1
} finally {
    if ($handle -ne [IntPtr]::Zero) { [Runtime.InteropServices.NativeLibrary]::Free($handle) }
}
$result | ConvertTo-Json -Depth 5
exit $code
