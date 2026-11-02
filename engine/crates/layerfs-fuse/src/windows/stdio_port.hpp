// One private inherited stdin/stdout channel per native mount process.
#pragma once
#include "workspace_port.hpp"
#include <condition_variable>
#include <memory>
#include <mutex>
#include <vector>
namespace layerfs {
using Bytes = std::vector<BYTE>;
class StdioPort final : public std::enable_shared_from_this<StdioPort> {
public:
  void start();
  WorkspacePort port();
  NTSTATUS control(UINT32 opcode);
  bool wait_stop();
  bool event(UINT32 opcode, const Bytes &body);
  void poison();
  NTSTATUS exchange(UINT32 opcode, const Bytes &, Bytes &);

private:
  void receive();
  bool send(UINT64 id, UINT32 opcode, const Bytes &body);
  std::mutex mutex_, write_, operation_;
  std::condition_variable changed_;
  bool lost_ = false, pending_ = false, stop_ = false;
  UINT64 next_ = 0;
  UINT32 opcode_ = 0;
  Bytes answer_;
};
} // namespace layerfs
