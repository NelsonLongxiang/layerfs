// Reversible native close transaction; no descriptor disposal or guessed drain.
#pragma once
#include <winfsp/winfsp.h>
namespace layerfs {
class StdioPort;
class WinFspMount;
class WorkspaceCallbacks;
NTSTATUS coordinate_close(StdioPort &, WinFspMount &, WorkspaceCallbacks &);
} // namespace layerfs
