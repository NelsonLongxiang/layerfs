// Native WinFsp -> Rust Workspace/Overlay diagnostic. Build: winfsp-build.ps1.
// winfsp-probe.exe <installed-WinFsp-dll> <new-mount> <new-control>
// <Rust-bridge-dll>
#define NOMINMAX
#include <cstdio>
#include <cstring>
#include <cwchar>
#include <atomic>
#include <thread>
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
  UINT32 nanos, mode, directory, attributes;
};
static_assert(sizeof(Stat) == 40, "Rust ABI Stat size");
struct CloseState {
  UINT64 files, directories;
  UINT32 pending_commit, capture, retained, prepared;
};
static_assert(sizeof(CloseState) == 32, "Rust ABI CloseState size");
struct Bridge {
  HMODULE dll = nullptr;
  INT32(__cdecl *start)(PCWSTR, UINT32) = nullptr;
  INT32(__cdecl *reopen)(PCWSTR, UINT32, PCWSTR, UINT32) = nullptr;
  INT32(__cdecl *bind_stdin)(PCWSTR, UINT32, PCWSTR, UINT32) = nullptr;
  INT32(__cdecl *stat)(PCWSTR, UINT32, Stat *) = nullptr;
  INT32(__cdecl *open)
  (PCWSTR, UINT32, UINT32, UINT32, UINT64 *, Stat *) = nullptr;
  INT32(__cdecl *info)(UINT64, Stat *) = nullptr;
  INT32(__cdecl *create)
  (PCWSTR, UINT32, UINT32, UINT32, UINT32, UINT64 *, Stat *) = nullptr;
  INT32(__cdecl *read)(UINT64, UINT64, PVOID, UINT32, UINT32 *) = nullptr;
  INT32(__cdecl *write)
  (UINT64, UINT64, PVOID, UINT32, UINT32, Stat *) = nullptr;
  INT32(__cdecl *resize)(UINT64, UINT64, Stat *) = nullptr;
  INT32(__cdecl *overwrite)(UINT64, UINT32, UINT32, Stat *) = nullptr;
  INT32(__cdecl *basic_info)
  (UINT64, UINT32, UINT64, UINT64, UINT64, UINT64, Stat *) = nullptr;
  INT32(__cdecl *rename)(PCWSTR, UINT32, PCWSTR, UINT32, UINT32) = nullptr;
  INT32(__cdecl *can_delete)(PCWSTR, UINT32) = nullptr;
  INT32(__cdecl *dot)(UINT64, UINT32, UINT32 *, Stat *) = nullptr;
  INT32(__cdecl *unlink)(PCWSTR, UINT32) = nullptr;
  INT32(__cdecl *close)(UINT64) = nullptr;
  INT32(__cdecl *next)
  (UINT64, PCWSTR, UINT32, PWSTR, UINT32, UINT32 *, Stat *) = nullptr;
  INT32(__cdecl *capture)() = nullptr;
  INT32(__cdecl *captured)(PCWSTR, UINT32, PVOID, UINT32, UINT32 *) = nullptr;
  INT32(__cdecl *release_capture)() = nullptr;
  INT32(__cdecl *commit_scoped)(UINT32, UINT32 *) = nullptr;
  INT32(__cdecl *committed)
  (UINT32, PCWSTR, UINT32, PVOID, UINT32, UINT32 *) = nullptr;
  INT32(__cdecl *published_byte)(PCWSTR, UINT32, UINT32 *) = nullptr;
  INT32(__cdecl *latest_byte)(PCWSTR, UINT32, UINT32 *) = nullptr;
  INT32(__cdecl *frontier)(UINT64 *, INT64 *, UINT64 *) = nullptr;
  INT32(__cdecl *observe)() = nullptr;
  INT32(__cdecl *close_state)(CloseState *) = nullptr;
  INT32(__cdecl *prepare_close)() = nullptr;
  INT32(__cdecl *finish)() = nullptr;
} bridge;
static PSECURITY_DESCRIPTOR security = nullptr;
static volatile LONG creates = 0, opens = 0, reads = 0, writes = 0, renames = 0,
                     cleanups = 0, closes = 0, deletes = 0, callback_error = 0;
static volatile LONG ordinary_writes = 0, constrained_writes = 0;
static bool cache_mode = false;
static bool trace_handles = false;
static volatile LONG trace_events = 0;
// Bounded diagnostic output, not an admission limit. Saturation is explicit.
static void trace_handle(const char *event, UINT64 held, UINT64 serial,
                         ULONG flags, PCWSTR name = nullptr) {
  if (!trace_handles)
    return;
  auto seq = InterlockedIncrement(&trace_events);
  if (seq > 20000) {
    if (seq == 20001) {
      puts("NATIVE_HANDLE_TRACE_SATURATED limit=20000");
      fflush(stdout);
    }
    return;
  }
  printf("NATIVE_HANDLE event=%s seq=%ld tick=%llu handle=%llu serial=%llu "
         "flags=%08lx name=%ls\n",
         event, seq, GetTickCount64(), held, serial, flags, name ? name : L"-");
  fflush(stdout);
}
static UINT32 length(PCWSTR text) {
  return text ? static_cast<UINT32>(wcslen(text)) : 0;
}
static UINT64 handle(PVOID ctx) {
  return static_cast<FSP_FSCTL_TRANSACT_FULL_CONTEXT *>(ctx)->UserContext2;
}
static void fill(const Stat &stat, FSP_FSCTL_FILE_INFO *info) {
  *info = {};
  info->FileAttributes =
      stat.attributes | (stat.directory ? FILE_ATTRIBUTE_DIRECTORY : 0);
  if (!(stat.mode & 0200))
    info->FileAttributes |= FILE_ATTRIBUTE_READONLY;
  if (!info->FileAttributes)
    info->FileAttributes = FILE_ATTRIBUTE_NORMAL;
  info->IndexNumber = stat.serial;
  info->FileSize = stat.size;
  info->AllocationSize = (stat.size + 4095) & ~UINT64(4095);
  if (stat.mtime >= -11644473600LL) {
    auto seconds = static_cast<UINT64>(stat.mtime) + UINT64(11644473600);
    auto fraction = stat.nanos / 100;
    if (seconds > (UINT64_MAX - fraction) / 10000000)
      return; // Portable time outside FILETIME: no wrapping or signed overflow.
    auto time = seconds * 10000000 + fraction;
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
  auto status =
      bridge.open(name, length(name), 0,
                  ((access & (FILE_WRITE_DATA | FILE_APPEND_DATA)) ? 1u : 0u) |
                      ((access & FILE_WRITE_ATTRIBUTES) ? 2u : 0u),
                  &held, &stat);
  if (status < 0)
    return status;
  auto full = reinterpret_cast<FSP_FSCTL_TRANSACT_FULL_CONTEXT *>(ctx);
  full->UserContext = stat.serial;
  full->UserContext2 = held;
  fill(stat, info);
  InterlockedIncrement(&opens);
  trace_handle("open", held, stat.serial, access, name);
  return STATUS_SUCCESS;
}
static NTSTATUS create_file(FSP_FILE_SYSTEM *, PWSTR name, UINT32 options,
                            UINT32 access, UINT32 attributes,
                            PSECURITY_DESCRIPTOR, UINT64 allocation, PVOID *ctx,
                            FSP_FSCTL_FILE_INFO *info) {
  if (allocation)
    return STATUS_NOT_SUPPORTED;
  Stat stat{};
  UINT64 held = 0;
  auto status = bridge.create(
      name, length(name), (options & FILE_DIRECTORY_FILE) ? 1u : 0u,
      ((access & (FILE_WRITE_DATA | FILE_APPEND_DATA)) ? 1u : 0u) |
          ((access & FILE_WRITE_ATTRIBUTES) ? 2u : 0u),
      attributes, &held, &stat);
  if (status < 0)
    return status;
  auto full = reinterpret_cast<FSP_FSCTL_TRANSACT_FULL_CONTEXT *>(ctx);
  full->UserContext = stat.serial;
  full->UserContext2 = held;
  fill(stat, info);
  InterlockedIncrement(&creates);
  trace_handle("create", held, stat.serial, access, name);
  return STATUS_SUCCESS;
}
static NTSTATUS overwrite(FSP_FILE_SYSTEM *, PVOID ctx, UINT32 attributes,
                          BOOLEAN replace, UINT64 allocation,
                          FSP_FSCTL_FILE_INFO *info) {
  if (allocation)
    return STATUS_NOT_SUPPORTED;
  Stat stat{};
  auto status =
      bridge.overwrite(handle(ctx), attributes, replace ? 1u : 0u, &stat);
  if (status >= 0)
    fill(stat, info);
  return status;
}
static VOID cleanup(FSP_FILE_SYSTEM *, PVOID ctx, PWSTR name, ULONG flags) {
  InterlockedIncrement(&cleanups);
  trace_handle("cleanup", handle(ctx),
               static_cast<FSP_FSCTL_TRANSACT_FULL_CONTEXT *>(ctx)->UserContext,
               flags, name);
  if (flags & FspCleanupDelete) {
    auto status = bridge.unlink(name, length(name));
    if (status < 0) {
      InterlockedExchange(&callback_error, 1);
      fprintf(stderr, "OVERLAY_CLEANUP_FAIL %08lx\n",
              static_cast<ULONG>(status));
    } else
      InterlockedIncrement(&deletes);
  }
  if (cache_mode) {
    printf("CACHE_CLEANUP handle=%llu flags=%lu closes=%ld\n", handle(ctx),
           flags, closes);
    fflush(stdout);
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
  trace_handle("close", handle(ctx),
               static_cast<FSP_FSCTL_TRANSACT_FULL_CONTEXT *>(ctx)->UserContext,
               static_cast<ULONG>(status));
  if (cache_mode) {
    printf("CACHE_CLOSE handle=%llu cleanup=%ld\n", handle(ctx), cleanups);
    fflush(stdout);
  }
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
  InterlockedIncrement(constrained ? &constrained_writes : &ordinary_writes);
  if (cache_mode) {
    printf("CACHE_WRITE constrained=%u append=%u offset=%llu requested=%lu "
           "done=%lu handle=%llu\n",
           constrained, append, offset, size, *count, handle(ctx));
    fflush(stdout);
  }
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
static NTSTATUS basic_info(FSP_FILE_SYSTEM *, PVOID ctx, UINT32 attributes,
                           UINT64 creation, UINT64 access, UINT64 write,
                           UINT64 change, FSP_FSCTL_FILE_INFO *info) {
  Stat stat{};
  auto status = bridge.basic_info(handle(ctx), attributes, creation, access,
                                  write, change, &stat);
  printf("NATIVE_BASIC_INFO attributes=%08lx creation=%llu access=%llu "
         "write=%llu change=%llu status=%08lx\n",
         static_cast<ULONG>(attributes), creation, access, write, change,
         static_cast<ULONG>(status));
  fflush(stdout);
  if (status >= 0)
    fill(stat, info);
  return status;
}
static NTSTATUS can_delete(FSP_FILE_SYSTEM *, PVOID, PWSTR name) {
  return bridge.can_delete(name, length(name));
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
  WCHAR after[256]{};
  if (!marker || !wcscmp(marker, L".")) {
    for (UINT32 parent = marker ? 1u : 0u; parent < 2; ++parent) {
      Stat stat{};
      UINT32 found = 0;
      auto status = bridge.dot(handle(ctx), parent, &found, &stat);
      if (status < 0)
        return status;
      if (found) {
        alignas(8) BYTE row[sizeof(FSP_FSCTL_DIR_INFO) + 4]{};
        auto di = reinterpret_cast<FSP_FSCTL_DIR_INFO *>(row);
        di->Size =
            static_cast<UINT16>(sizeof(*di) + (parent + 1) * sizeof(WCHAR));
        fill(stat, &di->FileInfo);
        di->FileNameBuf[0] = L'.';
        if (parent)
          di->FileNameBuf[1] = L'.';
        if (!api.add(di, buffer, capacity, count))
          return STATUS_SUCCESS;
      }
    }
  }
  if (marker && wcscmp(marker, L".") && wcscmp(marker, L"..")) {
    if (length(marker) > 255)
      return STATUS_INVALID_PARAMETER;
    wcscpy_s(after, marker);
  }
  for (;;) {
    WCHAR name[256]{};
    UINT32 len = 0;
    Stat stat{};
    auto status =
        bridge.next(handle(ctx), after, length(after), name, 255, &len, &stat);
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
  WCHAR trace[2]{};
  trace_handles =
      GetEnvironmentVariableW(L"LAYERFS_NATIVE_TRACE_HANDLES", trace, 2) == 1 &&
      trace[0] == L'1';
  puts("WinFsp - Windows File System Proxy, Copyright (C) Bill Zissimopoulos");
  puts("https://github.com/winfsp/winfsp - diagnostic Rust Overlay bridge");
  const bool binding_mode = argc == 7 && wcscmp(argv[5], L"--bind-stdin") == 0;
  if (argc != 5 && argc != 6 && !binding_mode) {
    fwprintf(stderr, L"usage: probe <installed-WinFsp-dll> <new-mount> "
                     L"<new-control> <Rust-bridge-dll> [existing-Store | "
                     L"--bind-stdin existing-Store]\n");
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
  LOAD(bridge, reopen, lf_reopen);
  LOAD(bridge, bind_stdin, lf_bind_stdin);
  LOAD(bridge, stat, lf_stat);
  LOAD(bridge, open, lf_open);
  LOAD(bridge, info, lf_info);
  LOAD(bridge, create, lf_create);
  LOAD(bridge, read, lf_read);
  LOAD(bridge, write, lf_write);
  LOAD(bridge, resize, lf_resize);
  LOAD(bridge, overwrite, lf_overwrite);
  LOAD(bridge, basic_info, lf_basic_info);
  LOAD(bridge, rename, lf_rename);
  LOAD(bridge, can_delete, lf_can_delete);
  LOAD(bridge, dot, lf_dot);
  LOAD(bridge, unlink, lf_unlink);
  LOAD(bridge, close, lf_close);
  LOAD(bridge, next, lf_next);
  LOAD(bridge, capture, lf_capture);
  LOAD(bridge, captured, lf_captured);
  LOAD(bridge, release_capture, lf_release_capture);
  LOAD(bridge, commit_scoped, lf_commit_scoped);
  LOAD(bridge, committed, lf_committed);
  LOAD(bridge, published_byte, lf_published_byte);
  LOAD(bridge, latest_byte, lf_latest_byte);
  LOAD(bridge, frontier, lf_frontier);
  LOAD(bridge, observe, lf_observe);
  LOAD(bridge, close_state, lf_close_state);
  LOAD(bridge, prepare_close, lf_prepare_close);
  LOAD(bridge, finish, lf_finish);
#undef LOAD
  WCHAR store[32768];
  swprintf_s(store, L"%s\\store", argv[3]);
  cache_mode = argc == 6 && wcscmp(argv[5], L"--cache-boundary") == 0;
  const bool concurrent_mode =
      argc == 6 && wcscmp(argv[5], L"--concurrent") == 0;
  const bool close_mode =
      argc == 6 && wcscmp(argv[5], L"--close-boundary") == 0;
  const bool rebound =
      argc == 6 && !cache_mode && !concurrent_mode && !close_mode;
  auto started =
      binding_mode
          ? bridge.bind_stdin(argv[6], length(argv[6]), store, length(store))
          : (rebound
                 ? bridge.reopen(argv[5], length(argv[5]), store, length(store))
                 : bridge.start(store, length(store)));
  if (started < 0)
    return 1;
  Stat root{};
  if (bridge.stat(L"\\", 1, &root) < 0 || !owner_security())
    return 1;
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
  callbacks.SetBasicInfo = basic_info;
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
  unsigned cache_phase = 0;
  unsigned close_phase = 0;
  unsigned binding_commits = 0;
  bool close_prepared = false, close_checked = false, idle_reported = false;
  CloseState last_close_state{};
  bool have_close_state = false;
  std::thread commit_worker;
  std::atomic<bool> worker_done{false};
  INT32 worker_status = STATUS_PENDING;
  UINT32 worker_changed = 0;
  bool worker_started = false, concurrent_captured = false,
       concurrent_written = false;
  UINT64 captured_generation = 0;
  INT64 captured_revision = 0;
  if (status >= 0 && mark(argv[3], L"ready")) {
    puts(
        binding_mode
            ? "NATIVE_BIND_READY existing_store=true init=false stdin_only=true"
            : (rebound ? "NATIVE_REBOUND_READY existing_store=true init=false"
                       : "NATIVE_OVERLAY_READY"));
    fflush(stdout);
    auto deadline = GetTickCount64() + 45000;
    while (GetTickCount64() < deadline) {
      if (binding_mode) {
        WCHAR request[48], ack[48];
        swprintf_s(request, L"binding-commit-%u", binding_commits);
        swprintf_s(ack, L"binding-committed-%u", binding_commits);
        if (exists(argv[3], request)) {
          UINT32 changed = 0xa5a5a5a5u;
          if (bridge.commit_scoped(1, &changed) < 0)
            break;
          printf("EXPLICIT_BIND_COMMIT index=%u changed=%u scope=published\n",
                 binding_commits, changed);
          fflush(stdout);
          if (!mark(argv[3], ack))
            break;
          ++binding_commits;
        }
      }
      if (close_mode && close_phase < 4) {
        WCHAR request[32], ack[32];
        swprintf_s(request, L"close-attempt-%u", close_phase);
        swprintf_s(ack, L"close-refused-%u", close_phase);
        if (exists(argv[3], request)) {
          CloseState before{}, after{};
          if (bridge.close_state(&before) < 0)
            break;
          auto refused = bridge.prepare_close();
          if (bridge.close_state(&after) < 0 || refused != STATUS_DEVICE_BUSY ||
              memcmp(&before, &after, sizeof(before)) || after.prepared)
            break;
          printf("NORMAL_CLOSE_REFUSED phase=%u status=%08lx files=%llu "
                 "directories=%llu commit=%u capture=%u prepared=%u "
                 "service_kept=true\n",
                 close_phase, static_cast<ULONG>(refused), before.files,
                 before.directories, before.pending_commit, before.capture,
                 before.prepared);
          fflush(stdout);
          if (!mark(argv[3], ack))
            break;
          ++close_phase;
        }
      }
      if (exists(argv[3], L"close-inspect") && !idle_reported) {
        CloseState state{};
        if (bridge.close_state(&state) < 0)
          break;
        if (!have_close_state ||
            memcmp(&state, &last_close_state, sizeof(state))) {
          printf("NORMAL_CLOSE_OBSERVED files=%llu directories=%llu commit=%u "
                 "capture=%u retained=%u prepared=%u cleanup=%ld close=%ld\n",
                 state.files, state.directories, state.pending_commit,
                 state.capture, state.retained, state.prepared, cleanups,
                 closes);
          fflush(stdout);
          last_close_state = state;
          have_close_state = true;
        }
        if (!state.files && !state.directories && !state.pending_commit &&
            !state.capture && !state.retained && !state.prepared) {
          puts("NORMAL_CLOSE_IDLE tracked_close_receipts=true "
               "no_section_inventory_claim=true");
          fflush(stdout);
          if (!mark(argv[3], L"close-idle"))
            break;
          idle_reported = true;
        }
      }
      if (concurrent_mode) {
        if (!worker_started && exists(argv[3], L"concurrent-start")) {
          worker_started = true;
          commit_worker = std::thread([&] {
            worker_status = bridge.commit_scoped(1, &worker_changed);
            worker_done.store(true, std::memory_order_release);
          });
        }
        if (worker_started && !concurrent_captured) {
          UINT64 active = 0, capture_now = 0;
          INT64 revision = 0;
          if (bridge.frontier(&capture_now, &revision, &active) < 0)
            break;
          if (capture_now) {
            if (worker_done.load(std::memory_order_acquire))
              break;
            UINT32 sentinel = 0xa5a5a5a5u;
            if (bridge.commit_scoped(1, &sentinel) != STATUS_DEVICE_BUSY ||
                sentinel != 0xa5a5a5a5u ||
                bridge.capture() != STATUS_DEVICE_BUSY ||
                bridge.prepare_close() != STATUS_DEVICE_BUSY ||
                bridge.finish() != STATUS_DEVICE_BUSY)
              break;
            captured_generation = capture_now;
            captured_revision = revision;
            concurrent_captured = true;
            printf(
                "CONCURRENT_CAPTURE generation=%llu revision=%lld active=%llu "
                "duplicate_commit=Busy capture=Busy close=Busy\n",
                capture_now, revision, active);
            fflush(stdout);
            if (!mark(argv[3], L"concurrent-captured"))
              break;
          }
        }
        if (concurrent_captured && !concurrent_written &&
            exists(argv[3], L"concurrent-writes")) {
          UINT64 active = 0, capture_now = 0;
          INT64 revision = 0;
          UINT32 current = 0;
          if (bridge.frontier(&capture_now, &revision, &active) < 0 ||
              capture_now != captured_generation ||
              revision <= captured_revision ||
              worker_done.load(std::memory_order_acquire) ||
              bridge.published_byte(L"\\concurrent.txt", 15, &current) < 0 ||
              current != 'd')
            break;
          concurrent_written = true;
          printf("CONCURRENT_WRITES_CONFIRMED captured=%llu active=%llu "
                 "capture_revision=%lld later_revision=%lld "
                 "commit_still_running=true\n",
                 capture_now, active, captured_revision, revision);
          fflush(stdout);
          if (!mark(argv[3], L"concurrent-writes-seen"))
            break;
        }
        if (concurrent_written && !committed1 &&
            worker_done.load(std::memory_order_acquire)) {
          commit_worker.join();
          if (worker_status < 0 || worker_changed != 1)
            break;
          BYTE bytes[128]{};
          UINT32 count = 0;
          constexpr char expected[] = "before commit";
          if (bridge.committed(0, L"\\concurrent.txt", 15, bytes, sizeof(bytes),
                               &count) < 0 ||
              count != sizeof(expected) - 1 || memcmp(bytes, expected, count))
            break;
          if (bridge.committed(0, L"\\late-during.txt", 16, bytes,
                               sizeof(bytes),
                               &count) != STATUS_OBJECT_NAME_NOT_FOUND)
            break;
          UINT32 current = 0;
          if (bridge.published_byte(L"\\concurrent.txt", 15, &current) < 0 ||
              current != 'd')
            break;
          committed1 = true;
          puts("CONCURRENT_INSTALL_PASS old_commit_fixed=true "
               "later_live_preserved=true");
          fflush(stdout);
          if (!mark(argv[3], L"concurrent-installed"))
            break;
        }
        if (committed1 && !committed2 &&
            exists(argv[3], L"concurrent-second")) {
          UINT32 changed = 0;
          if (bridge.commit_scoped(1, &changed) < 0 || changed != 1)
            break;
          BYTE bytes[128]{};
          UINT32 count = 0;
          constexpr char expected[] = "after! commit";
          if (bridge.committed(1, L"\\concurrent.txt", 15, bytes, sizeof(bytes),
                               &count) < 0 ||
              count != sizeof(expected) - 1 || memcmp(bytes, expected, count))
            break;
          constexpr char late[] = "new generation";
          if (bridge.committed(1, L"\\late-during.txt", 16, bytes,
                               sizeof(bytes), &count) < 0 ||
              count != sizeof(late) - 1 || memcmp(bytes, late, count))
            break;
          committed2 = true;
          if (!mark(argv[3], L"concurrent-second-done"))
            break;
        }
      }
      if (cache_mode && cache_phase < 8) {
        WCHAR request[32], ack[32];
        swprintf_s(request, L"cache-%u", cache_phase);
        swprintf_s(ack, L"cache-ack-%u", cache_phase);
        if (exists(argv[3], request)) {
          UINT32 published = 0, latest = 0, changed = 0;
          // Explicitly test the stronger guarantee; failure must not write
          // outputs or fall back to a published Commit. The following published
          // operation is a separately requested observation, not a retry of
          // this refusal.
          UINT32 refused_changed = 0xa5a5a5a5u;
          NTSTATUS rejected = bridge.commit_scoped(2, &refused_changed);
          if (rejected != STATUS_NOT_SUPPORTED ||
              refused_changed != 0xa5a5a5a5u)
            break;
          UINT32 invalid_changed = 0x5a5a5a5au;
          NTSTATUS invalid = bridge.commit_scoped(0, &invalid_changed);
          if (invalid != STATUS_INVALID_PARAMETER ||
              invalid_changed != 0x5a5a5a5au)
            break;
          printf("COMMIT_SCOPE_REFUSED phase=%u requested=application-visible "
                 "status=%08lx output_unchanged=true invalid_scope=%08lx\n",
                 cache_phase, static_cast<ULONG>(rejected),
                 static_cast<ULONG>(invalid));
          if (bridge.published_byte(L"\\cache.bin", 10, &published) < 0)
            break;
          if (cache_phase == 0) {
            if (published != 65 || bridge.capture() < 0)
              break;
          }
          if (cache_phase <= 2) {
            BYTE old[8192]{};
            UINT32 count = 0;
            if (bridge.captured(L"\\cache.bin", 10, old, sizeof(old), &count) <
                    0 ||
                count != 4096 || old[0] != 65)
              break;
            bool exact = true;
            for (UINT32 i = 0; i < count; ++i)
              if (old[i] != 65)
                exact = false;
            if (!exact)
              break;
            printf("CACHE_CAPTURE phase=%u captured=65 stable=true\n",
                   cache_phase);
          }
          if (cache_phase == 2 && bridge.release_capture() < 0)
            break;
          if (cache_phase >= 2) {
            if (bridge.commit_scoped(1, &changed) < 0 ||
                bridge.latest_byte(L"\\cache.bin", 10, &latest) < 0)
              break;
          }
          UINT32 after = 0;
          if (bridge.published_byte(L"\\cache.bin", 10, &after) < 0 ||
              bridge.observe() < 0)
            break;
          const UINT32 visible[8] = {65, 66, 66, 67, 67, 68, 68, 68};
          printf("CACHE_PHASE phase=%u application=%u published_before=%u "
                 "published_after=%u committed=%u commit_changed=%u writes=%ld "
                 "constrained=%ld cleanup=%ld close=%ld\n",
                 cache_phase, visible[cache_phase], published, after, latest,
                 changed, writes, constrained_writes, cleanups, closes);
          fflush(stdout);
          if (!mark(argv[3], ack))
            break;
          ++cache_phase;
        }
      }
      if (!binding_mode && !close_mode && !concurrent_mode && !cache_mode &&
          !rebound && !captured && exists(argv[3], L"capture")) {
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
        if (bridge.release_capture() < 0 ||
            bridge.commit_scoped(1, &changed) < 0 || changed != 1)
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
      if (!concurrent_mode && committed1 && !committed2 &&
          exists(argv[3], L"commit-two")) {
        BYTE old[128]{};
        UINT32 old_count = 0;
        constexpr char before[] = "after! capture";
        if (bridge.committed(0, L"\\capture.txt", 12, old, sizeof(old),
                             &old_count) < 0 ||
            old_count != sizeof(before) - 1 || memcmp(old, before, old_count))
          break;
        UINT32 changed = 0;
        if (bridge.commit_scoped(1, &changed) < 0 || changed != 1)
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
      if ((committed2 || rebound) && !unchanged &&
          exists(argv[3], L"commit-unchanged")) {
        UINT32 changed = 1;
        if (bridge.commit_scoped(1, &changed) < 0 || changed != 0)
          break;
        unchanged = true;
        puts("NATIVE_COMMIT_UPTODATE_PASS new_commit=false");
        if (!mark(argv[3], L"committed-unchanged"))
          break;
      }
      if (!close_checked && exists(argv[3], L"stop")) {
        close_checked = true;
        auto admission = bridge.prepare_close();
        if (admission == STATUS_DEVICE_BUSY) {
          puts("NORMAL_CLOSE_REFUSED request=stop service_kept=true");
          fflush(stdout);
          if (!mark(argv[3], L"stop-refused"))
            break;
          // This request is consumed, never busy-retried. An external
          // controller may release its references and make a distinct terminal
          // request.
        } else if (admission < 0) {
          break;
        } else {
          close_prepared = true;
          done = true;
          break;
        }
      }
      if (close_checked && !close_prepared &&
          exists(argv[3], L"stop-after-release")) {
        auto admission = bridge.prepare_close();
        if (admission < 0) {
          fprintf(stderr, "normal close second request=%08lx\n",
                  static_cast<ULONG>(admission));
          break;
        }
        close_prepared = true;
        done = true;
        break;
      }
      Sleep(10);
    }
  } else
    fprintf(stderr, "mount/start NTSTATUS=%08lx\n", static_cast<ULONG>(status));
  if (commit_worker.joinable()) {
    // Only the diagnostic lane-holder consumes this release; no mutation
    // replay.
    if (!exists(argv[3], L"lane-release"))
      mark(argv[3], L"lane-release");
    commit_worker.join();
  }
  if (!close_prepared) {
    fprintf(stderr,
            "DIAGNOSTIC_EXIT_NOT_NORMAL no_successful_close_admission=true\n");
    // No claim of graceful unmount on an error/timeout. The isolated test
    // process exits; normal code must retain custody rather than guess a
    // reversible stop.
    return 1;
  }
  puts("NORMAL_CLOSE_STOP_BEGIN prepared=true");
  fflush(stdout);
  api.stop(fs);
  puts("NORMAL_CLOSE_DISPATCHER_DRAINED");
  fflush(stdout); // Keep the completed native drain before Rust finish in the
                  // receipt.
  api.unmount(fs);
  api.destroy(fs);
  LocalFree(security);
  auto closed = bridge.finish();
  if (closed == 0)
    puts("NORMAL_CLOSE_DONE detach=true overlay_closed=true");
  printf("CALLBACKS create=%ld open=%ld read=%ld write=%ld rename=%ld "
         "cleanup=%ld close=%ld delete=%ld errors=%ld\n",
         creates, opens, reads, writes, renames, cleanups, closes, deletes,
         callback_error);
  if (closed == 0) {
    FreeLibrary(bridge.dll);
    FreeLibrary(api.dll);
  } // failure keeps original Rust owner state until process ends
  puts("NOT_RUN product_Workspace general_concurrency mapped_lifecycle "
       "full_repository");
  return done && closed == 0 && !callback_error &&
                 (binding_mode || close_mode || cache_mode || unchanged) &&
                 (binding_mode
                      ? (opens && reads)
                      : (close_mode
                             ? (close_phase == 4 && opens && reads)
                             : (concurrent_mode
                                    ? (concurrent_captured &&
                                       concurrent_written && committed1 &&
                                       committed2)
                                    : (cache_mode
                                           ? (cache_phase == 8 && creates &&
                                              writes)
                                           : (rebound
                                                  ? (opens && reads)
                                                  : (captured && checked &&
                                                     committed1 && committed2 &&
                                                     creates && reads &&
                                                     writes && renames &&
                                                     deletes))))))
             ? 0
             : 1;
}
