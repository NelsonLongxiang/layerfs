// Narrow Workspace callback ABI. The provider owns semantics and error custody.
#pragma once
#include <winfsp/winfsp.h>
namespace layerfs {
struct WorkspaceStat {
  UINT64 serial, size;
  INT64 mtime;
  UINT32 nanos, mode, directory, attributes;
};
static_assert(sizeof(WorkspaceStat) == 40, "Workspace ABI Stat size");
struct WorkspacePort {
  INT32(__cdecl *stat)(PCWSTR, UINT32, WorkspaceStat *) = nullptr;
  INT32(__cdecl *open)
  (PCWSTR, UINT32, UINT32, UINT32, UINT64 *, WorkspaceStat *) = nullptr;
  INT32(__cdecl *info)(UINT64, WorkspaceStat *) = nullptr;
  INT32(__cdecl *create)
  (PCWSTR, UINT32, UINT32, UINT32, UINT32, UINT64 *, WorkspaceStat *) = nullptr;
  INT32(__cdecl *read)(UINT64, UINT64, PVOID, UINT32, UINT32 *) = nullptr;
  INT32(__cdecl *write)
  (UINT64, UINT64, PVOID, UINT32, UINT32, WorkspaceStat *) = nullptr;
  INT32(__cdecl *resize)(UINT64, UINT64, WorkspaceStat *) = nullptr;
  INT32(__cdecl *overwrite)(UINT64, UINT32, UINT32, WorkspaceStat *) = nullptr;
  INT32(__cdecl *basic_info)
  (UINT64, UINT32, UINT64, UINT64, UINT64, UINT64, WorkspaceStat *) = nullptr;
  INT32(__cdecl *rename)(PCWSTR, UINT32, PCWSTR, UINT32, UINT32) = nullptr;
  INT32(__cdecl *can_delete)(PCWSTR, UINT32) = nullptr;
  INT32(__cdecl *dot)(UINT64, UINT32, UINT32 *, WorkspaceStat *) = nullptr;
  INT32(__cdecl *unlink)(PCWSTR, UINT32) = nullptr;
  INT32(__cdecl *close)(UINT64) = nullptr;
  INT32(__cdecl *next)
  (UINT64, PCWSTR, UINT32, PWSTR, UINT32, UINT32 *, WorkspaceStat *) = nullptr;
  INT32(__cdecl *cleanup)(UINT64) = nullptr;
};
} // namespace layerfs
