// Whole-callback admission on a real WinFsp mount with the existing provider.
#define NOMINMAX
#include "callbacks.hpp"
#include "mount.hpp"
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cwchar>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
namespace {
std::mutex mutex;
std::condition_variable changed;
bool armed = false, entered = false, released = false;
UINT64 expected = 0, expected_serial = 0;
layerfs::CallbackKind selected = layerfs::CallbackKind::Open;
void observe(const layerfs::CallbackEvent &event) noexcept {
  std::unique_lock<std::mutex> lock(mutex);
  if (!armed || event.kind != selected ||
      (selected == layerfs::CallbackKind::Open &&
       event.serial != expected_serial) ||
      (expected && event.handle != expected))
    return;
  expected = event.handle;
  entered = true;
  changed.notify_all();
  changed.wait_for(lock, std::chrono::seconds(5), [] { return released; });
}
void arm(layerfs::CallbackKind kind) {
  std::lock_guard<std::mutex> lock(mutex);
  selected = kind;
  entered = false;
  released = false;
  armed = true;
}
bool wait_entered() {
  std::unique_lock<std::mutex> lock(mutex);
  return changed.wait_for(lock, std::chrono::seconds(5),
                          [] { return entered; });
}
void release() {
  std::lock_guard<std::mutex> lock(mutex);
  armed = false;
  released = true;
  changed.notify_all();
}
struct CloseState {
  UINT64 files, directories;
  UINT32 commit, capture, retained, prepared;
};
} // namespace
int wmain(int argc, wchar_t **argv) {
  if (argc != 4)
    return 2;
  const std::wstring root = argv[3], mountpoint = root + L"\\mount",
                     file = mountpoint + L"\\many";
  auto dll = LoadLibraryExW(argv[2], nullptr,
                            LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR |
                                LOAD_LIBRARY_SEARCH_SYSTEM32);
  if (!dll)
    return 1;
  auto provider = std::shared_ptr<void>(
      dll, [](void *p) { FreeLibrary(static_cast<HMODULE>(p)); });
  layerfs::WorkspacePort port;
#define LOAD(member, symbol)                                                   \
  port.member =                                                                \
      reinterpret_cast<decltype(port.member)>(GetProcAddress(dll, #symbol));   \
  if (!port.member)                                                            \
  return 1
  LOAD(stat, lf_stat);
  LOAD(open, lf_open);
  LOAD(info, lf_info);
  LOAD(create, lf_create);
  LOAD(read, lf_read);
  LOAD(write, lf_write);
  LOAD(resize, lf_resize);
  LOAD(overwrite, lf_overwrite);
  LOAD(basic_info, lf_basic_info);
  LOAD(rename, lf_rename);
  LOAD(can_delete, lf_can_delete);
  LOAD(dot, lf_dot);
  LOAD(unlink, lf_unlink);
  LOAD(close, lf_close);
  LOAD(next, lf_next);
  LOAD(cleanup, lf_cleanup);
#undef LOAD
  auto start = reinterpret_cast<INT32(__cdecl *)(PCWSTR, UINT32)>(
      GetProcAddress(dll, "lf_start"));
  auto prepare = reinterpret_cast<INT32(__cdecl *)()>(
      GetProcAddress(dll, "lf_prepare_close"));
  auto finish =
      reinterpret_cast<INT32(__cdecl *)()>(GetProcAddress(dll, "lf_finish"));
  auto state = reinterpret_cast<INT32(__cdecl *)(CloseState *)>(
      GetProcAddress(dll, "lf_close_state"));
  if (!start || !prepare || !finish || !state ||
      start(root.c_str(), static_cast<UINT32>(root.size())) < 0)
    return 1;
  layerfs::WorkspaceStat stat{};
  if (port.stat(L"\\", 1, &stat) < 0)
    return 1;
  layerfs::WorkspaceCallbacks adapter(
      port, provider, {1ULL << 30, 1ULL << 30, L"LayerFS admission"}, observe);
  if (adapter.status() < 0)
    return 1;
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
  wcscpy_s(params.FileSystemName, L"LayerFS");
  layerfs::WinFspMount mount;
  if (mount.attach(argv[1], mountpoint.c_str(), params, adapter.table(),
                   stat.serial, adapter.context()) < 0)
    return 1;
  layerfs::WorkspaceStat target{};
  if (port.stat(L"\\many", 5, &target) < 0)
    return 1;
  expected_serial = target.serial;
  arm(layerfs::CallbackKind::Open);
  HANDLE held = INVALID_HANDLE_VALUE;
  std::thread opener([&] {
    held = CreateFileW(file.c_str(), FILE_READ_ATTRIBUTES,
                       FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                       nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS,
                       nullptr);
  });
  const bool open_seen = wait_entered();
  const auto busy =
      open_seen ? adapter.try_stop_callbacks() : STATUS_UNSUCCESSFUL;
  release();
  opener.join();
  if (!open_seen || busy != STATUS_DEVICE_BUSY ||
      held == INVALID_HANDLE_VALUE) {
    fprintf(stderr, "CALLBACK_GATE_FAIL open admission\n");
    return 1;
  }
  if (adapter.try_stop_callbacks() != STATUS_SUCCESS)
    return 1;
  arm(layerfs::CallbackKind::Close);
  std::thread closer([&] { CloseHandle(held); });
  const bool close_seen = wait_entered();
  const bool whole_close_active = !adapter.callbacks_idle();
  const auto resumed =
      close_seen ? adapter.resume_callbacks() : STATUS_UNSUCCESSFUL;
  release();
  closer.join();
  if (!close_seen || !whole_close_active || adapter.callbacks_idle() ||
      resumed != STATUS_SUCCESS || adapter.callback_failure() < 0) {
    fprintf(stderr,
            "CALLBACK_GATE_FAIL release callback resume seen=%u status=%08lx "
            "failure=%08lx\n",
            close_seen, static_cast<ULONG>(resumed),
            static_cast<ULONG>(adapter.callback_failure()));
    return 1;
  }
  CloseState after{};
  if (state(&after) < 0 || after.files || after.directories || after.retained)
    return 1;
  if (prepare() < 0 || mount.stop() < 0 || mount.detach() < 0 || finish() < 0 ||
      mount.release_library() < 0)
    return 1;
  puts("CALLBACK_GATE_PASS cases=2 whole_callback_busy=true "
       "release_during_fence=true resume_while_close_active=true "
       "normal_close=true");
  return 0;
}
