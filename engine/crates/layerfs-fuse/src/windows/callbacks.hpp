// Per-mount WinFsp callbacks over the existing Workspace ABI.
#pragma once
#include "workspace_port.hpp"
#include <memory>
#include <string>
namespace layerfs {
enum class CallbackKind {
  Open,
  Create,
  Cleanup,
  CloseBegin,
  Close,
  Read,
  Write,
  Rename,
  Delete,
  Failure
};
struct CallbackEvent {
  CallbackKind kind;
  UINT64 handle = 0, serial = 0, offset = 0;
  UINT32 flags = 0, length = 0, transferred = 0;
  NTSTATUS status = STATUS_SUCCESS;
  PCWSTR name = nullptr; // Borrowed for this synchronous observation only.
};
using CallbackObserver = void (*)(const CallbackEvent &) noexcept;
struct WorkspaceVolume {
  UINT64 total_bytes, free_bytes;
  std::wstring
      label; // Caller-supplied volume observation, not a capacity promise.
};
struct CallbackState;
class WorkspaceCallbacks final {
public:
  // provider keeps all WorkspacePort function addresses and their state alive.
  // Observer code must belong to the same lifetime or to the host executable.
  WorkspaceCallbacks(const WorkspacePort &, std::shared_ptr<void> provider,
                     WorkspaceVolume volume,
                     CallbackObserver observer = nullptr);
  NTSTATUS status() const;
  DWORD win32_error() const;
  NTSTATUS callback_failure() const;
  const FSP_FILE_SYSTEM_INTERFACE &table() const;
  std::shared_ptr<void> context() const;

private:
  std::shared_ptr<CallbackState> state_;
};
// Portable metadata conversion used by the actual native callback adapter.
void file_info(const WorkspaceStat &, FSP_FSCTL_FILE_INFO *);
} // namespace layerfs
