// Native WinFsp callback diagnostic, not LayerFS storage. Build with
// winfsp-build.ps1. winfsp-probe.exe <absolute-installed-dll>
// <new-absolute-mount> <new-control-dir>
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
// ponytail: one file, 64 KiB fixed diagnostic. This is NOT a production
// cap/backend.
struct Node {
  FSP_FSCTL_FILE_INFO info{};
  bool live = false;
  BYTE bytes[65536]{};
} root, file;
static WCHAR filename[32] = L"\\probe.bin";
static SRWLOCK guard = SRWLOCK_INIT;
static PSECURITY_DESCRIPTOR security = nullptr;
static unsigned creates = 0, opens = 0, reads = 0, writes = 0, renames = 0,
                cleanups = 0, closes = 0, deletes = 0;
struct Lock {
  Lock() { AcquireSRWLockExclusive(&guard); }
  ~Lock() { ReleaseSRWLockExclusive(&guard); }
};
static Node *lookup(PCWSTR name) {
  if (0 == wcscmp(name, L"\\"))
    return &root;
  return file.live && 0 == wcscmp(name, filename) ? &file : nullptr;
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
  Lock lock;
  *info = {};
  info->TotalSize = 65536;
  info->FreeSize = 65536 - file.info.FileSize;
  constexpr WCHAR label[] = L"LayerFS request probe";
  info->VolumeLabelLength = sizeof(label) - sizeof(WCHAR);
  memcpy(info->VolumeLabel, label, sizeof(label));
  return STATUS_SUCCESS;
}
static NTSTATUS security_name(FSP_FILE_SYSTEM *, PWSTR name, PUINT32 attrs,
                              PSECURITY_DESCRIPTOR sd, SIZE_T *size) {
  Lock lock;
  auto n = lookup(name);
  if (!n)
    return STATUS_OBJECT_NAME_NOT_FOUND;
  if (attrs)
    *attrs = n->info.FileAttributes;
  return copy_security(sd, size);
}
static NTSTATUS get_security(FSP_FILE_SYSTEM *, PVOID, PSECURITY_DESCRIPTOR sd,
                             SIZE_T *size) {
  Lock lock;
  return copy_security(sd, size);
}
static NTSTATUS open_file(FSP_FILE_SYSTEM *, PWSTR name, UINT32, UINT32,
                          PVOID *ctx, FSP_FSCTL_FILE_INFO *info) {
  Lock lock;
  auto n = lookup(name);
  if (!n)
    return STATUS_OBJECT_NAME_NOT_FOUND;
  *ctx = n;
  *info = n->info;
  ++opens;
  return STATUS_SUCCESS;
}
static NTSTATUS create_file(FSP_FILE_SYSTEM *, PWSTR name, UINT32 options,
                            UINT32, UINT32 attrs, PSECURITY_DESCRIPTOR,
                            UINT64 allocation, PVOID *ctx,
                            FSP_FSCTL_FILE_INFO *info) {
  Lock lock;
  if (options & FILE_DIRECTORY_FILE)
    return STATUS_NOT_SUPPORTED;
  if (0 != wcscmp(name, L"\\probe.bin"))
    return STATUS_NOT_SUPPORTED;
  if (file.live)
    return STATUS_OBJECT_NAME_COLLISION;
  // Never recycle this one diagnostic node while kernel references might
  // remain.
  if (creates)
    return STATUS_NOT_SUPPORTED;
  if (allocation > sizeof(file.bytes))
    return STATUS_DISK_FULL;
  file = {};
  file.live = true;
  file.info.FileAttributes = attrs | FILE_ATTRIBUTE_ARCHIVE;
  file.info.IndexNumber = 2;
  file.info.AllocationSize = (allocation + 4095) & ~UINT64(4095);
  wcscpy_s(filename, L"\\probe.bin");
  *ctx = &file;
  *info = file.info;
  ++creates;
  return STATUS_SUCCESS;
}
static NTSTATUS overwrite(FSP_FILE_SYSTEM *, PVOID ctx, UINT32 attrs,
                          BOOLEAN replace, UINT64 allocation,
                          FSP_FSCTL_FILE_INFO *info) {
  Lock lock;
  auto n = static_cast<Node *>(ctx);
  if (n != &file || allocation > sizeof(file.bytes))
    return STATUS_NOT_SUPPORTED;
  n->info.FileSize = 0;
  n->info.AllocationSize = (allocation + 4095) & ~UINT64(4095);
  n->info.FileAttributes = replace ? attrs : n->info.FileAttributes | attrs;
  *info = n->info;
  return STATUS_SUCCESS;
}
static VOID cleanup(FSP_FILE_SYSTEM *, PVOID ctx, PWSTR, ULONG flags) {
  Lock lock;
  ++cleanups;
  if ((flags & FspCleanupDelete) && ctx == &file) {
    file.live = false;
    ++deletes;
  }
}
static VOID close_file(FSP_FILE_SYSTEM *, PVOID) {
  Lock lock;
  ++closes;
}
static NTSTATUS read_file(FSP_FILE_SYSTEM *, PVOID ctx, PVOID buffer,
                          UINT64 offset, ULONG length, PULONG count) {
  Lock lock;
  auto n = static_cast<Node *>(ctx);
  *count = 0;
  if (n != &file)
    return STATUS_FILE_IS_A_DIRECTORY;
  if (offset >= n->info.FileSize)
    return STATUS_END_OF_FILE;
  UINT64 available = n->info.FileSize - offset;
  *count = static_cast<ULONG>(available < length ? available : length);
  memcpy(buffer, n->bytes + static_cast<size_t>(offset), *count);
  ++reads;
  return STATUS_SUCCESS;
}
static NTSTATUS write_file(FSP_FILE_SYSTEM *, PVOID ctx, PVOID buffer,
                           UINT64 offset, ULONG length, BOOLEAN append,
                           BOOLEAN constrained, PULONG count,
                           FSP_FSCTL_FILE_INFO *info) {
  Lock lock;
  auto n = static_cast<Node *>(ctx);
  *count = 0;
  if (n != &file)
    return STATUS_FILE_IS_A_DIRECTORY;
  if (append)
    offset = n->info.FileSize;
  if (constrained) {
    if (offset >= n->info.FileSize) {
      *info = n->info;
      return STATUS_SUCCESS;
    }
    auto remain = n->info.FileSize - offset;
    if (remain < length)
      length = static_cast<ULONG>(remain);
  }
  if (offset > sizeof(n->bytes) || length > sizeof(n->bytes) - offset)
    return STATUS_DISK_FULL;
  if (offset > n->info.FileSize)
    memset(n->bytes + n->info.FileSize, 0,
           static_cast<size_t>(offset - n->info.FileSize));
  memcpy(n->bytes + offset, buffer, length);
  auto end = offset + length;
  if (end > n->info.FileSize)
    n->info.FileSize = end;
  n->info.AllocationSize = (n->info.FileSize + 4095) & ~UINT64(4095);
  *count = length;
  *info = n->info;
  ++writes;
  return STATUS_SUCCESS;
}
static NTSTATUS get_info(FSP_FILE_SYSTEM *, PVOID ctx,
                         FSP_FSCTL_FILE_INFO *info) {
  Lock lock;
  *info = static_cast<Node *>(ctx)->info;
  return STATUS_SUCCESS;
}
static NTSTATUS flush(FSP_FILE_SYSTEM *, PVOID ctx, FSP_FSCTL_FILE_INFO *info) {
  Lock lock;
  if (ctx)
    *info = static_cast<Node *>(ctx)->info;
  return STATUS_SUCCESS;
}
static NTSTATUS basic(FSP_FILE_SYSTEM *, PVOID ctx, UINT32 attrs, UINT64 c,
                      UINT64 a, UINT64 w, UINT64 ch,
                      FSP_FSCTL_FILE_INFO *info) {
  Lock lock;
  auto n = static_cast<Node *>(ctx);
  if (attrs != INVALID_FILE_ATTRIBUTES)
    n->info.FileAttributes = attrs;
  if (c)
    n->info.CreationTime = c;
  if (a)
    n->info.LastAccessTime = a;
  if (w)
    n->info.LastWriteTime = w;
  if (ch)
    n->info.ChangeTime = ch;
  *info = n->info;
  return STATUS_SUCCESS;
}
static NTSTATUS size_file(FSP_FILE_SYSTEM *, PVOID ctx, UINT64 size,
                          BOOLEAN allocation, FSP_FSCTL_FILE_INFO *info) {
  Lock lock;
  auto n = static_cast<Node *>(ctx);
  if (n != &file || size > sizeof(n->bytes))
    return STATUS_DISK_FULL;
  if (!allocation || size < n->info.FileSize) {
    if (size > n->info.FileSize)
      memset(n->bytes + n->info.FileSize, 0,
             static_cast<size_t>(size - n->info.FileSize));
    n->info.FileSize = size;
  }
  n->info.AllocationSize =
      ((allocation ? size : n->info.FileSize) + 4095) & ~UINT64(4095);
  *info = n->info;
  return STATUS_SUCCESS;
}
static NTSTATUS can_delete(FSP_FILE_SYSTEM *, PVOID ctx, PWSTR) {
  return ctx == &file ? STATUS_SUCCESS : STATUS_ACCESS_DENIED;
}
static NTSTATUS rename_file(FSP_FILE_SYSTEM *, PVOID ctx, PWSTR, PWSTR name,
                            BOOLEAN) {
  Lock lock;
  if (ctx != &file || 0 != wcscmp(name, L"\\renamed.bin"))
    return STATUS_NOT_SUPPORTED;
  wcscpy_s(filename, name);
  ++renames;
  return STATUS_SUCCESS;
}
static NTSTATUS directory(FSP_FILE_SYSTEM *, PVOID ctx, PWSTR, PWSTR marker,
                          PVOID buffer, ULONG length, PULONG count) {
  Lock lock;
  *count = 0;
  if (ctx != &root)
    return STATUS_NOT_A_DIRECTORY;
  if (file.live && (!marker || wcscmp(filename + 1, marker) > 0)) {
    alignas(8) BYTE bytes[sizeof(FSP_FSCTL_DIR_INFO) + 64]{};
    auto di = reinterpret_cast<FSP_FSCTL_DIR_INFO *>(bytes);
    auto n = wcslen(filename + 1) * sizeof(WCHAR);
    di->Size = static_cast<UINT16>(sizeof(FSP_FSCTL_DIR_INFO) + n);
    di->FileInfo = file.info;
    memcpy(di->FileNameBuf, filename + 1, n);
    if (!api.add(di, buffer, length, count))
      return STATUS_SUCCESS;
  }
  api.add(nullptr, buffer, length, count);
  return STATUS_SUCCESS;
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
int wmain(int argc, wchar_t **argv) {
  puts("WinFsp - Windows File System Proxy, Copyright (C) Bill Zissimopoulos");
  puts("https://github.com/winfsp/winfsp - internal diagnostic, not LayerFS "
       "Workspace");
  if (argc != 4) {
    fwprintf(stderr, L"usage: probe <installed-dll> <new-absolute-mount> "
                     L"<new-control-dir>\n");
    return 1;
  }
  if (!fresh_absolute(argv[2])) {
    fwprintf(stderr, L"refusing non-absolute or existing mount\n");
    return 1;
  }
  if (!fresh_absolute(argv[3]) || 0 == _wcsicmp(argv[2], argv[3])) {
    fwprintf(stderr, L"refusing invalid/existing control\n");
    return 1;
  }
  if (!CreateDirectoryW(argv[3], nullptr)) {
    fwprintf(stderr, L"refusing existing/invalid control: %lu\n",
             GetLastError());
    return 1;
  }
  api.dll = LoadLibraryExW(argv[1], nullptr,
                           LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR |
                               LOAD_LIBRARY_SEARCH_SYSTEM32);
  if (!api.dll) {
    fwprintf(stderr, L"WinFsp load failed %lu\n", GetLastError());
    return 2;
  }
#define LOAD(member, symbol)                                                   \
  api.member = reinterpret_cast<decltype(api.member)>(                         \
      GetProcAddress(api.dll, #symbol));                                       \
  if (!api.member)                                                             \
  return 2
  LOAD(create, FspFileSystemCreate);
  LOAD(destroy, FspFileSystemDelete);
  LOAD(mount, FspFileSystemSetMountPoint);
  LOAD(unmount, FspFileSystemRemoveMountPoint);
  LOAD(start, FspFileSystemStartDispatcher);
  LOAD(stop, FspFileSystemStopDispatcher);
  LOAD(add, FspFileSystemAddDirInfo);
#undef LOAD
  if (!owner_security()) {
    fwprintf(stderr, L"owner security failed %lu\n", GetLastError());
    return 1;
  }
  root.live = true;
  root.info.FileAttributes = FILE_ATTRIBUTE_DIRECTORY;
  root.info.IndexNumber = 1;
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
  callbacks.SetBasicInfo = basic;
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
  params.FlushAndPurgeOnCleanup = 1;
  wcscpy_s(params.FileSystemName, L"LayerFS-Probe");
  FSP_FILE_SYSTEM *fs = nullptr;
  NTSTATUS status =
      api.create(const_cast<PWSTR>(L"WinFsp.Disk"), &params, &callbacks, &fs);
  if (status < 0) {
    fprintf(stderr, "create NTSTATUS=%08lx\n",
            static_cast<unsigned long>(status));
    LocalFree(security);
    FreeLibrary(api.dll);
    return 1;
  }
  status = api.mount(fs, argv[2]);
  if (status >= 0)
    status = api.start(fs, 2);
  bool done = false;
  if (status >= 0) {
    WCHAR ready[32768], stop[32768];
    swprintf_s(ready, L"%s\\ready", argv[3]);
    swprintf_s(stop, L"%s\\stop", argv[3]);
    HANDLE h = CreateFileW(ready, GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                           FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h != INVALID_HANDLE_VALUE) {
      CloseHandle(h);
      puts("NATIVE_DISPATCH_READY");
      fflush(stdout);
      auto deadline = GetTickCount64() + 30000;
      while (GetTickCount64() < deadline) {
        if (GetFileAttributesW(stop) != INVALID_FILE_ATTRIBUTES) {
          done = true;
          break;
        }
        Sleep(10);
      }
    }
  } else
    fprintf(stderr, "mount/start NTSTATUS=%08lx\n",
            static_cast<unsigned long>(status));
  api.stop(fs);
  api.unmount(fs);
  api.destroy(fs);
  LocalFree(security);
  FreeLibrary(api.dll);
  printf("CALLBACKS create=%u open=%u read=%u write=%u rename=%u cleanup=%u "
         "close=%u delete=%u\n",
         creates, opens, reads, writes, renames, cleanups, closes, deletes);
  puts("NOT_RUN LayerFS_Overlay capture Save History mapped_lifecycle "
       "full_repository");
  return done && creates && reads && writes && renames && deletes ? 0 : 1;
}
