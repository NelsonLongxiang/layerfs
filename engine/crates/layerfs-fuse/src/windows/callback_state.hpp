// Adapter implementation state, retained by the native connection owner.
#pragma once
#include "callbacks.hpp"
#include "mount.hpp"
#include <atomic>
namespace layerfs {
struct CallbackState {
  WorkspacePort port;
  std::shared_ptr<void> provider;
  WorkspaceVolume volume;
  CallbackObserver observer = nullptr;
  FSP_FILE_SYSTEM_INTERFACE callbacks{};
  PSECURITY_DESCRIPTOR security = nullptr;
  NTSTATUS status = STATUS_INVALID_PARAMETER;
  DWORD win32 = 0;
  std::atomic<NTSTATUS> failure{STATUS_SUCCESS};
  ~CallbackState();
};
inline CallbackState &callback_state(FSP_FILE_SYSTEM *fs) {
  return *static_cast<CallbackState *>(WinFspMount::callback_context(fs));
}
inline void observe(CallbackState &state, const CallbackEvent &event) {
  if (state.observer)
    state.observer(event);
}
inline void callback_failed(CallbackState &state, UINT64 held,
                            NTSTATUS status) {
  NTSTATUS first = STATUS_SUCCESS;
  state.failure.compare_exchange_strong(first, status);
  CallbackEvent event{CallbackKind::Failure};
  event.handle = held;
  event.status = status;
  observe(state, event);
}
FSP_FILE_SYSTEM_INTERFACE callback_table();
NTSTATUS copy_security(CallbackState &, PSECURITY_DESCRIPTOR, SIZE_T *);
} // namespace layerfs
