// Public Win32 consumer: keep only a read-only view, not a file or mapping
// handle.
#define NOMINMAX
#include <cstdio>
#include <windows.h>
int wmain(int argc, wchar_t **argv) {
  if (argc != 2)
    return 2;
  auto file =
      CreateFileW(argv[1], GENERIC_READ,
                  FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                  nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE)
    return 3;
  auto mapping =
      CreateFileMappingW(file, nullptr, PAGE_READONLY, 0, 0, nullptr);
  if (!mapping)
    return 4;
  const auto view = static_cast<const volatile BYTE *>(
      MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 0));
  if (!view)
    return 5;
  if (!CloseHandle(mapping) || !CloseHandle(file))
    return 6;
  const auto expected = view[0];
  printf("SECTION_READY readonly=true file_closed=true mapping_closed=true "
         "byte=%u\n",
         static_cast<unsigned>(expected));
  fflush(stdout);
  const auto deadline = GetTickCount64() + 30000;
  for (;;) {
    DWORD available = 0;
    if (!PeekNamedPipe(GetStdHandle(STD_INPUT_HANDLE), nullptr, 0, nullptr,
                       &available, nullptr))
      return 7;
    if (available) {
      char c;
      DWORD done = 0;
      if (!ReadFile(GetStdHandle(STD_INPUT_HANDLE), &c, 1, &done, nullptr) ||
          done != 1)
        return 8;
      if (c == 'p') {
        const auto observed = view[0];
        if (observed != expected)
          return 9;
        printf("SECTION_READ byte=%u still_mapped=true\n",
               static_cast<unsigned>(observed));
        fflush(stdout);
      } else if (c == 'x') {
        if (!UnmapViewOfFile(const_cast<const BYTE *>(view)))
          return 10;
        puts("SECTION_RELEASED original_view_unmapped=true");
        return 0;
      }
    }
    if (GetTickCount64() >= deadline)
      return 11;
    Sleep(5);
  }
}
