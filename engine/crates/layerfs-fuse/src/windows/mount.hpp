// Native Windows connection ownership; no Store, command or SDK policy.
#pragma once
#include <memory>
#include <winfsp/winfsp.h>

namespace layerfs {
enum class MountPhase {
  Empty,
  Loaded,
  Created,
  Mounted,
  Dispatching,
  RootServed,
  Stopped,
  Detached,
  Closed
};
struct MountFacts {
  MountPhase phase;
  bool attempted, library_owned, filesystem_owned, probe_owned;
  NTSTATUS dispatcher_exit;
};
struct MountFailure {
  const char *step;
  NTSTATUS status;
  DWORD win32;
};
class WinFspMount final {
public:
  WinFspMount();
  ~WinFspMount();
  WinFspMount(const WinFspMount &) = delete;
  WinFspMount &operator=(const WinFspMount &) = delete;
  // One attempt. A failure retains its exact completed phase and resources.
  // Callbacks and volume parameters are copied into this owner before create.
  // This is a single control-thread owner; callback functions and their context
  // must outlive native dispatcher drain. RootServed is not SDK Ready.
  // An attach/terminal failure fences effects; no implicit rollback or replay.
  NTSTATUS attach(PCWSTR library, PCWSTR directory,
                  const FSP_FSCTL_VOLUME_PARAMS &params,
                  const FSP_FILE_SYSTEM_INTERFACE &callbacks,
                  UINT64 root_serial, std::shared_ptr<void> context = {});
  // Context is stored in the retained native State, not the C++ owner address.
  static void *callback_context(FSP_FILE_SYSTEM *);
  static BOOLEAN add_dir_info(FSP_FILE_SYSTEM *, FSP_FSCTL_DIR_INFO *, PVOID,
                              ULONG, PULONG);
  MountFacts facts() const;
  MountFailure failure() const;
  BOOLEAN add_dir_info(FSP_FSCTL_DIR_INFO *info, PVOID buffer, ULONG capacity,
                       PULONG transferred) const;
  // Caller fences callback/namespace admission before this irreversible step.
  // These are separate so logical revoke can occur only after native drain.
  NTSTATUS stop();
  NTSTATUS detach();
  // Release only after higher-level logical Close acknowledged completion.
  NTSTATUS release_library();

private:
  struct State;
  std::unique_ptr<State> state_;
  NTSTATUS fail(const char *step, NTSTATUS status, DWORD win32 = 0);
};
} // namespace layerfs
