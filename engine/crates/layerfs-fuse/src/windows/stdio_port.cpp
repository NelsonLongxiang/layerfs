// Native Workspace calls on private inherited anonymous streams, never a
// listener.
#define NOMINMAX
#include "stdio_port.hpp"
#include <cstring>
#include <thread>
namespace layerfs {
namespace {
constexpr size_t window = 262144;
StdioPort *provider = nullptr; // One declared filesystem provider per process.
void u32(Bytes &b, UINT32 n) {
  for (int i = 0; i < 4; ++i)
    b.push_back(static_cast<BYTE>(n >> (i * 8)));
}
void u64(Bytes &b, UINT64 n) {
  for (int i = 0; i < 8; ++i)
    b.push_back(static_cast<BYTE>(n >> (i * 8)));
}
struct Fields {
  const Bytes &b;
  size_t at = 0;
  bool valid = true;
  UINT32 n32() {
    if (b.size() - at < 4) {
      valid = false;
      return 0;
    }
    UINT32 n = 0;
    for (int i = 0; i < 4; ++i)
      n |= static_cast<UINT32>(b[at++]) << (i * 8);
    return n;
  }
  UINT64 n64() {
    auto lo = n32();
    auto hi = n32();
    return lo | (static_cast<UINT64>(hi) << 32);
  }
  bool end() const { return valid && at == b.size(); }
  bool stat(WorkspaceStat *s) {
    if (b.size() - at < 40) {
      valid = false;
      return false;
    }
    s->serial = n64();
    s->size = n64();
    s->mtime = static_cast<INT64>(n64());
    s->nanos = n32();
    s->mode = n32();
    s->directory = n32();
    s->attributes = n32();
    return true;
  }
};
bool transfer(HANDLE file, void *memory, size_t size, bool write) {
  auto p = static_cast<BYTE *>(memory);
  while (size) {
    DWORD done = 0;
    const auto n = static_cast<DWORD>(size);
    BOOL ok = write ? WriteFile(file, p, n, &done, nullptr)
                    : ReadFile(file, p, n, &done, nullptr);
    if (!ok || done == 0)
      return false;
    p += done;
    size -= done;
  }
  return true;
}
bool path(Bytes &b, PCWSTR p, UINT32 length) {
  if (length > 32768 || (!p && length))
    return false;
  u32(b, length);
  for (UINT32 i = 0; i < length; ++i) {
    b.push_back(static_cast<BYTE>(p[i]));
    b.push_back(static_cast<BYTE>(p[i] >> 8));
  }
  return true;
}
} // namespace
void StdioPort::poison() {
  std::lock_guard<std::mutex> lock(mutex_);
  lost_ = true;
  changed_.notify_all();
}
bool StdioPort::send(UINT64 id, UINT32 opcode, const Bytes &body) {
  if (body.size() > window)
    return false;
  Bytes frame{'L', 'F', 'S', 'R', 'P', 'C', '0', '1'};
  u64(frame, id);
  u32(frame, opcode);
  u32(frame, static_cast<UINT32>(body.size()));
  frame.insert(frame.end(), body.begin(), body.end());
  std::lock_guard<std::mutex> write(write_);
  return transfer(GetStdHandle(STD_OUTPUT_HANDLE), frame.data(), frame.size(),
                  true);
}
bool StdioPort::event(UINT32 opcode, const Bytes &body) {
  if (send(0, opcode, body))
    return true;
  poison();
  return false;
}
void StdioPort::start() {
  auto self = shared_from_this();
  std::thread([self] { self->receive(); }).detach();
}
void StdioPort::receive() {
  for (;;) {
    Bytes header(24);
    if (!transfer(GetStdHandle(STD_INPUT_HANDLE), header.data(), header.size(),
                  false)) {
      poison();
      return;
    }
    if (memcmp(header.data(), "LFSRPC01", 8)) {
      poison();
      return;
    }
    Fields h{header, 8};
    const auto id = h.n64();
    const auto opcode = h.n32();
    const auto size = h.n32();
    if (size > window) {
      poison();
      return;
    }
    Bytes body(size);
    if (size &&
        !transfer(GetStdHandle(STD_INPUT_HANDLE), body.data(), size, false)) {
      poison();
      return;
    }
    std::lock_guard<std::mutex> lock(mutex_);
    if (id == 0 && opcode == 100 && body.empty() && !stop_) {
      stop_ = true;
      changed_.notify_all();
      continue;
    }
    if (!pending_ || id != next_ || opcode != (opcode_ | 0x80000000u) ||
        !answer_.empty()) {
      lost_ = true;
      changed_.notify_all();
      return;
    }
    answer_ = std::move(body);
    pending_ = false;
    changed_.notify_all();
  }
}
NTSTATUS StdioPort::exchange(UINT32 opcode, const Bytes &input, Bytes &output) {
  std::lock_guard<std::mutex> operation(operation_);
  UINT64 id;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (lost_)
      return STATUS_UNSUCCESSFUL;
    if (next_ == UINT64_MAX) {
      lost_ = true;
      return STATUS_UNSUCCESSFUL;
    }
    id = ++next_;
    opcode_ = opcode;
    answer_.clear();
    pending_ = true;
  }
  if (!send(id, opcode, input)) {
    poison();
    return STATUS_UNSUCCESSFUL;
  }
  std::unique_lock<std::mutex> lock(mutex_);
  changed_.wait(lock, [&] { return lost_ || !pending_; });
  if (lost_)
    return STATUS_UNSUCCESSFUL;
  Fields fields{answer_};
  auto status = static_cast<NTSTATUS>(fields.n32());
  if (!fields.valid) {
    lost_ = true;
    changed_.notify_all();
    return STATUS_UNSUCCESSFUL;
  }
  output.assign(answer_.begin() + 4, answer_.end());
  answer_.clear();
  if (status == STATUS_UNSUCCESSFUL) {
    lost_ = true;
    changed_.notify_all();
  }
  return status;
}
NTSTATUS StdioPort::control(UINT32 op) {
  Bytes output;
  auto status = exchange(op, {}, output);
  if (!output.empty()) {
    poison();
    return STATUS_UNSUCCESSFUL;
  }
  return status;
}
bool StdioPort::wait_stop() {
  std::unique_lock<std::mutex> lock(mutex_);
  changed_.wait(lock, [&] { return lost_ || stop_; });
  if (lost_)
    return false;
  stop_ = false;
  return true;
}
// Validate every reply before exposing it to a WinFsp-owned output buffer.
NTSTATUS exchange(UINT32 op, const Bytes &in, Bytes &out) {
  return provider->exchange(op, in, out);
}
NTSTATUS stat_reply(UINT32 op, const Bytes &in, WorkspaceStat *s) {
  Bytes out;
  auto status = exchange(op, in, out);
  if (status < 0)
    return status;
  Fields f{out};
  if (!f.stat(s) || !f.end()) {
    provider->poison();
    return STATUS_UNSUCCESSFUL;
  }
  return status;
}
INT32 __cdecl stat_call(PCWSTR p, UINT32 n, WorkspaceStat *s) {
  Bytes in;
  if (!path(in, p, n))
    return STATUS_INVALID_PARAMETER;
  return stat_reply(1, in, s);
}
INT32 __cdecl open_call(PCWSTR p, UINT32 n, UINT32 create, UINT32 access,
                        UINT64 *h, WorkspaceStat *s) {
  if (create)
    return STATUS_INVALID_PARAMETER;
  Bytes in, out;
  if (!path(in, p, n))
    return STATUS_INVALID_PARAMETER;
  u32(in, access);
  auto status = exchange(2, in, out);
  if (status < 0)
    return status;
  Fields f{out};
  *h = f.n64();
  if (!f.stat(s) || !f.end()) {
    provider->poison();
    return STATUS_UNSUCCESSFUL;
  }
  return status;
}
INT32 __cdecl info_call(UINT64 h, WorkspaceStat *s) {
  Bytes in;
  u64(in, h);
  return stat_reply(3, in, s);
}
INT32 __cdecl create_call(PCWSTR p, UINT32 n, UINT32 dir, UINT32 access,
                          UINT32 attrs, UINT64 *h, WorkspaceStat *s) {
  Bytes in, out;
  if (!path(in, p, n))
    return STATUS_INVALID_PARAMETER;
  u32(in, dir);
  u32(in, access);
  u32(in, attrs);
  auto status = exchange(4, in, out);
  if (status < 0)
    return status;
  Fields f{out};
  *h = f.n64();
  if (!f.stat(s) || !f.end()) {
    provider->poison();
    return STATUS_UNSUCCESSFUL;
  }
  return status;
}
INT32 __cdecl read_call(UINT64 h, UINT64 offset, PVOID buffer, UINT32 size,
                        UINT32 *count) {
  Bytes in, out;
  u64(in, h);
  u64(in, offset);
  u32(in, size);
  auto status = exchange(5, in, out);
  if (status < 0)
    return status;
  Fields f{out};
  *count = f.n32();
  if (!f.valid || *count > size || out.size() - f.at != *count) {
    provider->poison();
    return STATUS_UNSUCCESSFUL;
  }
  memcpy(buffer, out.data() + f.at, *count);
  return status;
}
INT32 __cdecl write_call(UINT64 h, UINT64 offset, PVOID buffer, UINT32 size,
                         UINT32 flags, WorkspaceStat *s) {
  if (size > 131072)
    return STATUS_INVALID_PARAMETER;
  Bytes in;
  u64(in, h);
  u64(in, offset);
  u32(in, flags);
  u32(in, size);
  auto p = static_cast<BYTE *>(buffer);
  in.insert(in.end(), p, p + size);
  return stat_reply(6, in, s);
}
INT32 __cdecl resize_call(UINT64 h, UINT64 size, WorkspaceStat *s) {
  Bytes in;
  u64(in, h);
  u64(in, size);
  return stat_reply(7, in, s);
}
INT32 __cdecl overwrite_call(UINT64 h, UINT32 attrs, UINT32 replace,
                             WorkspaceStat *s) {
  Bytes in;
  u64(in, h);
  u32(in, attrs);
  u32(in, replace);
  return stat_reply(8, in, s);
}
INT32 __cdecl basic_call(UINT64 h, UINT32 attrs, UINT64 a, UINT64 b, UINT64 c,
                         UINT64 d, WorkspaceStat *s) {
  Bytes in;
  u64(in, h);
  u32(in, attrs);
  for (auto t : {a, b, c, d})
    u64(in, t);
  return stat_reply(9, in, s);
}
NTSTATUS empty_reply(UINT32 op, const Bytes &in) {
  Bytes out;
  auto s = exchange(op, in, out);
  if (s >= 0 && !out.empty()) {
    provider->poison();
    return STATUS_UNSUCCESSFUL;
  }
  return s;
}
INT32 __cdecl rename_call(PCWSTR a, UINT32 an, PCWSTR b, UINT32 bn,
                          UINT32 replace) {
  Bytes in;
  if (!path(in, a, an) || !path(in, b, bn))
    return STATUS_INVALID_PARAMETER;
  u32(in, replace);
  return empty_reply(10, in);
}
INT32 __cdecl can_delete_call(PCWSTR p, UINT32 n) {
  Bytes in;
  if (!path(in, p, n))
    return STATUS_INVALID_PARAMETER;
  return empty_reply(11, in);
}
INT32 __cdecl dot_call(UINT64 h, UINT32 parent, UINT32 *found,
                       WorkspaceStat *s) {
  Bytes in, out;
  u64(in, h);
  u32(in, parent);
  auto status = exchange(12, in, out);
  if (status < 0)
    return status;
  Fields f{out};
  *found = f.n32();
  if (*found > 1 || (*found && !f.stat(s)) || !f.end()) {
    provider->poison();
    return STATUS_UNSUCCESSFUL;
  }
  return status;
}
INT32 __cdecl unlink_call(PCWSTR p, UINT32 n) {
  Bytes in;
  if (!path(in, p, n))
    return STATUS_INVALID_PARAMETER;
  return empty_reply(13, in);
}
INT32 __cdecl close_call(UINT64 h) {
  Bytes in;
  u64(in, h);
  return empty_reply(14, in);
}
INT32 __cdecl next_call(UINT64 h, PCWSTR after, UINT32 n, PWSTR name,
                        UINT32 capacity, UINT32 *length, WorkspaceStat *s) {
  Bytes in, out;
  u64(in, h);
  if (!path(in, after, n))
    return STATUS_INVALID_PARAMETER;
  auto status = exchange(15, in, out);
  if (status < 0)
    return status;
  Fields f{out};
  *length = f.n32();
  if (!f.valid || *length > capacity || *length > 255 ||
      out.size() - f.at < *length * 2) {
    provider->poison();
    return STATUS_UNSUCCESSFUL;
  }
  for (UINT32 i = 0; i < *length; ++i) {
    name[i] = static_cast<WCHAR>(out[f.at] |
                                 (static_cast<UINT16>(out[f.at + 1]) << 8));
    f.at += 2;
  }
  if ((*length && !f.stat(s)) || !f.end()) {
    provider->poison();
    return STATUS_UNSUCCESSFUL;
  }
  return status;
}
INT32 __cdecl cleanup_call(UINT64 h) {
  Bytes in;
  u64(in, h);
  return empty_reply(16, in);
}
WorkspacePort StdioPort::port() {
  provider = this;
  WorkspacePort p;
  p.stat = stat_call;
  p.open = open_call;
  p.info = info_call;
  p.create = create_call;
  p.read = read_call;
  p.write = write_call;
  p.resize = resize_call;
  p.overwrite = overwrite_call;
  p.basic_info = basic_call;
  p.rename = rename_call;
  p.can_delete = can_delete_call;
  p.dot = dot_call;
  p.unlink = unlink_call;
  p.close = close_call;
  p.next = next_call;
  p.cleanup = cleanup_call;
  return p;
}
} // namespace layerfs
