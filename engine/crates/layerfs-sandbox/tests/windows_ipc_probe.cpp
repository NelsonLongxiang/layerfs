// External observer of the exact Windows APIs used by libuv IPC stdio setup.
// No product headers, token/ACL changes, failed-call retries or process launch.
#define NOMINMAX
#include <aclapi.h>
#include <cstdio>
#include <sddl.h>
#include <vector>
#include <windows.h>
static void stage(const char *api, bool ok, DWORD error) {
  printf("IPC_STAGE api=%s ok=%u win32=%lu\n", api, unsigned(ok), error);
  fflush(stdout);
}
int main() {
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
    stage("OpenProcessToken", false, GetLastError());
    return 7;
  }
  DWORD n = 0;
  GetTokenInformation(token, TokenIntegrityLevel, nullptr, 0, &n);
  std::vector<BYTE> info(n);
  if (!GetTokenInformation(token, TokenIntegrityLevel, info.data(), n, &n)) {
    stage("GetTokenInformation", false, GetLastError());
    CloseHandle(token);
    return 7;
  }
  auto sid = reinterpret_cast<TOKEN_MANDATORY_LABEL *>(info.data())->Label.Sid;
  printf("IPC_TOKEN restricted=%u integrity=%lu\n",
         unsigned(IsTokenRestricted(token)),
         *GetSidSubAuthority(sid, *GetSidSubAuthorityCount(sid) - 1));
  n = 0;
  GetTokenInformation(token, TokenDefaultDacl, nullptr, 0, &n);
  std::vector<BYTE> defaults(n);
  if (GetTokenInformation(token, TokenDefaultDacl, defaults.data(), n, &n)) {
    SECURITY_DESCRIPTOR descriptor{};
    InitializeSecurityDescriptor(&descriptor, SECURITY_DESCRIPTOR_REVISION);
    SetSecurityDescriptorDacl(
        &descriptor, TRUE,
        reinterpret_cast<TOKEN_DEFAULT_DACL *>(defaults.data())->DefaultDacl,
        FALSE);
    LPSTR text = nullptr;
    if (ConvertSecurityDescriptorToStringSecurityDescriptorA(
            &descriptor, SDDL_REVISION_1, DACL_SECURITY_INFORMATION, &text,
            nullptr)) {
      printf("IPC_TOKEN_DEFAULT %s\n", text);
      LocalFree(text);
    }
  }
  CloseHandle(token);
  auto port = CreateIoCompletionPort(INVALID_HANDLE_VALUE, nullptr, 0, 1);
  DWORD error = port ? 0 : GetLastError();
  stage("CreateIoCompletionPort_loop", port != nullptr, error);
  if (!port)
    return 7;
  char name[96];
  snprintf(name, sizeof name, "\\\\?\\pipe\\uv\\%llu-%lu",
           static_cast<unsigned long long>(reinterpret_cast<ULONG_PTR>(&port)),
           GetCurrentProcessId());
  auto server =
      CreateNamedPipeA(name,
                       PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | WRITE_DAC |
                           FILE_FLAG_FIRST_PIPE_INSTANCE,
                       PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT, 1,
                       65536, 65536, 0, nullptr);
  error = server != INVALID_HANDLE_VALUE ? 0 : GetLastError();
  stage("CreateNamedPipeA_server", server != INVALID_HANDLE_VALUE, error);
  if (server == INVALID_HANDLE_VALUE) {
    CloseHandle(port);
    return 7;
  }
  for (const auto flags :
       {OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
        LABEL_SECURITY_INFORMATION}) {
    PSECURITY_DESCRIPTOR security = nullptr;
    auto queried = GetSecurityInfo(server, SE_KERNEL_OBJECT, flags, nullptr,
                                   nullptr, nullptr, nullptr, &security);
    printf("IPC_SECURITY flags=%lu query=%lu\n", DWORD(flags), queried);
    if (queried == ERROR_SUCCESS) {
      LPSTR text = nullptr;
      if (ConvertSecurityDescriptorToStringSecurityDescriptorA(
              security, SDDL_REVISION_1, flags, &text, nullptr)) {
        printf("IPC_DESCRIPTOR %s\n", text);
        LocalFree(text);
      }
      LocalFree(security);
    }
  }
  SECURITY_ATTRIBUTES sa{sizeof sa, nullptr, TRUE};
  auto client = CreateFileA(name, GENERIC_READ | GENERIC_WRITE | WRITE_DAC, 0,
                            &sa, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr);
  error = client != INVALID_HANDLE_VALUE ? 0 : GetLastError();
  stage("CreateFileA_client", client != INVALID_HANDLE_VALUE, error);
  if (client == INVALID_HANDLE_VALUE) {
    CloseHandle(server);
    CloseHandle(port);
    return 7;
  }
  BOOL connected = ConnectNamedPipe(server, nullptr);
  error = connected ? 0 : GetLastError();
  stage("ConnectNamedPipe", connected || error == ERROR_PIPE_CONNECTED, error);
  if (connected || error == ERROR_PIPE_CONNECTED) {
    auto associated = CreateIoCompletionPort(server, port, 1, 0);
    error = associated ? 0 : GetLastError();
    stage("CreateIoCompletionPort_associate", associated != nullptr, error);
  }
  CloseHandle(client);
  CloseHandle(server);
  CloseHandle(port);
  return 7; // Observation is complete; individual original stage outcomes
            // remain explicit.
}
