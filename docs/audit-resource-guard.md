# 本地 Node 核验资源保护

`scripts/audit_guard.py` 是 Linux 本地诊断脚本的前台启动器，不是常驻服务，也不改变 Cindy 或插件的全局资源设置。适用于经人工确认需要执行的只读核验；资源限制不授予读取或写入资料的权限。

```sh
python3 scripts/audit_guard.py /absolute/path/to/audit.cjs
```

依赖 Python 3、Node、用户级 systemd 和 cgroup v2。启动器先验证实际内核限制，再运行目标；缺少条件时拒绝启动，不降级为无保护运行。

| 默认限制 | 行为 |
| --- | --- |
| 整个 cgroup 内存 512 MiB | 包含 Node 堆、Buffer、子进程；不是单独 RSS 的精确上限 |
| swap 0 | 核验进程组不能通过换出继续扩张 |
| Node old-space 128 MiB | 额外限制 JS 老生代；不代表 Node 全部内存 |
| 服务运行 120 秒 | systemd 计时，不依赖启动器存活；包含停止宽限及启动开销的总耗时可能更长 |
| 32 个任务 | Linux 线程和进程合计 |
| 输出阈值 1 MiB | stdout/stderr 合计超过阈值即停止；停止期间继续有界排空管道，每路仅保留末尾 8 KiB |
| 同脚本一个实例 | 按目标真实路径持有 flock，并拒绝已有同名 systemd unit |

可使用 `--memory-mib`、`--heap-mib`、`--seconds`、`--output-bytes` 调低限制；不能超过以上上限，最小内存 64 MiB、堆 16 MiB、时间 1 秒、输出 1 KiB。Node 实际总量可能比 old-space 大得多，因此必须同时使用 cgroup。硬内存阈值存在内核记账粒度，不是峰值字节的严格数学等号。

启动器使用瞬态用户服务和 `KillMode=control-group`。取消、超时和失败会清理本次服务内的进程，包括 detached 子进程。每次服务带随机描述及 InvocationID；清理前核对所有权，不停止其他执行者的既有服务。启动器自身被 SIGKILL 时无法执行 finally，服务仍受内存及运行时限约束；失败 unit、私有握手目录或锁文件可能保留，均不会自动开始新核验。后续启动对已有 unit 明确报错，先用 `systemctl --user status <unit>` 核对终态，再人工处理残留；不要删除持有中的锁。锁文件保留是刻意设计，避免 inode 被更换后出现双实例。

服务显式继承调用启动器时的当前工作目录，相对输入/输出路径由该目录解析，不依赖 systemd 默认目录。`LimitCORE=0` 禁止故障核验生成 core dump，避免额外保存大块进程内存；不改变主机其他程序的 core 策略。

需要强制保护的私有脚本应在加载研究数据前引入 `audit_guard_entry.cjs` 的实际安装路径。它核对实际 cgroup、堆上限和启动标记，意外直接 `node audit.cjs` 会以 `AUDIT_GUARD_REQUIRED` / 78 拒绝。它防止误操作，不是针对同一用户恶意绕过的安全沙箱。未加入该入口的程序不会自动受保护。

启动器输出一条 JSON，区分 `COMPLETED`、`MEMORY_LIMIT`、`TIME_LIMIT`、`OUTPUT_LIMIT`、`CANCELLED` 等，并列出实际验证的限制、峰值和输出尾部。stderr 尾部可能包含 systemd-run 诊断；错误全文和原始研究对象不应直接打印。若 manager 消失且拿不到 OOM 证据，只能报告普通失败，不猜测内存原因。`AUDIT_CLEANUP_WARNING` 表示某个清理步骤失败，其余清理仍继续，内核限制继续兜底。

## 验证

```sh
python3 tests/audit_guard_test.py
node --test tests/*.test.cjs
```

保护测试使用临时小型合成脚本和最大 128 MiB cgroup，不读取研究库：正常及直接调用拒绝、外部 Buffer/子进程内存、detached 子进程超时、输出超限及复用、同脚本互斥及取消、管理器不可用、启动器 SIGKILL、外来 unit 不受影响、未握手失败清理、损坏握手与管理器超时的独立清理。故意制造异常的测试会出现预期的清理警告。

另核验相对输入沿用启动目录及实际 core 大小限制为零。完整插件测试含超过 12 MiB 的合成历史容量 fixture，不属于本地研究核验入口；它们不保证在 128 MiB V8 堆下通过。若验证这些容量场景，应单独串行运行并保留整个进程组的内核内存上限，不修改已部署核验入口的 128 MiB 堆限制，不使用真实库代替 fixture。

历史故障脚本的隔离状态必须单独保留；加入资源保护不意味着恢复其业务正确性，也不能据此重新执行已完成的归档恢复。
