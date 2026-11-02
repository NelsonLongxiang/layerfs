#requires -Version 7.0
# Build the product Windows native companion and safe Rust Session process.
param([Parameter(Mandatory)][string]$VcTools,[Parameter(Mandatory)][string]$WindowsSdk,[Parameter(Mandatory)][string]$SdkVersion,[Parameter(Mandatory)][string]$Out,[Parameter(Mandatory)][string]$CargoTarget,[string]$WinFspRoot=(Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) 'WinFsp'))
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $Out){throw 'Use a fresh output directory'}
$native=Join-Path $PSScriptRoot '../engine/crates/layerfs-fuse/src/windows'
$cl=Join-Path $VcTools 'bin/Hostx64/x64/cl.exe'
$source=@('host.cpp','close.cpp','stdio_port.cpp','mount.cpp','callbacks.cpp','metadata.cpp')|ForEach-Object {Join-Path $native $_}
$headers=@('close.hpp','stdio_port.hpp','mount.hpp','callbacks.hpp','workspace_port.hpp','callback_state.hpp')|ForEach-Object {Join-Path $native $_}
foreach($p in @($cl)+$source+$headers+@((Join-Path $WinFspRoot 'inc/winfsp/winfsp.h'))){if(-not(Test-Path -LiteralPath $p -PathType Leaf)){throw ('Missing build input '+$p)}}
$dest=(New-Item -ItemType Directory -Path $Out).FullName
$args=@('/nologo','/std:c++17','/EHsc','/utf-8','/W4','/WX','/MT','/DUNICODE','/D_UNICODE',('/I'+(Join-Path $VcTools 'include')),('/I'+$native),('/external:I'+(Join-Path $WinFspRoot 'inc')),'/external:W0')
foreach($part in @('ucrt','shared','um','winrt')){$args+=('/I'+(Join-Path $WindowsSdk "Include/$SdkVersion/$part"))}
$exe=Join-Path $dest 'layerfs-winfsp.exe'
$args+=$source
$args+=@(('/Fo'+$dest+'/'),('/Fe'+$exe),'/link',('/LIBPATH:'+(Join-Path $VcTools 'lib/x64')),('/LIBPATH:'+(Join-Path $WindowsSdk "Lib/$SdkVersion/ucrt/x64")),('/LIBPATH:'+(Join-Path $WindowsSdk "Lib/$SdkVersion/um/x64")),'Advapi32.lib')
& $cl @args
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
cargo +1.85.1 build --manifest-path Cargo.toml -p layerfs-daemon --bin layerfs-native --offline --locked --target-dir $CargoTarget -j 2
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$parent=(Resolve-Path -LiteralPath (Join-Path $CargoTarget 'debug/layerfs-native.exe')).ProviderPath
$inputs=@(($source+$headers)|ForEach-Object {@{path=(Resolve-Path -LiteralPath $_).ProviderPath;sha256=(Get-FileHash -LiteralPath $_).Hash}})
@{builtAt=(Get-Date -Format o);nativeInputs=$inputs;host=$exe;hostSha256=(Get-FileHash -LiteralPath $exe).Hash;parent=$parent;parentSha256=(Get-FileHash -LiteralPath $parent).Hash;compiler=$cl;sdk=$SdkVersion;profile='dev';rust='1.85.1 offline locked'}|ConvertTo-Json -Depth 5
