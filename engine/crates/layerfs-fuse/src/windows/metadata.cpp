// Metadata and current-process-owner security for native callback service.
#define NOMINMAX
#include "callback_state.hpp"
#include <cstring>
#include <cwchar>
#include <sddl.h>
#include <utility>
namespace layerfs {
void file_info(const WorkspaceStat &stat, FSP_FSCTL_FILE_INFO *info) {
  *info = {};
  info->FileAttributes =
      stat.attributes | (stat.directory ? FILE_ATTRIBUTE_DIRECTORY : 0);
  if (!(stat.mode & 0200))
    info->FileAttributes |= FILE_ATTRIBUTE_READONLY;
  if (!info->FileAttributes)
    info->FileAttributes = FILE_ATTRIBUTE_NORMAL;
  info->IndexNumber = stat.serial;
  info->FileSize = stat.size;
  info->AllocationSize = (stat.size + 4095) & ~UINT64(4095);
  if (stat.mtime >= -11644473600LL) {
    auto seconds = static_cast<UINT64>(stat.mtime) + UINT64(11644473600);
    auto fraction = stat.nanos / 100;
    if (seconds > (UINT64_MAX - fraction) / 10000000)
      return; // Portable time outside FILETIME: no wrapping or signed overflow.
    auto time = seconds * 10000000 + fraction;
    info->CreationTime = time;
    info->LastAccessTime = time;
    info->LastWriteTime = time;
    info->ChangeTime = time;
  }
}

NTSTATUS copy_security(CallbackState &state, PSECURITY_DESCRIPTOR target,
                       SIZE_T *size) {
  if (!size)
    return STATUS_SUCCESS;
  SIZE_T need = GetSecurityDescriptorLength(state.security), capacity = *size;
  *size = need;
  if (target) {
    if (capacity < need)
      return STATUS_BUFFER_OVERFLOW;
    memcpy(target, state.security, need);
  }
  return STATUS_SUCCESS;
}
static DWORD owner_security(PSECURITY_DESCRIPTOR *security,
                            PCWSTR restricted_sid) {
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token))
    return GetLastError();
  DWORD need = 0;
  GetTokenInformation(token, TokenUser, nullptr, 0, &need);
  auto data = static_cast<TOKEN_USER *>(LocalAlloc(LMEM_FIXED, need));
  DWORD error = ERROR_SUCCESS;
  if (!data)
    error = ERROR_NOT_ENOUGH_MEMORY;
  else if (!GetTokenInformation(token, TokenUser, data, need, &need))
    error = GetLastError();
  CloseHandle(token);
  PWSTR sid = nullptr;
  if (!error && !ConvertSidToStringSidW(data->User.Sid, &sid))
    error = GetLastError();
  if (!error) {
    PSID admitted = nullptr;
    if (restricted_sid &&
        (wcsncmp(restricted_sid, L"S-1-5-21-", 9) ||
         !ConvertStringSidToSidW(restricted_sid, &admitted) ||
         !IsValidSid(admitted) || *GetSidSubAuthorityCount(admitted) != 5 ||
         EqualSid(admitted, data->User.Sid))) {
      if (admitted)
        LocalFree(admitted);
      LocalFree(sid);
      LocalFree(data);
      return ERROR_INVALID_SID;
    }
    if (admitted)
      LocalFree(admitted);
    std::wstring grant = restricted_sid
                             ? std::wstring(L"(A;;0x1301bf;;;") +
                                   restricted_sid + L")S:(ML;;NW;;;LW)"
                             : L"";
    std::wstring sddl = L"O:" + std::wstring(sid) + L"G:" + sid +
                        L"D:P(A;;FA;;;" + sid + L")" + grant;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.c_str(), SDDL_REVISION_1, security, nullptr))
      error = GetLastError();
  }
  if (sid)
    LocalFree(sid);
  if (data)
    LocalFree(data);
  return error;
}
CallbackState::~CallbackState() {
  if (security)
    LocalFree(security);
}
WorkspaceCallbacks::WorkspaceCallbacks(const WorkspacePort &port,
                                       std::shared_ptr<void> provider,
                                       WorkspaceVolume volume,
                                       CallbackObserver observer,
                                       PCWSTR restricted_sid)
    : state_(std::make_shared<CallbackState>()) {
  auto &s = *state_;
  s.port = port;
  s.provider = std::move(provider);
  s.volume = std::move(volume);
  s.observer = observer;
  if (!s.provider || !port.stat || !port.open || !port.info || !port.create ||
      !port.read || !port.write || !port.resize || !port.overwrite ||
      !port.basic_info || !port.rename || !port.can_delete || !port.dot ||
      !port.unlink || !port.close || !port.next || !port.cleanup ||
      s.volume.free_bytes > s.volume.total_bytes ||
      s.volume.label.size() >
          sizeof(FSP_FSCTL_VOLUME_INFO::VolumeLabel) / sizeof(WCHAR))
    return;
  s.win32 = owner_security(&s.security, restricted_sid);
  if (s.win32) {
    s.status = STATUS_UNSUCCESSFUL;
    return;
  }
  s.callbacks = callback_table();
  s.status = STATUS_SUCCESS;
}
NTSTATUS WorkspaceCallbacks::status() const { return state_->status; }
DWORD WorkspaceCallbacks::win32_error() const { return state_->win32; }
NTSTATUS WorkspaceCallbacks::try_stop_callbacks() {
  auto &s = *state_;
  std::lock_guard<std::mutex> lock(s.admission);
  if (s.status < 0 || s.failure.load() < 0)
    return STATUS_UNSUCCESSFUL;
  if (s.stopped)
    return STATUS_INVALID_DEVICE_STATE;
  if (s.active_callbacks)
    return STATUS_DEVICE_BUSY;
  s.stopped = true;
  return STATUS_SUCCESS;
}
NTSTATUS WorkspaceCallbacks::resume_callbacks() {
  auto &s = *state_;
  std::lock_guard<std::mutex> lock(s.admission);
  if (s.failure.load() < 0)
    return STATUS_UNSUCCESSFUL;
  if (!s.stopped)
    return STATUS_INVALID_DEVICE_STATE;
  // Release callbacks may finish during a reversible Busy probe. Reopening
  // ordinary admission must not fail merely because an original Close runs.
  s.stopped = false;
  return STATUS_SUCCESS;
}
NTSTATUS WorkspaceCallbacks::callback_failure() const {
  return state_->failure.load();
}
const FSP_FILE_SYSTEM_INTERFACE &WorkspaceCallbacks::table() const {
  return state_->callbacks;
}
std::shared_ptr<void> WorkspaceCallbacks::context() const {
  return state_->status >= 0 ? state_ : nullptr;
}
} // namespace layerfs
