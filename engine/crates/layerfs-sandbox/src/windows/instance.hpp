// Running restricted-token context: original process, token and private
// desktop.
#pragma once
#include "restricted.hpp"
namespace layerfs {
int run_instance(PCWSTR sid, PCWSTR work);
// Child-only data handles move between the original trusted owners.
// A transferred process handle keeps wait/explicit-cancel out of the instance.
int launch_owned(RestrictedIdentity &, HANDLE request, HANDLE response);
DWORD launch_in_instance(PCWSTR pid, PCWSTR created, int argc, wchar_t **argv,
                         int target, PCWSTR cwd, HANDLE receipt,
                         HANDLE &process, DWORD &process_id, bool &uncertain);
} // namespace layerfs
