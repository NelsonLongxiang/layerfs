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
static DWORD owner_security(PSECURITY_DESCRIPTOR *security) {
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
  WCHAR sddl[256]{};
  if (!error) {
    if (swprintf_s(sddl, L"O:%sG:%sD:P(A;;FA;;;%s)", sid, sid, sid) < 0)
      error = ERROR_INSUFFICIENT_BUFFER;
    else if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
                 sddl, SDDL_REVISION_1, security, nullptr))
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
                                       CallbackObserver observer)
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
  s.win32 = owner_security(&s.security);
  if (s.win32) {
    s.status = STATUS_UNSUCCESSFUL;
    return;
  }
  s.callbacks = callback_table();
  s.status = STATUS_SUCCESS;
}
NTSTATUS WorkspaceCallbacks::status() const { return state_->status; }
DWORD WorkspaceCallbacks::win32_error() const { return state_->win32; }
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
