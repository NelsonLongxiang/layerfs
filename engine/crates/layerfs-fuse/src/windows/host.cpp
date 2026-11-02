// Product native companion. All Workspace state lives in its Rust parent
// Session.
#define NOMINMAX
#include "callbacks.hpp"
#include "mount.hpp"
#include "stdio_port.hpp"
#include <cwchar>
#include <memory>
namespace {
layerfs::Bytes status_body(NTSTATUS s, NTSTATUS exit = STATUS_SUCCESS) {
  layerfs::Bytes b;
  for (auto n : {s, exit})
    for (int i = 0; i < 4; ++i)
      b.push_back(static_cast<BYTE>(static_cast<UINT32>(n) >> (i * 8)));
  return b;
}
} // namespace
int wmain(int argc, wchar_t **argv) {
  if (argc != 5 && argc != 6)
    return 2;
  wchar_t *end = nullptr;
  const auto root = wcstoull(argv[3], &end, 10);
  if (!root || !end || *end)
    return 2;
  auto channel = std::make_shared<layerfs::StdioPort>();
  channel->start();
  ULARGE_INTEGER available{}, total{}, free{};
  if (!GetDiskFreeSpaceExW(argv[4], &available, &total, &free))
    return 1;
  layerfs::WorkspaceCallbacks adapter(
      channel->port(), channel,
      {total.QuadPart, available.QuadPart, L"LayerFS"}, nullptr,
      argc == 6 ? argv[5] : nullptr);
  if (adapter.status() < 0) {
    channel->event(104, status_body(adapter.status()));
    return 1;
  }
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
  auto result = mount.attach(argv[1], argv[2], params, adapter.table(), root,
                             adapter.context(), adapter.mount_security());
  if (result < 0) {
    channel->event(104, status_body(result));
    return 1;
  }
  layerfs::Bytes ready;
  for (int i = 0; i < 8; ++i)
    ready.push_back(static_cast<BYTE>(root >> (i * 8)));
  if (!channel->event(101, ready))
    return 1;
  while (channel->wait_stop()) {
    if (adapter.callback_failure() < 0) {
      channel->event(104, status_body(adapter.callback_failure()));
      return 1;
    }
    result = adapter.try_stop_callbacks();
    if (result < 0) {
      if (result == STATUS_DEVICE_BUSY) {
        channel->event(102, status_body(result));
        continue;
      }
      channel->event(104, status_body(result));
      return 1;
    }
    result = channel->control(20);
    if (result < 0) {
      if (result == STATUS_DEVICE_BUSY ||
          result == static_cast<NTSTATUS>(0xe0f50001)) {
        if (adapter.resume_callbacks() < 0)
          return 1;
        channel->event(102, status_body(result));
        continue;
      }
      channel->event(104, status_body(result));
      return 1;
    }
    result = mount.stop();
    if (result < 0) {
      channel->event(104, status_body(result));
      return 1;
    }
    const auto raw = mount.facts().dispatcher_exit;
    result = mount.detach();
    if (result < 0) {
      channel->event(104, status_body(result, raw));
      return 1;
    }
    result = channel->control(21);
    if (result < 0) {
      channel->event(104, status_body(result, raw));
      return 1;
    }
    result = mount.release_library();
    if (result < 0) {
      channel->event(104, status_body(result, raw));
      return 1;
    }
    return channel->event(103, status_body(STATUS_SUCCESS, raw)) ? 0 : 1;
  }
  // Inherited channel loss establishes no safe detach or replay. The original
  // native owner remains retained until this failed process exits.
  return 1;
}
