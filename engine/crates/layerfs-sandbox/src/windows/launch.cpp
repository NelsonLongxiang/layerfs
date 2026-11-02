// Target creation belongs to the original resident token owner. The command
// owner transfers data handles and receives the original process handle once.
#include "instance.hpp"
#include <cwchar>
namespace {
struct Handle {
  HANDLE value = nullptr;
  ~Handle() {
    if (value && value != INVALID_HANDLE_VALUE)
      CloseHandle(value);
  }
  HANDLE *out() { return &value; }
};
// Only copies not yet exposed to the resident protocol can be reclaimed here.
// Once announced, original owners retain them on uncertain delivery.
struct PreparedHandles {
  HANDLE owner;
  std::vector<HANDLE> copies;
  bool announced = false;
  ~PreparedHandles() {
    if (announced)
      return;
    for (auto source : copies) {
      HANDLE local = nullptr;
      if (DuplicateHandle(owner, source, GetCurrentProcess(), &local, 0, FALSE,
                          DUPLICATE_CLOSE_SOURCE | DUPLICATE_SAME_ACCESS))
        CloseHandle(local);
    }
  }
};
struct Request {
  DWORD magic = 0x31494c46, bytes = 0, owner = 0, chars[4]{};
  ULONGLONG created = 0, standard[3]{};
};
struct Reply {
  DWORD magic = 0x31524c46, error = 0, pid = 0, started = 0;
  ULONGLONG process = 0;
};
bool transfer(HANDLE pipe, void *data, size_t size, bool write) {
  auto p = static_cast<BYTE *>(data);
  while (size) {
    DWORD done = 0;
    BOOL ok = write
                  ? WriteFile(pipe, p, static_cast<DWORD>(size), &done, nullptr)
                  : ReadFile(pipe, p, static_cast<DWORD>(size), &done, nullptr);
    if (!ok || !done || done > size)
      return false;
    p += done;
    size -= done;
  }
  return true;
}
ULONGLONG creation(HANDLE process) {
  FILETIME made{}, exit{}, kernel{}, user{};
  if (!GetProcessTimes(process, &made, &exit, &kernel, &user))
    return 0;
  return (static_cast<ULONGLONG>(made.dwHighDateTime) << 32) |
         made.dwLowDateTime;
}
bool number(PCWSTR s, ULONGLONG &n) {
  if (!s || !*s)
    return false;
  n = 0;
  for (; *s; ++s) {
    if (*s < L'0' || *s > L'9' || n > (ULLONG_MAX - (*s - L'0')) / 10)
      return false;
    n = n * 10 + (*s - L'0');
  }
  return true;
}
} // namespace
namespace layerfs {
int launch_owned(RestrictedIdentity &identity, HANDLE request_pipe,
                 HANDLE response_pipe) {
  Handle request{request_pipe}, response{response_pipe}, owner;
  Request input{};
  Reply reply{};
  if (!transfer(request.value, &input, sizeof input, false) ||
      input.magic != 0x31494c46 || input.bytes > 262144 ||
      input.bytes % sizeof(WCHAR))
    return -1;
  size_t total = 0;
  for (auto n : input.chars) {
    if (!n || n > 32768)
      return -1;
    total += n;
  }
  if (total * sizeof(WCHAR) != input.bytes ||
      input.owner == GetCurrentProcessId())
    return -1;
  owner.value = OpenProcess(PROCESS_DUP_HANDLE |
                                PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE,
                            FALSE, input.owner);
  if (!owner.value || !input.created ||
      creation(owner.value) != input.created ||
      WaitForSingleObject(owner.value, 0) != WAIT_TIMEOUT)
    return -1;
  std::vector<WCHAR> data(total);
  if (!transfer(request.value, data.data(), input.bytes, false))
    return -1;
  WCHAR *parts[4]{};
  size_t at = 0;
  for (int i = 0; i < 4; ++i) {
    parts[i] = data.data() + at;
    if (parts[i][input.chars[i] - 1] != 0)
      return -1;
    if (i != 3 && wcslen(parts[i]) + 1 != input.chars[i])
      return -1;
    at += input.chars[i];
  }
  if (input.chars[3] < 2 || parts[3][input.chars[3] - 2] != 0)
    return -1;
  HANDLE standard[3]{};
  for (int i = 0; i < 3; ++i)
    standard[i] =
        reinterpret_cast<HANDLE>(static_cast<uintptr_t>(input.standard[i]));
  SIZE_T size = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &size);
  std::vector<BYTE> attributes(size);
  auto list = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributes.data());
  if (!InitializeProcThreadAttributeList(list, 1, 0, &size))
    return -1;
  if (!UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                                 standard, sizeof standard, nullptr, nullptr)) {
    DeleteProcThreadAttributeList(list);
    return -1;
  }
  STARTUPINFOEXW setup{};
  setup.StartupInfo.cb = sizeof setup;
  setup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  setup.StartupInfo.hStdInput = standard[0];
  setup.StartupInfo.hStdOutput = standard[1];
  setup.StartupInfo.hStdError = standard[2];
  setup.StartupInfo.lpDesktop = identity.desktop_name.data();
  setup.lpAttributeList = list;
  PROCESS_INFORMATION child{};
  BOOL made = CreateProcessAsUserW(
      identity.token, parts[0], parts[1], nullptr, nullptr, TRUE,
      EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT, parts[3],
      parts[2], &setup.StartupInfo, &child);
  reply.error = made ? ERROR_SUCCESS : GetLastError();
  DeleteProcThreadAttributeList(list);
  for (auto h : standard)
    CloseHandle(h);
  if (made) {
    CloseHandle(child.hThread);
    reply.started = 1;
    reply.pid = child.dwProcessId;
    HANDLE target = nullptr;
    if (!DuplicateHandle(
            GetCurrentProcess(), child.hProcess, owner.value, &target,
            SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE,
            FALSE, 0)) {
      reply.error = GetLastError(); // Original process handle retained on
                                    // unknown handoff.
    } else {
      reply.process = reinterpret_cast<uintptr_t>(target);
      CloseHandle(child.hProcess);
    }
  }
  if (!transfer(response.value, &reply, sizeof reply, true))
    return -1;
  return reply.error ? (reply.started ? -1 : 0) : 1;
}
DWORD launch_in_instance(PCWSTR pid_text, PCWSTR created_text, int argc,
                         wchar_t **argv, int target, PCWSTR cwd, HANDLE receipt,
                         HANDLE &process, DWORD &process_id, bool &uncertain) {
  ULONGLONG pid = 0, stamp = 0;
  if (!number(pid_text, pid) || !pid || pid > MAXDWORD ||
      !number(created_text, stamp) || !stamp)
    return ERROR_INVALID_PARAMETER;
  Handle owner;
  owner.value = OpenProcess(PROCESS_DUP_HANDLE |
                                PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE,
                            FALSE, static_cast<DWORD>(pid));
  if (!owner.value || creation(owner.value) != stamp ||
      WaitForSingleObject(owner.value, 0) != WAIT_TIMEOUT)
    return ERROR_INVALID_HANDLE;
  std::wstring command;
  for (int i = target; i < argc; ++i) {
    if (i != target)
      command += L' ';
    command += quote(argv[i]);
  }
  auto environment = GetEnvironmentStringsW();
  if (!environment)
    return GetLastError();
  size_t env_size = 0;
  while (environment[env_size])
    env_size += wcslen(environment + env_size) + 1;
  ++env_size;
  if (env_size == 1)
    env_size = 2;
  const WCHAR *parts[] = {argv[target], command.c_str(), cwd, environment};
  Request request{};
  request.owner = GetCurrentProcessId();
  request.created = creation(GetCurrentProcess());
  size_t chars = 0;
  for (int i = 0; i < 4; ++i) {
    size_t n = i == 3 ? env_size : wcslen(parts[i]) + 1;
    if (n > 32768) {
      FreeEnvironmentStringsW(environment);
      return ERROR_BAD_LENGTH;
    }
    request.chars[i] = static_cast<DWORD>(n);
    chars += n;
  }
  request.bytes = static_cast<DWORD>(chars * sizeof(WCHAR));
  std::vector<WCHAR> body;
  body.reserve(chars);
  for (int i = 0; i < 4; ++i)
    body.insert(body.end(), parts[i], parts[i] + request.chars[i]);
  FreeEnvironmentStringsW(environment);
  Handle request_read, request_write, response_read, response_write;
  if (!CreatePipe(request_read.out(), request_write.out(), nullptr, 0) ||
      !CreatePipe(response_read.out(), response_write.out(), nullptr, 0))
    return GetLastError();
  PreparedHandles copies{owner.value, {}, false};
  HANDLE remote_request = nullptr, remote_response = nullptr;
  if (!DuplicateHandle(GetCurrentProcess(), request_read.value, owner.value,
                       &remote_request, 0, FALSE, DUPLICATE_SAME_ACCESS))
    return GetLastError();
  copies.copies.push_back(remote_request);
  if (!DuplicateHandle(GetCurrentProcess(), response_write.value, owner.value,
                       &remote_response, 0, FALSE, DUPLICATE_SAME_ACCESS))
    return GetLastError();
  copies.copies.push_back(remote_response);
  CloseHandle(request_read.value);
  request_read.value = nullptr;
  CloseHandle(response_write.value);
  response_write.value = nullptr;
  DWORD types[] = {STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE};
  for (int i = 0; i < 3; ++i) {
    HANDLE value = nullptr;
    if (!DuplicateHandle(GetCurrentProcess(), GetStdHandle(types[i]),
                         owner.value, &value, 0, TRUE, DUPLICATE_SAME_ACCESS))
      return GetLastError();
    copies.copies.push_back(value);
    request.standard[i] = reinterpret_cast<uintptr_t>(value);
  }
  std::string prepared =
      "LFS_EXEC_PREPARED request=" +
      std::to_string(reinterpret_cast<uintptr_t>(remote_request)) +
      " response=" +
      std::to_string(reinterpret_cast<uintptr_t>(remote_response)) + "\n";
  uncertain = true;
  copies.announced = true;
  if (!transfer(receipt, prepared.data(), prepared.size(), true) ||
      !transfer(request_write.value, &request, sizeof request, true) ||
      !transfer(request_write.value, body.data(), request.bytes, true))
    return ERROR_BROKEN_PIPE;
  Reply reply{};
  if (!transfer(response_read.value, &reply, sizeof reply, false) ||
      reply.magic != 0x31524c46)
    return ERROR_INVALID_DATA;
  if (reply.error) {
    uncertain = reply.started != 0;
    return reply.error;
  }
  if (!reply.started || !reply.pid || !reply.process)
    return ERROR_INVALID_DATA;
  process = reinterpret_cast<HANDLE>(static_cast<uintptr_t>(reply.process));
  process_id = reply.pid;
  if (GetProcessId(process) != process_id)
    return ERROR_INVALID_HANDLE;
  uncertain = false;
  return ERROR_SUCCESS;
}
} // namespace layerfs
