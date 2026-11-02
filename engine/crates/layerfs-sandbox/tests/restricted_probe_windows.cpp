// External restricted-token observation, never a product launch selector.
#define NOMINMAX
#include <windows.h>

#include <bcrypt.h>
#include <cstdio>
#include <sddl.h>
#include <tlhelp32.h>
#include <vector>
int wmain(int argc, wchar_t **argv) {
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token))
    return 2;
  DWORD size = 0;
  GetTokenInformation(token, TokenIntegrityLevel, nullptr, 0, &size);
  std::vector<BYTE> label(size);
  if (!GetTokenInformation(token, TokenIntegrityLevel, label.data(), size,
                           &size))
    return 2;
  auto sid = reinterpret_cast<TOKEN_MANDATORY_LABEL *>(label.data())->Label.Sid;
  DWORD integrity = *GetSidSubAuthority(sid, *GetSidSubAuthorityCount(sid) - 1);
  BYTE bytes[16];
  auto rng = BCryptGenRandom(nullptr, bytes, sizeof bytes,
                             BCRYPT_USE_SYSTEM_PREFERRED_RNG);
  using Rtl = BOOLEAN(WINAPI *)(PVOID, ULONG);
  auto dll = LoadLibraryW(L"advapi32.dll");
  auto rtl = reinterpret_cast<Rtl>(GetProcAddress(dll, "SystemFunction036"));
  SetLastError(0);
  BOOL rtl_ok = rtl && rtl(bytes, sizeof bytes);
  DWORD rtl_error = GetLastError();
  printf(
      "TOKEN restricted=%d integrity=%lu bcrypt=%08lx rtl=%d rtl_error=%lu\n",
      IsTokenRestricted(token), integrity, static_cast<ULONG>(rng), rtl_ok,
      rtl_error);
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  PROCESSENTRY32W entry{};
  entry.dwSize = sizeof entry;
  DWORD parent = 0;
  if (snapshot != INVALID_HANDLE_VALUE && Process32FirstW(snapshot, &entry)) {
    do {
      if (entry.th32ProcessID == GetCurrentProcessId()) {
        parent = entry.th32ParentProcessID;
        break;
      }
    } while (Process32NextW(snapshot, &entry));
  }
  if (snapshot != INVALID_HANDLE_VALUE)
    CloseHandle(snapshot);
  HANDLE launcher =
      parent ? OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, FALSE,
                           parent)
             : nullptr;
  printf("LAUNCHER allowed=%d error=%lu\n", launcher != nullptr,
         launcher ? 0 : GetLastError());
  if (launcher)
    CloseHandle(launcher);
  HANDLE limited =
      parent ? OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, parent)
             : nullptr;
  HANDLE parent_token = nullptr;
  BOOL duplicated =
      limited &&
      OpenProcessToken(limited,
                       TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY | TOKEN_QUERY,
                       &parent_token);
  printf("LAUNCHER_TOKEN allowed=%d error=%lu\n", duplicated,
         duplicated ? 0 : GetLastError());
  if (parent_token)
    CloseHandle(parent_token);
  if (limited)
    CloseHandle(limited);
  WCHAR desktop_name[256];
  DWORD desktop_size = sizeof desktop_name;
  if (!GetUserObjectInformationW(GetThreadDesktop(GetCurrentThreadId()),
                                 UOI_NAME, desktop_name, sizeof desktop_name,
                                 &desktop_size))
    return 2;
  printf("DESKTOP ");
  for (auto p = desktop_name; *p; ++p)
    putchar(static_cast<char>(*p));
  putchar('\n');
  for (int i = 1; i < argc; ++i) {
    if (!wcscmp(argv[i], L"--process") && i + 1 < argc) {
      auto pid = wcstoul(argv[++i], nullptr, 10);
      auto owner =
          OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, FALSE, pid);
      printf("PROCESS allowed=%d error=%lu\n", owner != nullptr,
             owner ? 0 : GetLastError());
      if (owner)
        CloseHandle(owner);
      HANDLE inspect =
          OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
      HANDLE original_token = nullptr;
      BOOL duplicate =
          inspect &&
          OpenProcessToken(inspect,
                           TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY | TOKEN_QUERY,
                           &original_token);
      printf("PROCESS_TOKEN allowed=%d error=%lu\n", duplicate,
             duplicate ? 0 : GetLastError());
      if (original_token)
        CloseHandle(original_token);
      if (inspect)
        CloseHandle(inspect);
      continue;
    }
    auto file =
        CreateFileW(argv[i], GENERIC_READ,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                    nullptr, OPEN_EXISTING, 0, nullptr);
    printf("READ index=%d allowed=%d error=%lu\n", i,
           file != INVALID_HANDLE_VALUE,
           file == INVALID_HANDLE_VALUE ? GetLastError() : 0);
    if (file != INVALID_HANDLE_VALUE)
      CloseHandle(file);
    auto alter =
        CreateFileW(argv[i], WRITE_DAC | WRITE_OWNER,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                    nullptr, OPEN_EXISTING, 0, nullptr);
    printf("ALTER index=%d allowed=%d error=%lu\n", i,
           alter != INVALID_HANDLE_VALUE,
           alter == INVALID_HANDLE_VALUE ? GetLastError() : 0);
    if (alter != INVALID_HANDLE_VALUE)
      CloseHandle(alter);
  }
  CloseHandle(token);
  FreeLibrary(dll);
  return 7;
}
