// Direct public WinFspMount lifecycle tests; no product test hooks or driver
// mocks.
#define NOMINMAX
#include "mount.hpp"
#include <cstdio>
#include <cstring>
#include <string>

static bool check(bool value, const char *message) {
  if (!value)
    fprintf(stderr, "MOUNT_OWNER_TEST_FAIL %s\n", message);
  return value;
}
int wmain(int argc, wchar_t **argv) {
  if (argc != 3)
    return 2;
  FSP_FSCTL_VOLUME_PARAMS params{};
  params.Version = sizeof(params);
  FSP_FILE_SYSTEM_INTERFACE callbacks{};
  const std::wstring fresh = std::wstring(argv[2]) + L"\\unused-mount";
  unsigned passed = 0;
  {
    layerfs::WinFspMount owner;
    const auto before = owner.facts();
    if (!check(!before.attempted && !before.library_owned &&
                   !before.filesystem_owned &&
                   before.phase == layerfs::MountPhase::Empty,
               "new owner has no effects") ||
        !check(owner.invalidate_clean_file(L"/alpha.txt", 10) ==
                       STATUS_INVALID_DEVICE_STATE &&
                   owner.stop() == STATUS_INVALID_DEVICE_STATE &&
                   owner.detach() == STATUS_INVALID_DEVICE_STATE &&
                   owner.release_library() == STATUS_INVALID_DEVICE_STATE,
               "out of order terminal operations refused") ||
        !check(!owner.add_dir_info(nullptr, nullptr, 0, nullptr),
               "inactive callback helper refuses without a native call"))
      return 1;
    ++passed;
  }
  {
    layerfs::WinFspMount owner;
    if (!check(owner.attach(argv[1], L"relative", params, callbacks, 1) ==
                   STATUS_INVALID_PARAMETER,
               "relative mount refused"))
      return 1;
    const auto error = owner.failure();
    if (!check(error.step && 0 == strcmp(error.step, "input") &&
                   !owner.facts().library_owned,
               "input failure has no DLL effect") ||
        !check(owner.attach(argv[1], fresh.c_str(), params, callbacks, 1) ==
                   STATUS_INVALID_DEVICE_STATE,
               "original failed attach never replayed") ||
        !check(owner.failure().step == error.step &&
                   owner.failure().status == error.status,
               "original cause unchanged"))
      return 1;
    ++passed;
  }
  {
    layerfs::WinFspMount owner;
    if (!check(owner.attach(argv[1], argv[2], params, callbacks, 1) ==
                   STATUS_OBJECT_NAME_COLLISION,
               "existing directory refused") ||
        !check(!owner.facts().library_owned && !owner.facts().filesystem_owned,
               "existing path refusal before native acquisition"))
      return 1;
    ++passed;
  }
  {
    layerfs::WinFspMount owner;
    if (!check(owner.attach(L"relative.dll", fresh.c_str(), params, callbacks,
                            1) == STATUS_INVALID_PARAMETER,
               "relative library refused") ||
        !check(owner.facts().phase == layerfs::MountPhase::Empty,
               "relative library has no load effect"))
      return 1;
    ++passed;
  }
  {
    layerfs::WinFspMount owner;
    const auto absent = std::wstring(argv[2]) + L"\\missing.dll";
    if (!check(owner.attach(absent.c_str(), fresh.c_str(), params, callbacks,
                            1) == STATUS_DLL_NOT_FOUND,
               "absent library original failure") ||
        !check(owner.failure().win32 != 0 && !owner.facts().library_owned &&
                   !owner.facts().filesystem_owned,
               "absent library has exact Win32 error and no native owner"))
      return 1;
    ++passed;
  }
  {
    WCHAR system[MAX_PATH]{};
    if (!GetSystemDirectoryW(system, MAX_PATH))
      return 1;
    const auto wrong = std::wstring(system) + L"\\kernel32.dll";
    layerfs::WinFspMount owner;
    if (!check(owner.attach(wrong.c_str(), fresh.c_str(), params, callbacks,
                            1) == STATUS_PROCEDURE_NOT_FOUND,
               "non-WinFsp library export refusal") ||
        !check(owner.facts().phase == layerfs::MountPhase::Loaded &&
                   owner.facts().library_owned &&
                   !owner.facts().filesystem_owned,
               "exact loaded DLL retained without invented filesystem") ||
        !check(owner.invalidate_clean_file(L"/alpha.txt", 10) ==
                       STATUS_INVALID_DEVICE_STATE &&
                   owner.stop() == STATUS_INVALID_DEVICE_STATE &&
                   owner.detach() == STATUS_INVALID_DEVICE_STATE &&
                   owner.release_library() == STATUS_INVALID_DEVICE_STATE,
               "failed partial attach is not guessed cleanup"))
      return 1;
    ++passed;
  }
  if (!check(GetFileAttributesW(fresh.c_str()) == INVALID_FILE_ATTRIBUTES,
             "test never produced a mount"))
    return 1;
  printf("MOUNT_OWNER_TEST_PASS cases=%u native_mounts=0 "
         "original_failure_retained=true\n",
         passed);
  return passed == 6 ? 0 : 1;
}
