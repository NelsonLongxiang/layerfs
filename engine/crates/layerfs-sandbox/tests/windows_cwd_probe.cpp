// Public Windows path normalization used by Git for Windows getcwd/chdir.
// Read-only external observer, no product/private source or ACL/token changes.
#define NOMINMAX
#include <cstdio>
#include <string>
#include <windows.h>
static void result(const char *api, DWORD count, DWORD error, PCWSTR text) {
  printf("CWD_STAGE api=%s count=%lu win32=%lu", api, count, error);
  if (count && text) {
    printf(" path=");
    for (auto p = text; *p; ++p)
      putchar(*p < 128 ? static_cast<char>(*p) : '?');
  }
  putchar('\n');
  fflush(stdout);
}
static void inspect(PCWSTR path) {
  auto h = CreateFileW(
      path, 0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
      OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
  DWORD error = h == INVALID_HANDLE_VALUE ? GetLastError() : 0;
  result("CreateFileW", h == INVALID_HANDLE_VALUE ? 0 : 1, error, path);
  if (h != INVALID_HANDLE_VALUE) {
    struct Query {
      const char *name;
      DWORD flags;
    };
    for (const auto &q :
         {Query{"final_dos_normal", VOLUME_NAME_DOS | FILE_NAME_NORMALIZED},
          Query{"final_dos_opened", VOLUME_NAME_DOS | FILE_NAME_OPENED},
          Query{"final_nt_normal", VOLUME_NAME_NT | FILE_NAME_NORMALIZED},
          Query{"final_none_normal",
                VOLUME_NAME_NONE | FILE_NAME_NORMALIZED}}) {
      WCHAR answer[32768]{};
      SetLastError(0);
      DWORD n = GetFinalPathNameByHandleW(h, answer, 32768, q.flags);
      result(q.name, n, n ? 0 : GetLastError(), answer);
    }
    CloseHandle(h);
  }
  WCHAR answer[32768]{};
  SetLastError(0);
  auto n = GetLongPathNameW(path, answer, 32768);
  result("GetLongPathNameW", n, n ? 0 : GetLastError(), answer);
}
int wmain(int argc, wchar_t **argv) {
  WCHAR cwd[32768]{};
  auto n = GetCurrentDirectoryW(32768, cwd);
  result("GetCurrentDirectoryW", n, n ? 0 : GetLastError(), cwd);
  if (!n)
    return 7;
  inspect(cwd);
  if (argc == 2) {
    BOOL ok = SetCurrentDirectoryW(argv[1]);
    result("SetCurrentDirectoryW_repo", ok ? 1 : 0, ok ? 0 : GetLastError(),
           argv[1]);
    if (ok)
      inspect(argv[1]);
  }
  return 7;
}
