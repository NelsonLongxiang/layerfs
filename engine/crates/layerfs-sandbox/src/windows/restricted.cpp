// One restricted command root. Standard handles are data only; fd3 reports
// original lifecycle, fd4 accepts one explicit root cancellation. No retry,
// process tree termination, fallback token, shell or filesystem supervision.
#include "restricted.hpp"
#include "instance.hpp"
#include <cstdio>
#include <io.h>
namespace {
HANDLE event_pipe = nullptr, process = nullptr;
bool root_done = false, cancelled = false;
bool event(const std::string &line) {
  DWORD done = 0;
  return WriteFile(event_pipe, line.data(), static_cast<DWORD>(line.size()),
                   &done, nullptr) &&
         done == line.size();
}
int failure(PCSTR phase, DWORD error, bool started) {
  event("LFS_EXEC_FAILED phase=" + std::string(phase) + " win32=" +
        std::to_string(error) + " started=" + (started ? "true\n" : "false\n"));
  return 1;
}
} // namespace
int wmain(int argc, wchar_t **argv) {
  if (argc == 4 && !wcscmp(argv[1], L"--instance"))
    return layerfs::run_instance(argv[2], argv[3]);
  event_pipe = reinterpret_cast<HANDLE>(_get_osfhandle(3));
  auto commands = reinterpret_cast<HANDLE>(_get_osfhandle(4));
  if (argc < 4 || event_pipe == INVALID_HANDLE_VALUE ||
      commands == INVALID_HANDLE_VALUE)
    return 2;
  layerfs::RestrictedIdentity identity;
  bool resident = argc >= 7 && !wcscmp(argv[3], L"--instance-command");
  const int target = resident ? 6 : 3;
  DWORD error = ERROR_SUCCESS;
  PROCESS_INFORMATION child{};
  if (resident) {
    bool uncertain = false;
    error = layerfs::launch_in_instance(argv[4], argv[5], argc, argv, target,
                                        argv[2], event_pipe, child.hProcess,
                                        child.dwProcessId, uncertain);
    if (error)
      return failure("instance", error, uncertain);
  } else {
    error = identity.create(argv[1]);
    if (error)
      return failure("token", error, false);
    std::wstring command;
    for (int i = target; i < argc; ++i) {
      if (i != target)
        command += L' ';
      command += layerfs::quote(argv[i]);
    }
    HANDLE handles[3]{};
    DWORD types[] = {STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE};
    for (size_t i = 0; i < 3; ++i) {
      if (!DuplicateHandle(GetCurrentProcess(), GetStdHandle(types[i]),
                           GetCurrentProcess(), &handles[i], 0, TRUE,
                           DUPLICATE_SAME_ACCESS))
        return failure("handles", GetLastError(), false);
    }
    SIZE_T size = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &size);
    std::vector<BYTE> attributes(size);
    auto list =
        reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributes.data());
    if (!InitializeProcThreadAttributeList(list, 1, 0, &size))
      return failure("handles", GetLastError(), false);
    if (!UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                                   handles, sizeof handles, nullptr, nullptr))
      return failure("handles", GetLastError(), false);
    STARTUPINFOEXW setup{};
    setup.StartupInfo.cb = sizeof setup;
    setup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    setup.StartupInfo.hStdInput = handles[0];
    setup.StartupInfo.hStdOutput = handles[1];
    setup.StartupInfo.hStdError = handles[2];
    setup.StartupInfo.lpDesktop = identity.desktop_name.data();
    setup.lpAttributeList = list;
    BOOL made = CreateProcessAsUserW(
        identity.token, argv[target], command.data(), nullptr, nullptr, TRUE,
        EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT, nullptr,
        argv[2], &setup.StartupInfo, &child);
    error = made ? ERROR_SUCCESS : GetLastError();
    DeleteProcThreadAttributeList(list);
    for (auto handle : handles)
      CloseHandle(handle);
    if (error)
      return failure("create", error, false);
    CloseHandle(child.hThread);
  }
  process = child.hProcess; // Retained until this owner exits, including a
                            // control error.
  if (!event("LFS_EXEC_STARTED pid=" + std::to_string(child.dwProcessId) +
             " restricted=true integrity=low\n"))
    return 1;
  bool control_open = true, failed_control = false;
  for (;;) {
    DWORD waited = WaitForSingleObject(process, 50);
    if (waited != WAIT_OBJECT_0 && waited != WAIT_TIMEOUT)
      return failure("wait", GetLastError(), true);
    root_done = waited == WAIT_OBJECT_0;
    if (control_open) {
      DWORD available = 0;
      if (!PeekNamedPipe(commands, nullptr, 0, nullptr, &available, nullptr)) {
        control_open = false; // Loss never authorizes cancellation.
      } else if (available) {
        BYTE request = 0;
        DWORD read = 0;
        if (!ReadFile(commands, &request, 1, &read, nullptr) || read != 1) {
          control_open = false;
        } else if (request != 'C' || cancelled) {
          failure("control", ERROR_INVALID_DATA, true);
          failed_control = true;
          control_open = false;
        } else {
          cancelled = true;
          if (root_done)
            event("LFS_EXEC_CANCEL requested=false\n");
          else if (!TerminateProcess(process, ERROR_CANCELLED)) {
            failure("cancel", GetLastError(), true);
            failed_control = true;
          } else
            event("LFS_EXEC_CANCEL requested=true\n");
        }
      }
    }
    if (!root_done)
      continue;
    DWORD code = 0;
    if (!GetExitCodeProcess(process, &code))
      return failure("wait", GetLastError(), true);
    if (!event("LFS_EXEC_EXIT code=" + std::to_string(code) + "\n"))
      return 1;
    if (failed_control)
      return 1;
    break;
  }
  // Private desktop belongs to this owner; process descendants may retain their
  // own desktop/stream handles. No descendant-drain or Job-object claim.
  return 0;
}
