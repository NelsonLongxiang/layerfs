// Native callbacks use the same Workspace port and exact per-mount context.
#define NOMINMAX
#include "callback_state.hpp"
#include <cstring>
#include <cwchar>
namespace layerfs {
static UINT32 length(PCWSTR text) {
  return text ? static_cast<UINT32>(wcslen(text)) : 0;
}
static UINT64 handle(PVOID ctx) {
  return static_cast<FSP_FSCTL_TRANSACT_FULL_CONTEXT *>(ctx)->UserContext2;
}
static NTSTATUS volume(FSP_FILE_SYSTEM *fs, FSP_FSCTL_VOLUME_INFO *info) {
  auto &s = callback_state(fs);
  CallbackAdmission admission(s);
  if (admission.status() < 0)
    return admission.status();
  *info = {};
  info->TotalSize = s.volume.total_bytes;
  info->FreeSize = s.volume.free_bytes;
  info->VolumeLabelLength =
      static_cast<UINT16>(s.volume.label.size() * sizeof(WCHAR));
  memcpy(info->VolumeLabel, s.volume.label.data(), info->VolumeLabelLength);
  return STATUS_SUCCESS;
}
static NTSTATUS security_name(FSP_FILE_SYSTEM *fs, PWSTR name, PUINT32 attrs,
                              PSECURITY_DESCRIPTOR sd, SIZE_T *size) {
  auto &s = callback_state(fs);
  CallbackAdmission admission(s);
  if (admission.status() < 0)
    return admission.status();
  WorkspaceStat stat{};
  auto status = s.port.stat(name, length(name), &stat);
  if (status < 0)
    return status;
  if (attrs) {
    FSP_FSCTL_FILE_INFO info{};
    file_info(stat, &info);
    *attrs = info.FileAttributes;
  }
  return copy_security(s, sd, size);
}
static NTSTATUS get_security(FSP_FILE_SYSTEM *fs, PVOID,
                             PSECURITY_DESCRIPTOR sd, SIZE_T *size) {
  auto &s = callback_state(fs);
  CallbackAdmission admission(s);
  if (admission.status() < 0)
    return admission.status();
  return copy_security(s, sd, size);
}
static NTSTATUS open_file(FSP_FILE_SYSTEM *fs, PWSTR name, UINT32,
                          UINT32 access, PVOID *ctx,
                          FSP_FSCTL_FILE_INFO *info) {
  auto &s = callback_state(fs);
  CallbackAdmission admission(s);
  if (admission.status() < 0)
    return admission.status();
  WorkspaceStat stat{};
  UINT64 held = 0;
  auto status = s.port.open(
      name, length(name), 0,
      ((access & (FILE_WRITE_DATA | FILE_APPEND_DATA)) ? 1u : 0u) |
          ((access & FILE_WRITE_ATTRIBUTES) ? 2u : 0u) |
          ((access & (DELETE | WRITE_DAC | WRITE_OWNER | FILE_WRITE_EA)) ? 4u
                                                                         : 0u),
      &held, &stat);
  if (status < 0)
    return status;
  auto full = reinterpret_cast<FSP_FSCTL_TRANSACT_FULL_CONTEXT *>(ctx);
  full->UserContext = stat.serial;
  full->UserContext2 = held;
  file_info(stat, info);
  observe(s, {CallbackKind::Open, held, stat.serial, 0, access, 0, 0,
              STATUS_SUCCESS, name});
  return STATUS_SUCCESS;
}
static NTSTATUS create_file(FSP_FILE_SYSTEM *fs, PWSTR name, UINT32 options,
                            UINT32 access, UINT32 attributes,
                            PSECURITY_DESCRIPTOR, UINT64 allocation, PVOID *ctx,
                            FSP_FSCTL_FILE_INFO *info) {
  auto &s = callback_state(fs);
  CallbackAdmission admission(s);
  if (admission.status() < 0)
    return admission.status();
  if (allocation)
    return STATUS_NOT_SUPPORTED;
  WorkspaceStat stat{};
  UINT64 held = 0;
  auto status = s.port.create(
      name, length(name), (options & FILE_DIRECTORY_FILE) ? 1u : 0u,
      ((access & (FILE_WRITE_DATA | FILE_APPEND_DATA)) ? 1u : 0u) |
          ((access & FILE_WRITE_ATTRIBUTES) ? 2u : 0u) |
          ((access & (DELETE | WRITE_DAC | WRITE_OWNER | FILE_WRITE_EA)) ? 4u
                                                                         : 0u),
      attributes, &held, &stat);
  if (status < 0)
    return status;
  auto full = reinterpret_cast<FSP_FSCTL_TRANSACT_FULL_CONTEXT *>(ctx);
  full->UserContext = stat.serial;
  full->UserContext2 = held;
  file_info(stat, info);
  observe(s, {CallbackKind::Create, held, stat.serial, 0, access, 0, 0,
              STATUS_SUCCESS, name});
  return STATUS_SUCCESS;
}
static NTSTATUS overwrite(FSP_FILE_SYSTEM *fs, PVOID ctx, UINT32 attributes,
                          BOOLEAN replace, UINT64 allocation,
                          FSP_FSCTL_FILE_INFO *info) {
  auto &s = callback_state(fs);
  CallbackAdmission admission(s);
  if (admission.status() < 0)
    return admission.status();
  if (allocation)
    return STATUS_NOT_SUPPORTED;
  WorkspaceStat stat{};
  auto status =
      s.port.overwrite(handle(ctx), attributes, replace ? 1u : 0u, &stat);
  if (status >= 0)
    file_info(stat, info);
  return status;
}
static VOID cleanup(FSP_FILE_SYSTEM *fs, PVOID ctx, PWSTR name, ULONG flags) {
  auto &s = callback_state(fs);
  // Existing owners must be able to release while a reversible close probe is
  // awaiting its Busy answer. They remain counted through the entire callback.
  CallbackAdmission admission(s, true);
  if (admission.status() < 0) {
    callback_failed(s, handle(ctx), admission.status());
    return;
  }
  observe(s, {CallbackKind::Cleanup, handle(ctx),
              static_cast<FSP_FSCTL_TRANSACT_FULL_CONTEXT *>(ctx)->UserContext,
              0, flags, 0, 0, STATUS_SUCCESS, name});
  if (flags & FspCleanupDelete) {
    auto status = s.port.unlink(name, length(name));
    if (status < 0) {
      callback_failed(s, handle(ctx), status);
    } else
      observe(s, {CallbackKind::Delete, handle(ctx)});
  }
  auto tracked = s.port.cleanup(handle(ctx));
  if (tracked < 0)
    callback_failed(s, handle(ctx), tracked);

  // Keep Rust OpenFile/KernelDirectory until Close, not Cleanup.
}
static VOID close_file(FSP_FILE_SYSTEM *fs, PVOID ctx) {
  auto &s = callback_state(fs);
  CallbackAdmission admission(s, true);
  if (admission.status() < 0) {
    callback_failed(s, handle(ctx), admission.status());
    return;
  }
  observe(s, {CallbackKind::CloseBegin, handle(ctx)});
  auto status = s.port.close(handle(ctx));
  if (status < 0) {
    callback_failed(s, handle(ctx), status);
  }
  observe(s, {CallbackKind::Close, handle(ctx),
              static_cast<FSP_FSCTL_TRANSACT_FULL_CONTEXT *>(ctx)->UserContext,
              0, 0, 0, 0, status});
}
static NTSTATUS read_file(FSP_FILE_SYSTEM *fs, PVOID ctx, PVOID buffer,
                          UINT64 offset, ULONG size, PULONG count) {
  auto &s = callback_state(fs);
  CallbackAdmission admission(s);
  if (admission.status() < 0)
    return admission.status();
  *count = 0;
  if (size > UINT64_MAX - offset)
    return STATUS_INVALID_PARAMETER;
  while (*count < size) {
    UINT32 got = 0;
    auto n = size - *count;
    if (n > 131072)
      n = 131072;
    auto status = s.port.read(handle(ctx), offset + *count,
                              static_cast<BYTE *>(buffer) + *count, n, &got);
    if (status < 0)
      return status;
    if (got > n) {
      callback_failed(s, handle(ctx), STATUS_INVALID_PARAMETER);
      return STATUS_INVALID_PARAMETER;
    }
    *count += got;
    if (got < n)
      break;
  }
  observe(s, {CallbackKind::Read, handle(ctx)});
  return *count || size == 0 ? STATUS_SUCCESS : STATUS_END_OF_FILE;
}
static NTSTATUS write_file(FSP_FILE_SYSTEM *fs, PVOID ctx, PVOID buffer,
                           UINT64 offset, ULONG size, BOOLEAN append,
                           BOOLEAN constrained, PULONG count,
                           FSP_FSCTL_FILE_INFO *info) {
  auto &s = callback_state(fs);
  CallbackAdmission admission(s);
  if (admission.status() < 0)
    return admission.status();
  WorkspaceStat stat{};
  *count = 0;
  auto status = s.port.info(handle(ctx), &stat);
  if (status < 0)
    return status;
  if (append)
    offset = stat.size;
  if (constrained) {
    if (offset >= stat.size) {
      file_info(stat, info);
      return STATUS_SUCCESS;
    }
    auto remain = stat.size - offset;
    if (remain < size)
      size = static_cast<ULONG>(remain);
  }
  if (size > UINT64_MAX - offset)
    return STATUS_INVALID_PARAMETER;
  while (*count < size) {
    UINT32 n = size - *count;
    if (n > 131072)
      n = 131072;
    status = s.port.write(handle(ctx), offset + *count,
                          static_cast<BYTE *>(buffer) + *count, n,
                          (append ? 1u : 0u) | (constrained ? 2u : 0u), &stat);
    if (status < 0)
      return status;
    *count += n;
  }
  file_info(stat, info);
  observe(s, {CallbackKind::Write, handle(ctx), 0, offset,
              (append ? 1u : 0u) | (constrained ? 2u : 0u), size, *count});
  return STATUS_SUCCESS;
}
static NTSTATUS get_info(FSP_FILE_SYSTEM *fs, PVOID ctx,
                         FSP_FSCTL_FILE_INFO *info) {
  auto &s = callback_state(fs);
  CallbackAdmission admission(s);
  if (admission.status() < 0)
    return admission.status();
  WorkspaceStat stat{};
  auto status = s.port.info(handle(ctx), &stat);
  if (status >= 0)
    file_info(stat, info);
  return status;
}
static NTSTATUS flush(FSP_FILE_SYSTEM *fs, PVOID ctx,
                      FSP_FSCTL_FILE_INFO *info) {
  return ctx ? get_info(fs, ctx, info) : STATUS_SUCCESS;
}
static NTSTATUS size_file(FSP_FILE_SYSTEM *fs, PVOID ctx, UINT64 size,
                          BOOLEAN allocation, FSP_FSCTL_FILE_INFO *info) {
  auto &s = callback_state(fs);
  CallbackAdmission admission(s);
  if (admission.status() < 0)
    return admission.status();
  WorkspaceStat stat{};
  auto status = s.port.info(handle(ctx), &stat);
  if (status < 0)
    return status;
  if (allocation && size >= stat.size)
    return get_info(fs, ctx, info); // no reservation of disposable backing
  status = s.port.resize(handle(ctx), size, &stat);
  if (status >= 0)
    file_info(stat, info);
  return status;
}
static NTSTATUS basic_info(FSP_FILE_SYSTEM *fs, PVOID ctx, UINT32 attributes,
                           UINT64 creation, UINT64 access, UINT64 write,
                           UINT64 change, FSP_FSCTL_FILE_INFO *info) {
  auto &s = callback_state(fs);
  CallbackAdmission admission(s);
  if (admission.status() < 0)
    return admission.status();
  WorkspaceStat stat{};
  auto status = s.port.basic_info(handle(ctx), attributes, creation, access,
                                  write, change, &stat);

  if (status >= 0)
    file_info(stat, info);
  return status;
}
static NTSTATUS can_delete(FSP_FILE_SYSTEM *fs, PVOID, PWSTR name) {
  auto &s = callback_state(fs);
  CallbackAdmission admission(s);
  if (admission.status() < 0)
    return admission.status();
  return s.port.can_delete(name, length(name));
}
static NTSTATUS rename_file(FSP_FILE_SYSTEM *fs, PVOID, PWSTR from, PWSTR to,
                            BOOLEAN replace) {
  auto &s = callback_state(fs);
  CallbackAdmission admission(s);
  if (admission.status() < 0)
    return admission.status();
  auto status = s.port.rename(from, length(from), to, length(to), replace);
  if (status >= 0)
    observe(s, {CallbackKind::Rename});
  return status;
}
static NTSTATUS directory(FSP_FILE_SYSTEM *fs, PVOID ctx, PWSTR, PWSTR marker,
                          PVOID buffer, ULONG capacity, PULONG count) {
  auto &s = callback_state(fs);
  CallbackAdmission admission(s);
  if (admission.status() < 0)
    return admission.status();
  *count = 0;
  WCHAR after[256]{};
  if (!marker || !wcscmp(marker, L".")) {
    for (UINT32 parent = marker ? 1u : 0u; parent < 2; ++parent) {
      WorkspaceStat stat{};
      UINT32 found = 0;
      auto status = s.port.dot(handle(ctx), parent, &found, &stat);
      if (status < 0)
        return status;
      if (found) {
        alignas(8) BYTE row[sizeof(FSP_FSCTL_DIR_INFO) + 4]{};
        auto di = reinterpret_cast<FSP_FSCTL_DIR_INFO *>(row);
        di->Size =
            static_cast<UINT16>(sizeof(*di) + (parent + 1) * sizeof(WCHAR));
        file_info(stat, &di->FileInfo);
        di->FileNameBuf[0] = L'.';
        if (parent)
          di->FileNameBuf[1] = L'.';
        if (!WinFspMount::add_dir_info(fs, di, buffer, capacity, count))
          return STATUS_SUCCESS;
      }
    }
  }
  if (marker && wcscmp(marker, L".") && wcscmp(marker, L"..")) {
    if (length(marker) > 255)
      return STATUS_INVALID_PARAMETER;
    wcscpy_s(after, marker);
  }
  for (;;) {
    WCHAR name[256]{};
    UINT32 len = 0;
    WorkspaceStat stat{};
    auto status =
        s.port.next(handle(ctx), after, length(after), name, 255, &len, &stat);
    if (status < 0)
      return status;
    if (len > 255) {
      callback_failed(s, handle(ctx), STATUS_INVALID_PARAMETER);
      return STATUS_INVALID_PARAMETER;
    }
    if (!len) {
      WinFspMount::add_dir_info(fs, nullptr, buffer, capacity, count);
      return STATUS_SUCCESS;
    }
    alignas(8) BYTE row[sizeof(FSP_FSCTL_DIR_INFO) + 512]{};
    auto di = reinterpret_cast<FSP_FSCTL_DIR_INFO *>(row);
    di->Size = static_cast<UINT16>(sizeof(*di) + len * sizeof(WCHAR));
    file_info(stat, &di->FileInfo);
    memcpy(di->FileNameBuf, name, len * sizeof(WCHAR));
    if (!WinFspMount::add_dir_info(fs, di, buffer, capacity, count))
      return STATUS_SUCCESS;
    name[len] = 0;
    wcscpy_s(after, name);
  }
}

FSP_FILE_SYSTEM_INTERFACE callback_table() {
  FSP_FILE_SYSTEM_INTERFACE callbacks{};
  callbacks.GetVolumeInfo = volume;
  callbacks.GetSecurityByName = security_name;
  callbacks.Create = create_file;
  callbacks.Open = open_file;
  callbacks.Overwrite = overwrite;
  callbacks.Cleanup = cleanup;
  callbacks.Close = close_file;
  callbacks.Read = read_file;
  callbacks.Write = write_file;
  callbacks.Flush = flush;
  callbacks.GetFileInfo = get_info;
  callbacks.SetFileSize = size_file;
  callbacks.SetBasicInfo = basic_info;
  callbacks.CanDelete = can_delete;
  callbacks.Rename = rename_file;
  callbacks.GetSecurity = get_security;
  callbacks.ReadDirectory = directory;
  return callbacks;
}
} // namespace layerfs
