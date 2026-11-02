// A live native execution context is acknowledged before any mount is admitted.
// No Store RPC, command supervisor, image claim, reconnect or process kill.
#include "instance.hpp"
#include <cstdio>
#include <io.h>
#include <sstream>
namespace {
bool send(const std::string &s) {
  DWORD n = 0;
  return WriteFile(GetStdHandle(STD_OUTPUT_HANDLE), s.data(),
                   static_cast<DWORD>(s.size()), &n, nullptr) &&
         n == s.size();
}
bool number(const std::string &text, unsigned long long &value) {
  if (text.empty() || text[0] == '0')
    return false;
  value = 0;
  for (auto c : text) {
    if (c < '0' || c > '9' || value > (ULLONG_MAX - (c - '0')) / 10)
      return false;
    value = value * 10 + (c - '0');
  }
  return true;
}
DWORD private_directory(PCWSTR path) {
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token))
    return GetLastError();
  DWORD n = 0;
  GetTokenInformation(token, TokenUser, nullptr, 0, &n);
  std::vector<BYTE> bytes(n);
  BOOL ok = GetTokenInformation(token, TokenUser, bytes.data(), n, &n);
  DWORD error = ok ? ERROR_SUCCESS : GetLastError();
  CloseHandle(token);
  if (error)
    return error;
  PWSTR user = nullptr;
  if (!ConvertSidToStringSidW(
          reinterpret_cast<TOKEN_USER *>(bytes.data())->User.Sid, &user))
    return GetLastError();
  std::wstring sddl = L"D:P(A;;FA;;;" + std::wstring(user) + L")";
  LocalFree(user);
  PSECURITY_DESCRIPTOR security = nullptr;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
          sddl.c_str(), SDDL_REVISION_1, &security, nullptr))
    return GetLastError();
  SECURITY_ATTRIBUTES sa{sizeof sa, security, FALSE};
  ok = CreateDirectoryW(path, &sa);
  error = ok ? ERROR_SUCCESS : GetLastError();
  LocalFree(security);
  return error;
}

} // namespace
namespace layerfs {
int run_instance(PCWSTR sid, PCWSTR work) {
  unsigned long long close_id = 0;
  {
    RestrictedIdentity identity;
    DWORD error = private_directory(work);
    if (!error)
      error = identity.create(sid);
    if (error) {
      send("LFS_INSTANCE_FAILED win32=" + std::to_string(error) + "\n");
      return 1;
    }
    FILETIME created{}, exited{}, kernel{}, user{};
    if (!GetProcessTimes(GetCurrentProcess(), &created, &exited, &kernel,
                         &user))
      return 1;
    unsigned long long stamp =
        (static_cast<unsigned long long>(created.dwHighDateTime) << 32) |
        created.dwLowDateTime;
    if (!send("LFS_INSTANCE_READY pid=" +
              std::to_string(GetCurrentProcessId()) + " created=" +
              std::to_string(stamp) + " restricted=true integrity=low\n"))
      return 1;
    unsigned long long previous = 0;
    for (;;) {
      char line[129];
      size_t used = 0;
      DWORD read = 0;
      char byte = 0;
      while (
          used < 128 &&
          ReadFile(GetStdHandle(STD_INPUT_HANDLE), &byte, 1, &read, nullptr) &&
          read) {
        if (!byte || static_cast<unsigned char>(byte) > 127)
          return 1;
        line[used++] = byte;
        if (byte == '\n')
          break;
      }
      if (!used || byte != '\n')
        return 1; // EOF is not acknowledged close.
      line[used] = 0;
      unsigned long long id = 0, request = 0, response = 0;
      std::string id_text, action, request_text, response_text;
      std::istringstream fields(line);
      if (!(fields >> id_text >> action) || !number(id_text, id) ||
          id <= previous)
        return 1;
      previous = id;
      if (action == "launch") {
        if (!(fields >> request_text >> response_text) ||
            !number(request_text, request) || !number(response_text, response))
          return 1;
        fields >> std::ws;
        if (!fields.eof())
          return 1;
        int outcome = launch_owned(
            identity, reinterpret_cast<HANDLE>(static_cast<uintptr_t>(request)),
            reinterpret_cast<HANDLE>(static_cast<uintptr_t>(response)));
        if (outcome < 0) {
          send("LFS_INSTANCE_FAILED win32=6\n");
          return 1;
        }
        if (!send("LFS_INSTANCE_LAUNCHED id=" + std::to_string(id) +
                  " outcome=" + (outcome ? "transferred\n" : "refused\n")))
          return 1;
        continue;
      }
      fields >> std::ws;
      if (!fields.eof())
        return 1;
      if (action == "close") {
        close_id = id;
        break;
      }
      if (action != "status" || !IsTokenRestricted(identity.token))
        return 1;
      if (!send("LFS_INSTANCE_STATUS id=" + std::to_string(id) +
                " restricted=true integrity=low\n"))
        return 1;
    }
    DWORD closed = identity.close_owned();
    if (closed) {
      send("LFS_INSTANCE_FAILED win32=" + std::to_string(closed) + "\n");
      return 1;
    }
  } // Only checked original-handle release permits the terminal receipt.
  return send("LFS_INSTANCE_CLOSED id=" + std::to_string(close_id) +
              " token_closed=true desktop_closed=true\n")
             ? 0
             : 1;
}
} // namespace layerfs
