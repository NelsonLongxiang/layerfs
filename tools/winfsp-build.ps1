#requires -Version 7.0
# Build native callback diagnostic; pwsh -File tools/winfsp-build.ps1 -VcTools <version-dir> -WindowsSdk <kit-root> -SdkVersion <version> -Out <new-dir>.
param([Parameter(Mandatory)][string]$VcTools,[Parameter(Mandatory)][string]$WindowsSdk,[Parameter(Mandatory)][string]$SdkVersion,[Parameter(Mandatory)][string]$Out,[switch]$MountOwnerTests,[switch]$CallbackTests,[string]$WinFspRoot=(Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) 'WinFsp'))
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $Out){throw 'Use a new build output directory'}
$cl=Join-Path $VcTools 'bin/Hostx64/x64/cl.exe'
$source=Join-Path $PSScriptRoot 'winfsp-probe.cpp'
$native=Join-Path $PSScriptRoot '../engine/crates/layerfs-fuse/src/windows'
$owner=Join-Path $native 'mount.cpp'
$adapter=Join-Path $native 'callbacks.cpp'
$metadata=Join-Path $native 'metadata.cpp'
$header=Join-Path $native 'mount.hpp'
$nativeSources=@($owner,$adapter,$metadata,$header,(Join-Path $native 'callbacks.hpp'),(Join-Path $native 'callback_state.hpp'),(Join-Path $native 'workspace_port.hpp'))
$binaryName='winfsp-probe.exe'
if($MountOwnerTests -and $CallbackTests){throw 'Select one native test binary'}
if($MountOwnerTests){$source=Join-Path $native '../../tests/windows_mount.cpp';$binaryName='windows-mount-tests.exe'}
if($CallbackTests){$source=Join-Path $native '../../tests/windows_callbacks.cpp';$binaryName='windows-callback-tests.exe'}
foreach($path in @($cl,$source,$owner,$adapter,$metadata,$header,(Join-Path $WinFspRoot 'inc/winfsp/winfsp.h'))){if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw "Missing input $path"}}
$dest=(New-Item -ItemType Directory -Path $Out).FullName
$args=@('/nologo','/std:c++17','/EHsc','/utf-8','/W4','/WX','/MT','/DUNICODE','/D_UNICODE',('/I'+(Join-Path $VcTools 'include')),('/I'+$native),('/external:I'+(Join-Path $WinFspRoot 'inc')),'/external:W0')
foreach($part in @('ucrt','shared','um','winrt')){$args+=('/I'+(Join-Path $WindowsSdk "Include/$SdkVersion/$part"))}
$args+=@($source,$owner,$adapter,$metadata,('/Fo'+$dest+'/'),('/Fe'+(Join-Path $dest $binaryName)),'/link',('/LIBPATH:'+(Join-Path $VcTools 'lib/x64')),('/LIBPATH:'+(Join-Path $WindowsSdk "Lib/$SdkVersion/ucrt/x64")),('/LIBPATH:'+(Join-Path $WindowsSdk "Lib/$SdkVersion/um/x64")),'Advapi32.lib')
& $cl @args
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$inputs=@($nativeSources|ForEach-Object {@{path=(Resolve-Path -LiteralPath $_).ProviderPath;sha256=(Get-FileHash -LiteralPath $_).Hash}})
@{nativeInputs=$inputs;adapter=$adapter;adapterSha256=(Get-FileHash -LiteralPath $adapter).Hash;metadata=$metadata;metadataSha256=(Get-FileHash -LiteralPath $metadata).Hash;owner=$owner;ownerSha256=(Get-FileHash -LiteralPath $owner).Hash;header=$header;headerSha256=(Get-FileHash -LiteralPath $header).Hash;source=$source;sourceSha256=(Get-FileHash -LiteralPath $source).Hash;binary=(Join-Path $dest $binaryName);binarySha256=(Get-FileHash -LiteralPath (Join-Path $dest $binaryName)).Hash;compiler=$cl;sdk=$SdkVersion;builtAt=(Get-Date -Format o)}|ConvertTo-Json -Depth 5
