// Concrete WinFsp owner. Destruction never guesses a detach or retries a
// failure.
#define NOMINMAX
#include "mount.hpp"
#include <cwchar>
#include <string>

namespace layerfs {
struct WinFspMount::State {
  MountPhase phase = MountPhase::Empty;
  bool attempted = false;
  NTSTATUS dispatcher_exit = STATUS_SUCCESS;
  MountFailure failure{nullptr, STATUS_SUCCESS, 0};
  HMODULE library = nullptr;
  FSP_FILE_SYSTEM *filesystem = nullptr;
  HANDLE probe = INVALID_HANDLE_VALUE;
  std::wstring directory;
  FSP_FILE_SYSTEM_INTERFACE callbacks{};
  std::shared_ptr<void> context;
  FSP_FSCTL_VOLUME_PARAMS params{};
  decltype(&FspFileSystemCreate) create = nullptr;
  decltype(&FspFileSystemDelete) destroy = nullptr;
  decltype(&FspFileSystemSetMountPointEx) mount = nullptr;
  decltype(&FspFileSystemRemoveMountPoint) unmount = nullptr;
  decltype(&FspFileSystemStartDispatcher) start = nullptr;
  decltype(&FspFileSystemStopDispatcher) stop = nullptr;
  decltype(&FspFileSystemAddDirInfo) add = nullptr;
  decltype(&FspFileSystemGetDispatcherResultF) dispatcher_result = nullptr;
};
WinFspMount::WinFspMount() : state_(std::make_unique<State>()) {}
WinFspMount::~WinFspMount() {
  // Keep the callback table, original error, DLL and filesystem together if a
  // caller abandons an incomplete owner. No cleanup is implied by C++ scope.
  if (state_->library || state_->filesystem ||
      state_->probe != INVALID_HANDLE_VALUE)
    static_cast<void>(state_.release());
}
NTSTATUS WinFspMount::fail(const char *step, NTSTATUS status, DWORD win32) {
  if (!state_->failure.step)
    state_->failure = {step, status, win32};
  return status;
}
MountFacts WinFspMount::facts() const {
  return {state_->phase,
          state_->attempted,
          state_->library != nullptr,
          state_->filesystem != nullptr,
          state_->probe != INVALID_HANDLE_VALUE,
          state_->dispatcher_exit};
}
MountFailure WinFspMount::failure() const { return state_->failure; }
static bool absolute(PCWSTR path) {
  if (!path)
    return false;
  const auto length = wcslen(path);
  return length >= 4 && length < 32760 &&
         ((path[0] >= L'A' && path[0] <= L'Z') ||
          (path[0] >= L'a' && path[0] <= L'z')) &&
         path[1] == L':' && (path[2] == L'/' || path[2] == L'\\');
}
NTSTATUS WinFspMount::attach(PCWSTR library, PCWSTR directory,
                             const FSP_FSCTL_VOLUME_PARAMS &params,
                             const FSP_FILE_SYSTEM_INTERFACE &callbacks,
                             UINT64 root_serial, std::shared_ptr<void> context,
                             PSECURITY_DESCRIPTOR mount_security) {
  auto &s = *state_;
  if (s.attempted)
    return STATUS_INVALID_DEVICE_STATE;
  s.attempted = true;
  if (!absolute(library) || !absolute(directory) || root_serial == 0)
    return fail("input", STATUS_INVALID_PARAMETER);
  // Never mount over an existing path, including a directory or dangling link.
  if (GetFileAttributesW(directory) != INVALID_FILE_ATTRIBUTES)
    return fail("directory", STATUS_OBJECT_NAME_COLLISION);
  auto error = GetLastError();
  if (error != ERROR_FILE_NOT_FOUND)
    return fail("directory", STATUS_OBJECT_PATH_NOT_FOUND, error);
  s.directory = directory;
  s.callbacks = callbacks;
  s.context = std::move(context);
  s.params = params;
  s.library = LoadLibraryExW(library, nullptr,
                             LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR |
                                 LOAD_LIBRARY_SEARCH_SYSTEM32);
  if (!s.library)
    return fail("library", STATUS_DLL_NOT_FOUND, GetLastError());
  s.phase = MountPhase::Loaded;
#define LFS_LOAD(member, symbol)                                               \
  s.member = reinterpret_cast<decltype(s.member)>(                             \
      GetProcAddress(s.library, #symbol));                                     \
  if (!s.member)                                                               \
  return fail(#symbol, STATUS_PROCEDURE_NOT_FOUND, GetLastError())
  LFS_LOAD(create, FspFileSystemCreate);
  LFS_LOAD(destroy, FspFileSystemDelete);
  LFS_LOAD(mount, FspFileSystemSetMountPointEx);
  LFS_LOAD(unmount, FspFileSystemRemoveMountPoint);
  LFS_LOAD(start, FspFileSystemStartDispatcher);
  LFS_LOAD(stop, FspFileSystemStopDispatcher);
  LFS_LOAD(add, FspFileSystemAddDirInfo);
  LFS_LOAD(dispatcher_result, FspFileSystemGetDispatcherResultF);
#undef LFS_LOAD
  auto status = s.create(const_cast<PWSTR>(L"WinFsp.Disk"), &s.params,
                         &s.callbacks, &s.filesystem);
  if (status < 0)
    return fail("create", status);
  s.filesystem->UserContext = &s;
  s.phase = MountPhase::Created;
  status = s.mount(s.filesystem, s.directory.data(), mount_security);
  if (status < 0)
    return fail("mount", status);
  s.phase = MountPhase::Mounted;
  status = s.start(s.filesystem, 2);
  if (status < 0)
    return fail("dispatcher", status);
  s.phase = MountPhase::Dispatching;
  // A successful start/spawn is not proof of service. This ordinary kernel
  // request must return the bound root identity from the mounted filesystem.
  s.probe =
      CreateFileW(s.directory.c_str(), FILE_READ_ATTRIBUTES,
                  FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                  nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
  if (s.probe == INVALID_HANDLE_VALUE)
    return fail("root-open", STATUS_UNSUCCESSFUL, GetLastError());
  BY_HANDLE_FILE_INFORMATION info{};
  if (!GetFileInformationByHandle(s.probe, &info))
    return fail("root-info", STATUS_UNSUCCESSFUL, GetLastError());
  const auto serial =
      (static_cast<UINT64>(info.nFileIndexHigh) << 32) | info.nFileIndexLow;
  if (!CloseHandle(s.probe))
    return fail("root-close", STATUS_UNSUCCESSFUL, GetLastError());
  s.probe = INVALID_HANDLE_VALUE;
  if (!(info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) ||
      info.dwVolumeSerialNumber != params.VolumeSerialNumber ||
      serial != root_serial)
    return fail("root-identity", STATUS_INVALID_PARAMETER);
  s.phase = MountPhase::RootServed;
  return STATUS_SUCCESS;
}
void *WinFspMount::callback_context(FSP_FILE_SYSTEM *fs) {
  return static_cast<State *>(fs->UserContext)->context.get();
}
BOOLEAN WinFspMount::add_dir_info(FSP_FILE_SYSTEM *fs, FSP_FSCTL_DIR_INFO *info,
                                  PVOID buffer, ULONG capacity,
                                  PULONG transferred) {
  auto &s = *static_cast<State *>(fs->UserContext);
  return s.add(info, buffer, capacity, transferred);
}
BOOLEAN WinFspMount::add_dir_info(FSP_FSCTL_DIR_INFO *info, PVOID buffer,
                                  ULONG capacity, PULONG transferred) const {
  if (!state_->library || !state_->filesystem || !state_->add)
    return FALSE;
  return state_->add(info, buffer, capacity, transferred);
}
NTSTATUS WinFspMount::stop() {
  auto &s = *state_;
  if (s.failure.step || s.phase != MountPhase::RootServed)
    return STATUS_INVALID_DEVICE_STATE;
  NTSTATUS before = STATUS_SUCCESS;
  s.dispatcher_result(s.filesystem, &before);
  if (before < 0)
    return fail("dispatcher-before-stop", before);
  s.stop(s.filesystem);
  s.phase = MountPhase::Stopped;
  s.dispatcher_result(s.filesystem, &s.dispatcher_exit);
  // WinFsp STOP0 ends receive with CANCELLED, then StopDispatcher joins it.
  // Only this explicit, previously healthy stop accepts that raw exit code.
  return s.dispatcher_exit >= 0 || s.dispatcher_exit == STATUS_CANCELLED
             ? STATUS_SUCCESS
             : fail("dispatcher-stop", s.dispatcher_exit);
}
NTSTATUS WinFspMount::detach() {
  auto &s = *state_;
  if (s.failure.step || s.phase != MountPhase::Stopped ||
      s.probe != INVALID_HANDLE_VALUE)
    return STATUS_INVALID_DEVICE_STATE;
  s.unmount(s.filesystem);
  s.destroy(s.filesystem);
  s.filesystem = nullptr;
  s.phase = MountPhase::Detached;
  return STATUS_SUCCESS;
}
NTSTATUS WinFspMount::release_library() {
  auto &s = *state_;
  if (s.failure.step || s.phase != MountPhase::Detached)
    return STATUS_INVALID_DEVICE_STATE;
  if (!FreeLibrary(s.library))
    return fail("library-close", STATUS_UNSUCCESSFUL, GetLastError());
  s.library = nullptr;
  s.context.reset();
  s.phase = MountPhase::Closed;
  return STATUS_SUCCESS;
}
} // namespace layerfs
