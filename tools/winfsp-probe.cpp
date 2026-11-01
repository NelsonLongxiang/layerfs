// Native WinFsp -> Rust Workspace/Overlay diagnostic. Build: winfsp-build.ps1.
// winfsp-probe.exe <installed-WinFsp-dll> <new-mount> <new-control>
// <Rust-bridge-dll>
#define NOMINMAX
#include <cstdio>
#include <cstring>
#include <cwchar>
#include <winfsp/winfsp.h>
#include <sddl.h>
struct Api {
  HMODULE dll = nullptr;
  decltype(&FspFileSystemCreate) create = nullptr;
  decltype(&FspFileSystemDelete) destroy = nullptr;
  decltype(&FspFileSystemSetMountPoint) mount = nullptr;
  decltype(&FspFileSystemRemoveMountPoint) unmount = nullptr;
  decltype(&FspFileSystemStartDispatcher) start = nullptr;
  decltype(&FspFileSystemStopDispatcher) stop = nullptr;
  decltype(&FspFileSystemAddDirInfo) add = nullptr;
} api;

struct Stat {
  UINT64 serial, size;
  INT64 mtime;
  UINT32 nanos, mode, directory, reserved;
};
static_assert(sizeof(Stat) == 40, "Rust ABI Stat size");
struct Bridge {
  HMODULE dll = nullptr;
  INT32(__cdecl *start)(PCWSTR, UINT32) = nullptr;
  INT32(__cdecl *stat)(PCWSTR, UINT32, Stat *) = nullptr;
  INT32(__cdecl *open)
  (PCWSTR, UINT32, UINT32, UINT32, UINT64 *, Stat *) = nullptr;
  INT32(__cdecl *info)(UINT64, Stat *) = nullptr;
  INT32(__cdecl *read)(UINT64, UINT64, PVOID, UINT32, UINT32 *) = nullptr;
  INT32(__cdecl *write)
  (UINT64, UINT64, PVOID, UINT32, UINT32, Stat *) = nullptr;
  INT32(__cdecl *resize)(UINT64, UINT64, Stat *) = nullptr;
  INT32(__cdecl *rename)(PCWSTR, UINT32, PCWSTR, UINT32, UINT32) = nullptr;
  INT32(__cdecl *unlink)(PCWSTR, UINT32) = nullptr;
  INT32(__cdecl *close)(UINT64) = nullptr;
  INT32(__cdecl *next)
  (PCWSTR, UINT32, PWSTR, UINT32, UINT32 *, Stat *) = nullptr;
  INT32(__cdecl *capture)() = nullptr;
  INT32(__cdecl *captured)(PCWSTR, UINT32, PVOID, UINT32, UINT32 *) = nullptr;
  INT32(__cdecl *release_capture)() = nullptr;
  INT32(__cdecl *commit)(UINT32 *) = nullptr;
  INT32(__cdecl *committed)
  (UINT32, PCWSTR, UINT32, PVOID, UINT32, UINT32 *) = nullptr;
  INT32(__cdecl *observe)() = nullptr;
  INT32(__cdecl *finish)() = nullptr;
} bridge;
static PSECURITY_DESCRIPTOR security = nullptr;
static volatile LONG creates = 0, opens = 0, reads = 0, writes = 0, renames = 0,
                     cleanups = 0, closes = 0, deletes = 0, callback_error = 0;
static UINT64 root_serial = 0;
static UINT32 length(PCWSTR text) {
  return text ? static_cast<UINT32>(wcslen(text)) : 0;
}
static UINT64 handle(PVOID ctx) {
  return static_cast<FSP_FSCTL_TRANSACT_FULL_CONTEXT *>(ctx)->UserContext2;
}
static void fill(const Stat &stat, FSP_FSCTL_FILE_INFO *info) {
  *info = {};
  info->FileAttributes =
      stat.directory ? FILE_ATTRIBUTE_DIRECTORY : FILE_ATTRIBUTE_ARCHIVE;
  if (!stat.directory && !(stat.mode & 0200))
    info->FileAttributes |= FILE_ATTRIBUTE_READONLY;
  info->IndexNumber = stat.serial;
  info->FileSize = stat.size;
  info->AllocationSize = (stat.size + 4095) & ~UINT64(4095);
  if (stat.mtime >= -11644473600LL) {
    auto time = (static_cast<UINT64>(stat.mtime + 11644473600LL) * 10000000) +
                (stat.nanos / 100);
    info->CreationTime = time;
    info->LastAccessTime = time;
    info->LastWriteTime = time;
    info->ChangeTime = time;
  }
}
static NTSTATUS copy_security(PSECURITY_DESCRIPTOR target, SIZE_T *size) {
  if (!size)
    return STATUS_SUCCESS;
  SIZE_T need = GetSecurityDescriptorLength(security), capacity = *size;
  *size = need;
  if (target) {
    if (capacity < need)
      return STATUS_BUFFER_OVERFLOW;
    memcpy(target, security, need);
  }
  return STATUS_SUCCESS;
}
static NTSTATUS volume(FSP_FILE_SYSTEM *, FSP_FSCTL_VOLUME_INFO *info) {
  *info = {};
  info->TotalSize = 1024ULL * 1024 * 1024;
  info->FreeSize = info->TotalSize;
  constexpr WCHAR label[] = L"LayerFS Overlay probe";
  info->VolumeLabelLength = sizeof(label) - sizeof(WCHAR);
  memcpy(info->VolumeLabel, label, sizeof(label));
  return STATUS_SUCCESS;
}
static NTSTATUS security_name(FSP_FILE_SYSTEM *, PWSTR name, PUINT32 attrs,
                              PSECURITY_DESCRIPTOR sd, SIZE_T *size) {
  Stat stat{};
  auto status = bridge.stat(name, length(name), &stat);
  if (status < 0)
    return status;
  if (attrs) {
    FSP_FSCTL_FILE_INFO info{};
    fill(stat, &info);
    *attrs = info.FileAttributes;
  }
  return copy_security(sd, size);
}
static NTSTATUS get_security(FSP_FILE_SYSTEM *, PVOID, PSECURITY_DESCRIPTOR sd,
                             SIZE_T *size) {
  return copy_security(sd, size);
}
static NTSTATUS open_file(FSP_FILE_SYSTEM *, PWSTR name, UINT32, UINT32 access,
                          PVOID *ctx, FSP_FSCTL_FILE_INFO *info) {
  Stat stat{};
  UINT64 held = 0;
  auto status = bridge.open(
      name, length(name), 0,
      (access & (FILE_WRITE_DATA | FILE_APPEND_DATA)) != 0, &held, &stat);
  if (status < 0)
    return status;
  auto full = reinterpret_cast<FSP_FSCTL_TRANSACT_FULL_CONTEXT *>(ctx);
  full->UserContext = stat.serial;
  full->UserContext2 = held;
  fill(stat, info);
  InterlockedIncrement(&opens);
  return STATUS_SUCCESS;
}
static NTSTATUS create_file(FSP_FILE_SYSTEM *, PWSTR name, UINT32 options,
                            UINT32, UINT32, PSECURITY_DESCRIPTOR,
                            UINT64 allocation, PVOID *ctx,
                            FSP_FSCTL_FILE_INFO *info) {
  if (options & FILE_DIRECTORY_FILE || allocation)
    return STATUS_NOT_SUPPORTED;
  Stat stat{};
  UINT64 held = 0;
  auto status = bridge.open(name, length(name), 1, 1, &held, &stat);
  if (status < 0)
    return status;
  auto full = reinterpret_cast<FSP_FSCTL_TRANSACT_FULL_CONTEXT *>(ctx);
  full->UserContext = stat.serial;
  full->UserContext2 = held;
  fill(stat, info);
  InterlockedIncrement(&creates);
  return STATUS_SUCCESS;
}
static NTSTATUS overwrite(FSP_FILE_SYSTEM *, PVOID ctx, UINT32, BOOLEAN,
                          UINT64 allocation, FSP_FSCTL_FILE_INFO *info) {
  if (allocation)
    return STATUS_NOT_SUPPORTED;
  Stat stat{};
  auto status = bridge.resize(handle(ctx), 0, &stat);
  if (status >= 0)
    fill(stat, info);
  return status;
}
static VOID cleanup(FSP_FILE_SYSTEM *, PVOID, PWSTR name, ULONG flags) {
  InterlockedIncrement(&cleanups);
  if (flags & FspCleanupDelete) {
    auto status = bridge.unlink(name, length(name));
    if (status < 0) {
      InterlockedExchange(&callback_error, 1);
      fprintf(stderr, "OVERLAY_CLEANUP_FAIL %08lx\n",
              static_cast<ULONG>(status));
    } else
      InterlockedIncrement(&deletes);
  }
  // Keep Rust OpenFile/KernelDirectory until Close, not Cleanup.
}
static VOID close_file(FSP_FILE_SYSTEM *, PVOID ctx) {
  auto status = bridge.close(handle(ctx));
  if (status < 0) {
    InterlockedExchange(&callback_error, 1);
    fprintf(stderr, "OVERLAY_CLOSE_FAIL %08lx\n", static_cast<ULONG>(status));
  }
  InterlockedIncrement(&closes);
}
static NTSTATUS read_file(FSP_FILE_SYSTEM *, PVOID ctx, PVOID buffer,
                          UINT64 offset, ULONG size, PULONG count) {
  *count = 0;
  while (*count < size) {
    UINT32 got = 0;
    auto n = size - *count;
    if (n > 131072)
      n = 131072;
    auto status = bridge.read(handle(ctx), offset + *count,
                              static_cast<BYTE *>(buffer) + *count, n, &got);
    if (status < 0)
      return status;
    *count += got;
    if (got < n)
      break;
  }
  InterlockedIncrement(&reads);
  return *count || size == 0 ? STATUS_SUCCESS : STATUS_END_OF_FILE;
}
static NTSTATUS write_file(FSP_FILE_SYSTEM *, PVOID ctx, PVOID buffer,
                           UINT64 offset, ULONG size, BOOLEAN append,
                           BOOLEAN constrained, PULONG count,
                           FSP_FSCTL_FILE_INFO *info) {
  Stat stat{};
  *count = 0;
  auto status = bridge.info(handle(ctx), &stat);
  if (status < 0)
    return status;
  if (append)
    offset = stat.size;
  if (constrained) {
    if (offset >= stat.size) {
      fill(stat, info);
      return STATUS_SUCCESS;
    }
    auto remain = stat.size - offset;
    if (remain < size)
      size = static_cast<ULONG>(remain);
  }
  while (*count < size) {
    UINT32 n = size - *count;
    if (n > 131072)
      n = 131072;
    status = bridge.write(handle(ctx), offset + *count,
                          static_cast<BYTE *>(buffer) + *count, n,
                          (append ? 1u : 0u) | (constrained ? 2u : 0u), &stat);
    if (status < 0)
      return status;
    *count += n;
  }
  fill(stat, info);
  InterlockedIncrement(&writes);
  return STATUS_SUCCESS;
}
static NTSTATUS get_info(FSP_FILE_SYSTEM *, PVOID ctx,
                         FSP_FSCTL_FILE_INFO *info) {
  Stat stat{};
  auto status = bridge.info(handle(ctx), &stat);
  if (status >= 0)
    fill(stat, info);
  return status;
}
static NTSTATUS flush(FSP_FILE_SYSTEM *fs, PVOID ctx,
                      FSP_FSCTL_FILE_INFO *info) {
  return ctx ? get_info(fs, ctx, info) : STATUS_SUCCESS;
}
static NTSTATUS size_file(FSP_FILE_SYSTEM *fs, PVOID ctx, UINT64 size,
                          BOOLEAN allocation, FSP_FSCTL_FILE_INFO *info) {
  Stat stat{};
  auto status = bridge.info(handle(ctx), &stat);
  if (status < 0)
    return status;
  if (allocation && size >= stat.size)
    return get_info(fs, ctx, info); // no reservation of disposable backing
  status = bridge.resize(handle(ctx), size, &stat);
  if (status >= 0)
    fill(stat, info);
  return status;
}
static NTSTATUS can_delete(FSP_FILE_SYSTEM *, PVOID ctx, PWSTR) {
  Stat stat{};
  auto status = bridge.info(handle(ctx), &stat);
  return status < 0       ? status
         : stat.directory ? STATUS_NOT_SUPPORTED
                          : STATUS_SUCCESS;
}
static NTSTATUS rename_file(FSP_FILE_SYSTEM *, PVOID, PWSTR from, PWSTR to,
                            BOOLEAN replace) {
  auto status = bridge.rename(from, length(from), to, length(to), replace);
  if (status >= 0)
    InterlockedIncrement(&renames);
  return status;
}
static NTSTATUS directory(FSP_FILE_SYSTEM *, PVOID ctx, PWSTR, PWSTR marker,
                          PVOID buffer, ULONG capacity, PULONG count) {
  *count = 0;
  if (static_cast<FSP_FSCTL_TRANSACT_FULL_CONTEXT *>(ctx)->UserContext !=
      root_serial)
    return STATUS_NOT_SUPPORTED;
  WCHAR after[256]{};
  if (marker) {
    if (length(marker) > 255)
      return STATUS_INVALID_PARAMETER;
    wcscpy_s(after, marker);
  }
  for (;;) {
    WCHAR name[256]{};
    UINT32 len = 0;
    Stat stat{};
    auto status = bridge.next(after, length(after), name, 255, &len, &stat);
    if (status < 0)
      return status;
    if (!len) {
      api.add(nullptr, buffer, capacity, count);
      return STATUS_SUCCESS;
    }
    alignas(8) BYTE row[sizeof(FSP_FSCTL_DIR_INFO) + 512]{};
    auto di = reinterpret_cast<FSP_FSCTL_DIR_INFO *>(row);
    di->Size = static_cast<UINT16>(sizeof(*di) + len * sizeof(WCHAR));
    fill(stat, &di->FileInfo);
    memcpy(di->FileNameBuf, name, len * sizeof(WCHAR));
    if (!api.add(di, buffer, capacity, count))
      return STATUS_SUCCESS;
    name[len] = 0;
    wcscpy_s(after, name);
  }
}
static bool owner_security() {
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token))
    return false;
  DWORD need = 0;
  GetTokenInformation(token, TokenUser, nullptr, 0, &need);
  auto data = static_cast<TOKEN_USER *>(LocalAlloc(LMEM_FIXED, need));
  bool ok = data && GetTokenInformation(token, TokenUser, data, need, &need);
  CloseHandle(token);
  PWSTR sid = nullptr;
  if (ok)
    ok = 0 != ConvertSidToStringSidW(data->User.Sid, &sid);
  WCHAR sddl[256]{};
  if (ok) {
    swprintf_s(sddl, L"O:%sG:%sD:P(A;;FA;;;%s)", sid, sid, sid);
    ok = 0 != ConvertStringSecurityDescriptorToSecurityDescriptorW(
                  sddl, SDDL_REVISION_1, &security, nullptr);
  }
  if (sid)
    LocalFree(sid);
  if (data)
    LocalFree(data);
  return ok;
}
static bool fresh_absolute(PCWSTR path) {
  auto size = wcslen(path);
  if (size < 4 || size > 32000 || path[1] != L':' ||
      (path[2] != L'\\' && path[2] != L'/'))
    return false;
  if (GetFileAttributesW(path) != INVALID_FILE_ATTRIBUTES)
    return false;
  return GetLastError() == ERROR_FILE_NOT_FOUND;
}

static bool mark(PCWSTR root, PCWSTR phase) {
  WCHAR path[32768];
  swprintf_s(path, L"%s\\%s", root, phase);
  HANDLE h = CreateFileW(path, GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                         FILE_ATTRIBUTE_NORMAL, nullptr);
  if (h == INVALID_HANDLE_VALUE)
    return false;
  CloseHandle(h);
  return true;
}
static bool exists(PCWSTR root, PCWSTR phase) {
  WCHAR path[32768];
  swprintf_s(path, L"%s\\%s", root, phase);
  return GetFileAttributesW(path) != INVALID_FILE_ATTRIBUTES;
}
int wmain(int argc, wchar_t **argv) {
  puts("WinFsp - Windows File System Proxy, Copyright (C) Bill Zissimopoulos");
  puts("https://github.com/winfsp/winfsp - diagnostic Rust Overlay bridge");
  if (argc != 5) {
    fwprintf(stderr, L"usage: probe <installed-WinFsp-dll> <new-mount> "
                     L"<new-control> <Rust-bridge-dll>\n");
    return 1;
  }
  if (!fresh_absolute(argv[2])) {
    fwprintf(stderr, L"refusing non-absolute or existing mount\n");
    return 1;
  }
  if (!fresh_absolute(argv[3]) || 0 == _wcsicmp(argv[2], argv[3]) ||
      !CreateDirectoryW(argv[3], nullptr)) {
    fwprintf(stderr, L"refusing invalid/existing control\n");
    return 1;
  }
  api.dll = LoadLibraryExW(argv[1], nullptr,
                           LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR |
                               LOAD_LIBRARY_SEARCH_SYSTEM32);
  bridge.dll = LoadLibraryExW(argv[4], nullptr,
                              LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR |
                                  LOAD_LIBRARY_SEARCH_SYSTEM32);
  if (!api.dll || !bridge.dll) {
    fprintf(stderr, "DLL load failed %lu\n", GetLastError());
    return 2;
  }
#define LOAD(object, member, symbol)                                           \
  object.member = reinterpret_cast<decltype(object.member)>(                   \
      GetProcAddress(object.dll, #symbol));                                    \
  if (!object.member) {                                                        \
    fprintf(stderr, "export missing: " #symbol "\n");                          \
    return 2;                                                                  \
  }
  LOAD(api, create, FspFileSystemCreate);
  LOAD(api, destroy, FspFileSystemDelete);
  LOAD(api, mount, FspFileSystemSetMountPoint);
  LOAD(api, unmount, FspFileSystemRemoveMountPoint);
  LOAD(api, start, FspFileSystemStartDispatcher);
  LOAD(api, stop, FspFileSystemStopDispatcher);
  LOAD(api, add, FspFileSystemAddDirInfo);
  LOAD(bridge, start, lf_start);
  LOAD(bridge, stat, lf_stat);
  LOAD(bridge, open, lf_open);
  LOAD(bridge, info, lf_info);
  LOAD(bridge, read, lf_read);
  LOAD(bridge, write, lf_write);
  LOAD(bridge, resize, lf_resize);
  LOAD(bridge, rename, lf_rename);
  LOAD(bridge, unlink, lf_unlink);
  LOAD(bridge, close, lf_close);
  LOAD(bridge, next, lf_next);
  LOAD(bridge, capture, lf_capture);
  LOAD(bridge, captured, lf_captured);
  LOAD(bridge, release_capture, lf_release_capture);
  LOAD(bridge, commit, lf_commit);
  LOAD(bridge, committed, lf_committed);
  LOAD(bridge, observe, lf_observe);
  LOAD(bridge, finish, lf_finish);
#undef LOAD
  WCHAR store[32768];
  swprintf_s(store, L"%s\\store", argv[3]);
  auto started = bridge.start(store, length(store));
  if (started < 0)
    return 1;
  Stat root{};
  if (bridge.stat(L"\\", 1, &root) < 0 || !owner_security())
    return 1;
  root_serial = root.serial;
  FSP_FILE_SYSTEM_INTERFACE callbacks{};
  callbacks.GetVolumeInfo = volume;
  callbacks.GetSecurityByName = security_name;
  callbacks.Create = create_file;
  callbacks.Open = open_file;
  callbacks.Overwrite = overwrite;
  callbacks.Cleanup = cleanup;
  callbacks.Close = close_file;
  callbacks.Read = read_file;
  callbacks.Write = write_file;
  callbacks.Flush = flush;
  callbacks.GetFileInfo = get_info;
  callbacks.SetFileSize = size_file;
  callbacks.CanDelete = can_delete;
  callbacks.Rename = rename_file;
  callbacks.GetSecurity = get_security;
  callbacks.ReadDirectory = directory;
  FSP_FSCTL_VOLUME_PARAMS params{};
  params.Version = sizeof(params);
  params.SectorSize = 512;
  params.SectorsPerAllocationUnit = 8;
  params.MaxComponentLength = 255;
  params.VolumeSerialNumber = 0x4c465350;
  params.FileInfoTimeout = 0;
  params.CaseSensitiveSearch = 1;
  params.CasePreservedNames = 1;
  params.UnicodeOnDisk = 1;
  params.PersistentAcls = 1;
  params.UmFileContextIsFullContext = 1;
  params.FlushAndPurgeOnCleanup = 1;
  wcscpy_s(params.FileSystemName, L"LayerFS-Overlay");
  FSP_FILE_SYSTEM *fs = nullptr;
  NTSTATUS status =
      api.create(const_cast<PWSTR>(L"WinFsp.Disk"), &params, &callbacks, &fs);
  if (status < 0) {
    fprintf(stderr, "create NTSTATUS=%08lx\n", static_cast<ULONG>(status));
    return 1;
  }
  status = api.mount(fs, argv[2]);
  if (status >= 0)
    status = api.start(fs, 2);
  bool done = false, captured = false, checked = false;
  bool committed1 = false, committed2 = false, unchanged = false;
  if (status >= 0 && mark(argv[3], L"ready")) {
    puts("NATIVE_OVERLAY_READY");
    fflush(stdout);
    auto deadline = GetTickCount64() + 45000;
    while (GetTickCount64() < deadline) {
      if (!captured && exists(argv[3], L"capture")) {
        if (bridge.capture() < 0)
          break;
        captured = true;
        if (!mark(argv[3], L"captured"))
          break;
      }
      if (captured && !checked && exists(argv[3], L"check-capture")) {
        BYTE bytes[131072]{};
        UINT32 count = 0;
        constexpr char expected[] = "before capture";
        if (bridge.captured(L"\\capture.txt", 12, bytes, sizeof(bytes),
                            &count) < 0 ||
            count != sizeof(expected) - 1 ||
            memcmp(bytes, expected, count) != 0)
          break;
        puts("OVERLAY_CAPTURE_STABLE old_bytes=true later_mutation=true");
        checked = true;
        if (!mark(argv[3], L"capture-checked"))
          break;
      }
      if (checked && !committed1 && exists(argv[3], L"commit-one")) {
        UINT32 changed = 0;
        if (bridge.release_capture() < 0 || bridge.commit(&changed) < 0 ||
            changed != 1)
          break;
        BYTE bytes[128]{};
        UINT32 count = 0;
        constexpr char expected[] = "after! capture";
        if (bridge.committed(0, L"\\capture.txt", 12, bytes, sizeof(bytes),
                             &count) < 0 ||
            count != sizeof(expected) - 1 || memcmp(bytes, expected, count))
          break;
        committed1 = true;
        puts("NATIVE_COMMIT_ONE_PASS reopened_history=true via=Workspace");
        if (!mark(argv[3], L"committed-one"))
          break;
      }
      if (committed1 && !committed2 && exists(argv[3], L"commit-two")) {
        BYTE old[128]{};
        UINT32 old_count = 0;
        constexpr char before[] = "after! capture";
        if (bridge.committed(0, L"\\capture.txt", 12, old, sizeof(old),
                             &old_count) < 0 ||
            old_count != sizeof(before) - 1 || memcmp(old, before, old_count))
          break;
        UINT32 changed = 0;
        if (bridge.commit(&changed) < 0 || changed != 1)
          break;
        BYTE bytes[128]{};
        UINT32 count = 0;
        constexpr char expected[] = "final! capture";
        if (bridge.committed(1, L"\\capture.txt", 12, bytes, sizeof(bytes),
                             &count) < 0 ||
            count != sizeof(expected) - 1 || memcmp(bytes, expected, count))
          break;
        committed2 = true;
        puts("NATIVE_COMMIT_TWO_PASS earlier_snapshot_stable=true "
             "later_write_published=true");
        if (!mark(argv[3], L"committed-two"))
          break;
      }
      if (committed2 && !unchanged && exists(argv[3], L"commit-unchanged")) {
        UINT32 changed = 1;
        if (bridge.commit(&changed) < 0 || changed != 0)
          break;
        unchanged = true;
        puts("NATIVE_COMMIT_UPTODATE_PASS new_commit=false");
        if (!mark(argv[3], L"committed-unchanged"))
          break;
      }
      if (exists(argv[3], L"stop")) {
        done = true;
        break;
      }
      Sleep(10);
    }
  } else
    fprintf(stderr, "mount/start NTSTATUS=%08lx\n", static_cast<ULONG>(status));
  api.stop(fs);
  api.unmount(fs);
  api.destroy(fs);
  LocalFree(security);
  auto closed = bridge.finish();
  printf("CALLBACKS create=%ld open=%ld read=%ld write=%ld rename=%ld "
         "cleanup=%ld close=%ld delete=%ld errors=%ld\n",
         creates, opens, reads, writes, renames, cleanups, closes, deletes,
         callback_error);
  if (closed == 0) {
    FreeLibrary(bridge.dll);
    FreeLibrary(api.dll);
  } // failure keeps original Rust owner state until process ends
  puts("NOT_RUN product_Workspace concurrent_commit mapped_lifecycle "
       "full_repository");
  return done && captured && checked && committed1 && committed2 && unchanged &&
                 closed == 0 && !callback_error && creates && reads && writes &&
                 renames && deletes
             ? 0
             : 1;
}
