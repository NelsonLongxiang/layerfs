// Public callback conversion, setup and real module-lifetime tests.
#define NOMINMAX
#include "callbacks.hpp"
#include "mount.hpp"
#include <cstdio>
#include <memory>
#include <string>
static bool check(bool ok, const char *why) {
  if (!ok)
    fprintf(stderr, "CALLBACK_ADAPTER_TEST_FAIL %s\n", why);
  return ok;
}
int wmain(int argc, wchar_t **argv) {
  if (argc != 3)
    return 2;
  unsigned passed = 0;
  layerfs::WorkspaceStat stat{42,
                              8193,
                              0,
                              123400,
                              0644,
                              0,
                              FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_ARCHIVE};
  FSP_FSCTL_FILE_INFO info{};
  layerfs::file_info(stat, &info);
  if (!check(info.IndexNumber == 42 && info.FileSize == 8193 &&
                 info.AllocationSize == 12288 &&
                 info.FileAttributes ==
                     (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_ARCHIVE) &&
                 info.LastWriteTime == 116444736000001234ULL,
             "file identity, allocation, flags and FILETIME"))
    return 1;
  ++passed;
  stat = {1, 0, -11644473600LL, 0, 0555, 1, 0};
  layerfs::file_info(stat, &info);
  if (!check(info.FileAttributes ==
                     (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_READONLY) &&
                 info.LastWriteTime == 0,
             "directory readonly and earliest FILETIME"))
    return 1;
  ++passed;
  stat = {9, 1, INT64_MAX, 0, 0600, 0, 0};
  layerfs::file_info(stat, &info);
  if (!check(info.FileAttributes == FILE_ATTRIBUTE_NORMAL &&
                 info.LastWriteTime == 0,
             "unrepresentable time never wraps"))
    return 1;
  ++passed;
  auto module = LoadLibraryExW(argv[1], nullptr,
                               LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR |
                                   LOAD_LIBRARY_SEARCH_SYSTEM32);
  if (!module)
    return 1;
  auto provider = std::shared_ptr<void>(
      module, [](void *p) { FreeLibrary(static_cast<HMODULE>(p)); });
  layerfs::WorkspacePort port;
#define LOAD(member, symbol)                                                   \
  port.member = reinterpret_cast<decltype(port.member)>(                       \
      GetProcAddress(module, #symbol));                                        \
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
  {
    layerfs::WorkspaceCallbacks a(port, provider, {1024, 512, L"LayerFS"});
    layerfs::WorkspaceCallbacks b(port, provider, {1024, 512, L"LayerFS"});
    const auto &t = a.table();
    if (!check(a.status() == STATUS_SUCCESS && b.status() == STATUS_SUCCESS &&
                   a.win32_error() == 0 && a.context() && b.context() &&
                   a.context() != b.context() &&
                   a.callback_failure() == STATUS_SUCCESS && t.GetVolumeInfo &&
                   t.GetSecurityByName && t.Create && t.Open && t.Overwrite &&
                   t.Cleanup && t.Close && t.Read && t.Write && t.Flush &&
                   t.GetFileInfo && t.SetFileSize && t.SetBasicInfo &&
                   t.CanDelete && t.Rename && t.GetSecurity && t.ReadDirectory,
               "complete tables with independent native contexts"))
      return 1;
  }
  ++passed;
  {
    auto incomplete = port;
    incomplete.read = nullptr;
    layerfs::WorkspaceCallbacks invalid(incomplete, provider,
                                        {1024, 512, L"LayerFS"});
    layerfs::WorkspaceCallbacks no_provider(port, {}, {1024, 512, L"LayerFS"});
    layerfs::WorkspaceCallbacks bad_volume(port, provider, {1, 2, L"LayerFS"});
    layerfs::WorkspaceCallbacks bad_label(
        port, provider, {1024, 512, std::wstring(1000, L'x')});
    if (!check(invalid.status() == STATUS_INVALID_PARAMETER &&
                   !invalid.context() && !invalid.table().Open &&
                   no_provider.status() == STATUS_INVALID_PARAMETER &&
                   bad_volume.status() == STATUS_INVALID_PARAMETER &&
                   bad_label.status() == STATUS_INVALID_PARAMETER,
               "incomplete port/provider/volume refuses before native effects"))
      return 1;
  }
  ++passed;
  std::weak_ptr<void> context, weak_provider = provider;
  {
    auto adapter = std::make_unique<layerfs::WorkspaceCallbacks>(
        port, provider, layerfs::WorkspaceVolume{1024, 512, L"LayerFS"});
    context = adapter->context();
    WCHAR system[MAX_PATH]{};
    if (!GetSystemDirectoryW(system, MAX_PATH))
      return 1;
    const auto wrong = std::wstring(system) + L"\\kernel32.dll";
    const auto fresh = std::wstring(argv[2]) + L"\\unused-callback-mount";
    layerfs::WinFspMount mount;
    FSP_FSCTL_VOLUME_PARAMS params{};
    params.Version = sizeof(params);
    if (!check(mount.attach(wrong.c_str(), fresh.c_str(), params,
                            adapter->table(), 1,
                            adapter->context()) == STATUS_PROCEDURE_NOT_FOUND,
               "partial real library acquisition fails once"))
      return 1;
    adapter.reset();
    provider.reset();
    if (!check(
            !context.expired() && !weak_provider.expired() &&
                mount.facts().library_owned && !mount.facts().filesystem_owned,
            "failed native owner pins context/provider after facade release"))
      return 1;
  }
  if (!check(
          !context.expired() && !weak_provider.expired(),
          "abandoned partial owner retains original context until process end"))
    return 1;
  ++passed;
  printf("CALLBACK_ADAPTER_TEST_PASS cases=%u metadata=true setup=true "
         "per_mount_context=true retained_provider=true\n",
         passed);
  return passed == 6 ? 0 : 1;
}
