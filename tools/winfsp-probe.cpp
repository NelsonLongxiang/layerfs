// Native WinFsp -> Rust Workspace/Overlay diagnostic. Build: winfsp-build.ps1.
// winfsp-probe.exe <installed-WinFsp-dll> <new-mount> <new-control>
// <Rust-bridge-dll>
#define NOMINMAX
#include "callbacks.hpp"
#include "mount.hpp"
#include <atomic>
#include <cstdio>
#include <cstring>
#include <cwchar>
#include <string>
#include <thread>
#include <winfsp/winfsp.h>
static layerfs::WinFspMount native_mount;

using Stat = layerfs::WorkspaceStat;
struct CloseState {
  UINT64 files, directories;
  UINT32 pending_commit, capture, retained, prepared;
};
static_assert(sizeof(CloseState) == 32, "Rust ABI CloseState size");
struct Bridge : layerfs::WorkspacePort {
  HMODULE dll = nullptr;
  INT32(__cdecl *start)(PCWSTR, UINT32) = nullptr;
  INT32(__cdecl *reopen)(PCWSTR, UINT32, PCWSTR, UINT32) = nullptr;
  INT32(__cdecl *bind_stdin)(PCWSTR, UINT32, PCWSTR, UINT32) = nullptr;
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
  INT32(__cdecl *coordinate_begin)(UINT64 *) = nullptr;
  INT32(__cdecl *coordinate_next)
  (UINT64, UINT64, UINT64 *, UINT64 *, PWSTR, UINT32, UINT32 *) = nullptr;
  INT32(__cdecl *coordinate_end)(UINT64, UINT32) = nullptr;
  INT32(__cdecl *finish)() = nullptr;
} bridge;
static volatile LONG creates = 0, opens = 0, reads = 0, writes = 0, renames = 0,
                     cleanups = 0, closes = 0, deletes = 0, callback_error = 0;
static volatile LONG ordinary_writes = 0, constrained_writes = 0;
static volatile LONG active_close_callbacks = 0;
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
static void callback_event(const layerfs::CallbackEvent &e) noexcept {
  using K = layerfs::CallbackKind;
  switch (e.kind) {
  case K::Open:
    InterlockedIncrement(&opens);
    trace_handle("open", e.handle, e.serial, e.flags, e.name);
    break;
  case K::Create:
    InterlockedIncrement(&creates);
    trace_handle("create", e.handle, e.serial, e.flags, e.name);
    break;
  case K::Cleanup:
    InterlockedIncrement(&cleanups);
    trace_handle("cleanup", e.handle, e.serial, e.flags, e.name);
    if (cache_mode) {
      printf("CACHE_CLEANUP handle=%llu flags=%lu closes=%ld\n", e.handle,
             e.flags, closes);
      fflush(stdout);
    }
    break;
  case K::CloseBegin:
    InterlockedIncrement(&active_close_callbacks);
    break;
  case K::Close:
    InterlockedIncrement(&closes);
    trace_handle("close", e.handle, e.serial, static_cast<ULONG>(e.status));
    if (cache_mode) {
      printf("CACHE_CLOSE handle=%llu cleanup=%ld\n", e.handle, cleanups);
      fflush(stdout);
    }
    InterlockedDecrement(&active_close_callbacks);
    break;
  case K::Read:
    InterlockedIncrement(&reads);
    break;
  case K::Write:
    InterlockedIncrement(&writes);
    InterlockedIncrement(e.flags & 2 ? &constrained_writes : &ordinary_writes);
    if (cache_mode) {
      printf("CACHE_WRITE constrained=%u append=%u offset=%llu requested=%lu "
             "done=%lu handle=%llu\n",
             !!(e.flags & 2), !!(e.flags & 1), e.offset, e.length,
             e.transferred, e.handle);
      fflush(stdout);
    }
    break;
  case K::Rename:
    InterlockedIncrement(&renames);
    break;
  case K::Delete:
    InterlockedIncrement(&deletes);
    break;
  case K::Failure:
    InterlockedExchange(&callback_error, 1);
    fprintf(stderr, "NATIVE_CALLBACK_FAILED handle=%llu status=%08lx\n",
            e.handle, static_cast<ULONG>(e.status));
    break;
  }
}

static UINT32 length(PCWSTR text) {
  return text ? static_cast<UINT32>(wcslen(text)) : 0;
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
// One explicit request, streamed by original token. No Session mutex is held
// across a filesystem call, and no Rust descriptor is released here.
static NTSTATUS coordinate_close(PCWSTR mount) {
  UINT64 token = 0;
  auto status = bridge.coordinate_begin(&token);
  printf("CLOSE_COORDINATE_BEGIN token=%llu status=%08lx\n", token,
         static_cast<ULONG>(status));
  fflush(stdout);
  if (status < 0)
    return status;
  const auto deadline = GetTickCount64() + 10000;
  auto abort = [&](NTSTATUS reason) {
    auto end = bridge.coordinate_end(token, 0);
    printf("CLOSE_COORDINATE_ABORT token=%llu status=%08lx "
           "admission_restored=%s\n",
           token, static_cast<ULONG>(reason), end >= 0 ? "true" : "false");
    fflush(stdout);
    return end < 0 ? end : reason;
  };
  UINT64 after = 0;
  for (;;) {
    WCHAR name[32768]{};
    UINT64 held = 0, serial = 0;
    UINT32 count = 0;
    status = bridge.coordinate_next(token, after, &held, &serial, name, 32768,
                                    &count);
    if (status < 0)
      return abort(status);
    if (!count)
      break;
    if (GetTickCount64() >= deadline)
      return abort(STATUS_DEVICE_BUSY);
    std::wstring full = mount;
    for (UINT32 i = 0; i < count; ++i)
      full += name[i] == L'/' ? L'\\' : name[i];
    if (full.size() >= 32768)
      return abort(STATUS_DEVICE_BUSY);
    HANDLE file = CreateFileW(
        full.c_str(), GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
        OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
      printf("CLOSE_COORDINATE_OPEN_REFUSED original=%llu win32=%lu\n", held,
             GetLastError());
      return abort(STATUS_DEVICE_BUSY);
    }
    BY_HANDLE_FILE_INFORMATION info{};
    bool matched =
        GetFileInformationByHandle(file, &info) != FALSE &&
        info.dwVolumeSerialNumber == 0x4c465350 &&
        ((UINT64(info.nFileIndexHigh) << 32) | info.nFileIndexLow) == serial &&
        !(info.dwFileAttributes &
          (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT));
    BYTE byte = 0;
    DWORD got = 0;
    bool read = matched && ReadFile(file, &byte, 1, &got, nullptr) != FALSE;
    bool closed = CloseHandle(file) != FALSE;
    printf("CLOSE_COORDINATE_VISIT token=%llu original=%llu serial=%llu "
           "identity=%s read=%s closed=%s\n",
           token, held, serial, matched ? "true" : "false",
           read ? "true" : "false", closed ? "true" : "false");
    fflush(stdout);
    if (!matched || !read || !closed)
      return abort(STATUS_DEVICE_BUSY);
    after = held;
  }
  for (;;) {
    CloseState state{};
    status = bridge.close_state(&state);
    if (status < 0)
      return abort(status);
    if (!state.files && !state.directories &&
        InterlockedCompareExchange(&active_close_callbacks, 0, 0) == 0)
      break;
    if (GetTickCount64() >= deadline)
      return abort(STATUS_DEVICE_BUSY);
    Sleep(
        5); // Readiness only. No candidate is reopened or retried in this loop.
  }
  CloseState observed{};
  if (bridge.close_state(&observed) < 0)
    return abort(STATUS_DEVICE_BUSY);
  printf(
      "NORMAL_CLOSE_OBSERVED files=%llu directories=%llu commit=%u capture=%u "
      "retained=%u prepared=%u cleanup=%ld close=%ld\n",
      observed.files, observed.directories, observed.pending_commit,
      observed.capture, observed.retained, observed.prepared, cleanups, closes);
  fflush(stdout);
  status = bridge.coordinate_end(token, 1);
  printf(
      "CLOSE_COORDINATE_END token=%llu status=%08lx real_close_receipts=true\n",
      token, static_cast<ULONG>(status));
  fflush(stdout);
  return status;
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
  bridge.dll = LoadLibraryExW(argv[4], nullptr,
                              LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR |
                                  LOAD_LIBRARY_SEARCH_SYSTEM32);
  if (!bridge.dll) {
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
  LOAD(bridge, cleanup, lf_cleanup);
  LOAD(bridge, coordinate_begin, lf_coordinate_begin);
  LOAD(bridge, coordinate_next, lf_coordinate_next);
  LOAD(bridge, coordinate_end, lf_coordinate_end);
  LOAD(bridge, finish, lf_finish);
#undef LOAD
  WCHAR store[32768];
  swprintf_s(store, L"%s\\store", argv[3]);
  cache_mode = argc == 6 && wcscmp(argv[5], L"--cache-boundary") == 0;
  const bool concurrent_mode =
      argc == 6 && wcscmp(argv[5], L"--concurrent") == 0;
  const bool close_mode =
      argc == 6 && wcscmp(argv[5], L"--close-boundary") == 0;
  const bool wrong_root = argc == 6 && wcscmp(argv[5], L"--root-mismatch") == 0;
  const bool rebound = argc == 6 && !cache_mode && !concurrent_mode &&
                       !close_mode && !wrong_root;
  auto started =
      binding_mode
          ? bridge.bind_stdin(argv[6], length(argv[6]), store, length(store))
          : (rebound
                 ? bridge.reopen(argv[5], length(argv[5]), store, length(store))
                 : bridge.start(store, length(store)));
  if (started < 0)
    return 1;
  Stat root{};
  if (bridge.stat(L"\\", 1, &root) < 0)
    return 1;
  // Pin the provider module independently of the control bridge handle. The
  // product native mount keeps this callback context after partial startup.
  HMODULE provider = nullptr;
  if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
                          reinterpret_cast<PCWSTR>(bridge.stat), &provider))
    return 1;
  auto provider_owner = std::shared_ptr<void>(provider, [](void *module) {
    FreeLibrary(static_cast<HMODULE>(module));
  });
  auto adapter = std::make_unique<layerfs::WorkspaceCallbacks>(
      bridge, provider_owner,
      layerfs::WorkspaceVolume{1024ULL * 1024 * 1024, 1024ULL * 1024 * 1024,
                               L"LayerFS Overlay probe"},
      callback_event);
  std::weak_ptr<void> provider_weak = provider_owner;
  std::weak_ptr<void> context_weak = adapter->context();
  if (adapter->status() < 0) {
    fprintf(stderr, "NATIVE_CALLBACK_SETUP_FAILED status=%08lx win32=%lu\n",
            static_cast<ULONG>(adapter->status()), adapter->win32_error());
    return 1;
  }
  const auto callbacks = adapter->table();
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
  NTSTATUS status = native_mount.attach(argv[1], argv[2], params, callbacks,
                                        root.serial + (wrong_root ? 1 : 0),
                                        adapter->context());
  // Only the actual retained native owner now pins the callback/provider.
  adapter.reset();
  provider_owner.reset();
  if (context_weak.expired() || provider_weak.expired())
    return 1;
  puts("NATIVE_CALLBACK_CONTEXT_PINNED adapter_released=true "
       "provider_reference_released=true");
  if (status < 0) {
    const auto error = native_mount.failure();
    const auto facts = native_mount.facts();
    fprintf(stderr,
            "NATIVE_MOUNT_FAILED step=%s status=%08lx win32=%lu phase=%u "
            "filesystem_owned=%u library_owned=%u probe_owned=%u\n",
            error.step, static_cast<ULONG>(error.status), error.win32,
            static_cast<unsigned>(facts.phase), facts.filesystem_owned,
            facts.library_owned, facts.probe_owned);
    return 1;
  }
  if (native_mount.facts().phase != layerfs::MountPhase::RootServed ||
      native_mount.detach() != STATUS_INVALID_DEVICE_STATE ||
      native_mount.release_library() != STATUS_INVALID_DEVICE_STATE ||
      native_mount.attach(argv[1], argv[2], params, callbacks, root.serial) !=
          STATUS_INVALID_DEVICE_STATE ||
      native_mount.failure().step)
    return 1;
  printf("NATIVE_MOUNT_ROOT_SERVED serial=%llu volume=%08lx owned=true\n",
         root.serial, params.VolumeSerialNumber);
  fflush(stdout);
  bool done = false, captured = false, checked = false;
  bool committed1 = false, committed2 = false, unchanged = false;
  unsigned cache_phase = 0;
  unsigned close_phase = 0;
  unsigned binding_commits = 0;
  bool close_prepared = false, close_checked = false, idle_reported = false;
  bool coordinate_second_checked = false;
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
      if (!close_prepared && exists(argv[3], L"stop-coordinate")) {
        // Consume each explicit request once, before its potentially blocking
        // work. The external controller uses a distinct second request only
        // after release.
        if (!close_checked) {
          close_checked = true;
          auto admission = coordinate_close(argv[2]);
          if (admission == STATUS_DEVICE_BUSY) {
            puts("NORMAL_CLOSE_REFUSED request=coordinate service_kept=true");
            fflush(stdout);
            if (!mark(argv[3], L"coordinate-refused"))
              break;
          } else if (admission < 0) {
            break;
          } else {
            close_prepared = true;
            done = true;
            break;
          }
        } else if (!coordinate_second_checked &&
                   exists(argv[3], L"stop-coordinate-after-release")) {
          coordinate_second_checked = true;
          auto admission = coordinate_close(argv[2]);
          if (admission == STATUS_DEVICE_BUSY) {
            puts("NORMAL_CLOSE_REFUSED request=coordinate-after-release "
                 "service_kept=true");
            fflush(stdout);
            if (!mark(argv[3], L"coordinate-after-release-refused"))
              break;
          } else if (admission < 0) {
            fprintf(stderr, "normal coordinated close second request=%08lx\n",
                    static_cast<ULONG>(admission));
            break;
          } else {
            close_prepared = true;
            done = true;
            break;
          }
        }
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
  if (!close_prepared || callback_error) {
    fprintf(stderr,
            "DIAGNOSTIC_EXIT_NOT_NORMAL no_successful_close_admission=true\n");
    // No claim of graceful unmount on an error/timeout. The isolated test
    // process exits; normal code must retain custody rather than guess a
    // reversible stop.
    return 1;
  }
  puts("NORMAL_CLOSE_STOP_BEGIN prepared=true");
  fflush(stdout);
  if (native_mount.stop() < 0) {
    const auto error = native_mount.failure();
    fprintf(stderr, "NATIVE_MOUNT_STOP_FAILED step=%s status=%08lx\n",
            error.step ? error.step : "state",
            static_cast<ULONG>(error.status));
    return 1;
  }
  printf("NATIVE_MOUNT_DISPATCHER_STOPPED result=%08lx explicit_stop=true\n",
         static_cast<ULONG>(native_mount.facts().dispatcher_exit));
  if (native_mount.facts().phase != layerfs::MountPhase::Stopped ||
      native_mount.stop() != STATUS_INVALID_DEVICE_STATE)
    return 1;
  puts("NORMAL_CLOSE_DISPATCHER_DRAINED");
  fflush(stdout); // Keep the completed native drain before Rust finish in the
                  // receipt.
  if (native_mount.detach() < 0)
    return 1;
  if (native_mount.facts().phase != layerfs::MountPhase::Detached ||
      native_mount.facts().filesystem_owned ||
      native_mount.detach() != STATUS_INVALID_DEVICE_STATE)
    return 1;
  puts("NATIVE_MOUNT_DETACHED filesystem_destroyed=true");
  fflush(stdout);
  auto closed = bridge.finish();
  if (closed == 0)
    puts("NORMAL_CLOSE_DONE detach=true overlay_closed=true");
  printf("CALLBACKS create=%ld open=%ld read=%ld write=%ld rename=%ld "
         "cleanup=%ld close=%ld delete=%ld errors=%ld\n",
         creates, opens, reads, writes, renames, cleanups, closes, deletes,
         callback_error);
  if (closed == 0) {
    FreeLibrary(bridge.dll);
    if (native_mount.release_library() < 0 ||
        native_mount.facts().phase != layerfs::MountPhase::Closed ||
        native_mount.facts().library_owned ||
        native_mount.release_library() != STATUS_INVALID_DEVICE_STATE)
      return 1;
    if (!context_weak.expired() || !provider_weak.expired())
      return 1;
    puts("NATIVE_CALLBACK_CONTEXT_RELEASED "
         "after_native_drain_and_logical_close=true");
    puts("NATIVE_MOUNT_OWNER_PASS root_served=true stopped=true detached=true "
         "library_closed=true one_attempt=true");
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
