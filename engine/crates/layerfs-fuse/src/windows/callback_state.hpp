// Adapter implementation state, retained by the native connection owner.
#pragma once
#include "callbacks.hpp"
#include "mount.hpp"
#include <atomic>
#include <mutex>
namespace layerfs {
struct CallbackState {
  WorkspacePort port;
  std::shared_ptr<void> provider;
  WorkspaceVolume volume;
  CallbackObserver observer = nullptr;
  FSP_FILE_SYSTEM_INTERFACE callbacks{};
  PSECURITY_DESCRIPTOR security = nullptr;
  PSECURITY_DESCRIPTOR mount_security = nullptr;
  NTSTATUS status = STATUS_INVALID_PARAMETER;
  DWORD win32 = 0;
  std::atomic<NTSTATUS> failure{STATUS_SUCCESS};
  std::mutex admission;
  size_t active_callbacks = 0;
  bool stopped = false;
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
// Count a whole native callback, including response conversion and multiple ABI
// windows. Fencing a single transport exchange would miss the gaps between
// them.
class CallbackAdmission final {
public:
  explicit CallbackAdmission(CallbackState &s, bool release = false)
      : state_(s) {
    std::lock_guard<std::mutex> lock(s.admission);
    status_ = s.failure.load() < 0 ? STATUS_UNSUCCESSFUL
                                   : (s.stopped && !release ? STATUS_FILE_CLOSED
                                                            : STATUS_SUCCESS);
    if (status_ >= 0)
      ++s.active_callbacks;
  }
  ~CallbackAdmission() {
    if (status_ >= 0) {
      std::lock_guard<std::mutex> lock(state_.admission);
      --state_.active_callbacks;
    }
  }
  NTSTATUS status() const { return status_; }
  CallbackAdmission(const CallbackAdmission &) = delete;
  CallbackAdmission &operator=(const CallbackAdmission &) = delete;

private:
  CallbackState &state_;
  NTSTATUS status_;
};
FSP_FILE_SYSTEM_INTERFACE callback_table();
NTSTATUS copy_security(CallbackState &, PSECURITY_DESCRIPTOR, SIZE_T *);
} // namespace layerfs
