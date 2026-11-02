// Cache invalidation can request release, but only original Close receipts
// count.
#define NOMINMAX
#include "close.hpp"
#include "callbacks.hpp"
#include "mount.hpp"
#include "stdio_port.hpp"
#include <string>
namespace layerfs {
namespace {
void append(Bytes &out, UINT64 value) {
  for (unsigned i = 0; i < 8; ++i)
    out.push_back(static_cast<BYTE>(value >> (i * 8)));
}
UINT64 number(const Bytes &in, size_t at, size_t width) {
  UINT64 n = 0;
  for (size_t i = 0; i < width; ++i)
    n |= static_cast<UINT64>(in[at + i]) << (8 * i);
  return n;
}
} // namespace
NTSTATUS coordinate_close(StdioPort &channel, WinFspMount &mount,
                          WorkspaceCallbacks &callbacks) {
  Bytes out;
  auto status = channel.exchange(22, {}, out);
  if (status < 0)
    return status;
  if (out.size() != 8 || number(out, 0, 8) == 0) {
    channel.poison();
    return STATUS_UNSUCCESSFUL;
  }
  const auto token = number(out, 0, 8);
  const auto deadline = GetTickCount64() + 10000;
  auto end = [&](bool prepare) {
    Bytes input;
    append(input, token);
    input.push_back(prepare ? 1 : 0);
    input.insert(input.end(), 3, 0);
    Bytes reply;
    const auto s = channel.exchange(24, input, reply);
    if (!reply.empty()) {
      channel.poison();
      return STATUS_UNSUCCESSFUL;
    }
    return s;
  };
  auto abort = [&](NTSTATUS cause) {
    // Lost/unknown transfer is retained; a second request cannot guess
    // recovery.
    if (cause == STATUS_UNSUCCESSFUL)
      return cause;
    const auto restored = end(false);
    return restored < 0 ? restored : cause;
  };
  UINT64 after = 0;
  for (;;) {
    Bytes input;
    append(input, token);
    append(input, after);
    status = channel.exchange(23, input, out);
    if (status < 0)
      return abort(status);
    if (out.size() < 20) {
      channel.poison();
      return STATUS_UNSUCCESSFUL;
    }
    const auto held = number(out, 0, 8), serial = number(out, 8, 8);
    const auto length = number(out, 16, 4);
    if (length > 32768 || out.size() != 20 + length * 2 ||
        (held == 0
             ? serial != 0 || length != 0
             : held <= after || held >= token || serial == 0 || !length)) {
      channel.poison();
      return STATUS_UNSUCCESSFUL;
    }
    if (held == 0)
      break;
    if (GetTickCount64() >= deadline)
      return abort(STATUS_DEVICE_BUSY);
    std::wstring path;
    path.reserve(static_cast<size_t>(length));
    for (size_t i = 0; i < length; ++i)
      path.push_back(static_cast<WCHAR>(number(out, 20 + i * 2, 2)));
    status =
        mount.invalidate_clean_file(path.data(), static_cast<UINT32>(length));
    if (status < 0)
      return abort(status);
    after =
        held; // Each original candidate is invalidated once, never reopened.
  }
  Bytes input;
  append(input, token);
  for (;;) {
    status = channel.exchange(25, input, out);
    if (status < 0)
      return abort(status);
    if (out.size() != 16) {
      channel.poison();
      return STATUS_UNSUCCESSFUL;
    }
    if (number(out, 0, 8) == 0 && number(out, 8, 8) == 0 &&
        callbacks.callbacks_idle())
      return end(true);
    if (GetTickCount64() >= deadline)
      return abort(STATUS_DEVICE_BUSY);
    if (callbacks.callback_failure() < 0)
      return STATUS_UNSUCCESSFUL;
    Sleep(
        5); // Original callback completion readiness, not another invalidation.
  }
}
} // namespace layerfs
