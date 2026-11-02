#requires -Version 7.0
param([Parameter(Mandatory)][string]$VcTools,[Parameter(Mandatory)][string]$WindowsSdk,[Parameter(Mandatory)][string]$SdkVersion,[Parameter(Mandatory)][string]$Out,[switch]$Probe)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $Out){throw 'Fresh restricted command build output required'}
$source=Join-Path $PSScriptRoot '../engine/crates/layerfs-sandbox/src/windows/restricted.cpp'
$header=Join-Path $PSScriptRoot '../engine/crates/layerfs-sandbox/src/windows/restricted.hpp'
$cl=Join-Path $VcTools 'bin/Hostx64/x64/cl.exe'
$dest=(New-Item -ItemType Directory -Path $Out).FullName
$args=@('/nologo','/std:c++17','/EHsc','/utf-8','/W4','/WX','/MT','/DUNICODE','/D_UNICODE',('/I'+(Join-Path $VcTools 'include')))
foreach($part in @('ucrt','shared','um','winrt')){$args+=('/I'+(Join-Path $WindowsSdk "Include/$SdkVersion/$part"))}
$exe=Join-Path $dest 'layerfs-restricted.exe'
$instance=Join-Path $PSScriptRoot '../engine/crates/layerfs-sandbox/src/windows/instance.cpp'
$instanceHeader=Join-Path $PSScriptRoot '../engine/crates/layerfs-sandbox/src/windows/instance.hpp'
$launch=Join-Path $PSScriptRoot '../engine/crates/layerfs-sandbox/src/windows/launch.cpp'
$inputs=@($source,$header,$instance,$instanceHeader,$launch)
$sources=@($source,$instance,$launch)
if($Probe){$source=Join-Path $PSScriptRoot '../engine/crates/layerfs-sandbox/tests/restricted_probe_windows.cpp'; $exe=Join-Path $dest 'restricted-probe.exe'; $inputs=@($source); $sources=@($source)}
$args+=$sources
$args+=@(('/Fo'+$dest+'/'),('/Fe'+$exe),'/link',('/LIBPATH:'+(Join-Path $VcTools 'lib/x64')),('/LIBPATH:'+(Join-Path $WindowsSdk "Lib/$SdkVersion/ucrt/x64")),('/LIBPATH:'+(Join-Path $WindowsSdk "Lib/$SdkVersion/um/x64")),'Advapi32.lib','User32.lib','Bcrypt.lib')
& $cl @args
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
@{builtAt=(Get-Date -Format o);binary=$exe;sha256=(Get-FileHash -LiteralPath $exe).Hash;inputs=$inputs|ForEach-Object {@{path=(Resolve-Path -LiteralPath $_).ProviderPath;sha256=(Get-FileHash -LiteralPath $_).Hash}};compiler=$cl;sdk=$SdkVersion}|ConvertTo-Json -Depth 5
