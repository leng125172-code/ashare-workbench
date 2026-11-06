## 0.14.1 存储复核补强

- 清理前除对象/引用SHA外还恢复并核对每份仓储保护文档的logicalSha256；合法JSON但摘要错误、版本字段缺失/未知都拒绝清理。磁盘根索引与已加载根SHA不一致时，Agent工具停止读写并要求核对磁盘资料并重载后台（停用后重新启用插件），不能拿旧缓存生成清理或覆盖新根。
- 缓存同时限制最多50,000项及32MiB编码体积；不是进程总内存上限。known记录随同缓存淘汰，不再累计已淘汰键。当前仍完整恢复活动研究到内存，并非按需流式查询，超大活动研究仍受内存约束。
- 行业引用索引也分层，每层最多64引用；超长对象字段名按独立文本保存，保持字段顺序与精确内容。写入使用ashare-repository/2，兼容读取/1；旧库不因检查自动重写。首次实际写入/2前保留原物理根备份。旧0.14.0不支持/2，不能直接降级操作新根。
- 旧分片256MiB逻辑上限与512KiB索引上限同时存在，索引可能更早达到上限（常规不可压缩记录约196MiB）。现先完成有界内存预检，索引超限不会落任何新片；大记录用两遍编码避免缓存所有base64。不把逻辑上限宣称成保证可存容量。
- 当前按Cindy每插件唯一后台写者串行处理。UI页只发送维护请求，不直接写库；未宣称多个进程共享同一库可并发写入。

# 独立快照、行业引用、批次归档与容量维护（0.14）

## 新仓储与兼容

- 使用当前作品库内的`storage/research.sqlite`；模拟模式独立使用`simulation/storage/research.sqlite`。仅走Cindy公开library SQLite与文件API，不访问库绝对路径、不新增网络/文件权限。
- 股票快照以完整内容摘要独立保存，行业归属记录引用快照并保存原key、全局顺序、sectorId原插入位置。只有完全相同的观测才复用；不同来源、日期、值或警告保留不同快照，不按股票代码粗暴合并。已有行业层级/旧名称不静默筛掉。
- 根为物理schema3仓储封装（可能再包在旧schema2压缩索引内），逻辑state仍schema1。大map/array/长文本按条数及字节分页，run单独保存，当前根不再承载完整股票明细；快照与每条独立记录有SHA256和引用清单，回读核验后最后原子提交根。单条仓储记录最多128KiB、SQL写每批最多100条且约1MiB、查询按最多32条保护16MiB回执界限；不通过增加单份state上限支撑增长。输入JSON深度最多64层，超出提交前拒绝。
- 不宣称无限容量：内存、磁盘水位和宿主SQL结果上限仍存在。Library.status给出全库占用、空闲空间和软提醒，数据分页/归档与缓存回收用于控制增长；SQLite删除会释放可复用页，不保证文件立即缩小，宿主不开放VACUUM，不能用删除重建数据库冒充压缩。
- 旧JSON/0.13压缩档仍可读；旧插件会拒读schema3，不应直接降级。升级先备份旧物理根并SHA核对；旧根依赖的压缩片和原始备份均保留。

## 工具与UI

账户设置 → 存储管理：读取状态 →（旧格式）升级存储 → 归档已完成批次 / 预览无引用缓存清理 → 明确勾选确认后执行。

```js
plan_control({mode:'live',action:'storage_status'})
plan_control({mode:'live',action:'storage_migrate',requestKey:'本次稳定升级键',storage:{expectedRevision:实际revision}})
plan_control({mode:'live',action:'storage_archive_completed',requestKey:'本次稳定归档键',storage:{expectedRevision:实际revision}})
plan_control({mode:'live',action:'storage_cleanup_preview'})
plan_control({mode:'live',action:'storage_cleanup_execute',requestKey:'本次稳定清理键',storage:{expectedRevision:预览expectedRevision,cleanupToken:预览cleanupToken,confirm:true}})
```

status只读，返回indexRevision、canMigrate、snapshots（仓储中快照总数，含尚未清理的缓存）、memberships（各批次行业归属合计）、archivedRuns、eligibleArchiveRuns和storage。storage.rootBytes通过完整分页list即时汇总插件可见文件，包含两模式、备份、数据库及WAL/SHM，不包含宿主隐藏文件，也不是磁盘块占用；databaseBytes是当前mode主数据库与日志的文件大小。hostReportedBytes单独保留宿主status增量账本，SQLite写入不会实时计入该账本，不把它当准确总量。objectBytes仅逻辑对象字节，不是SQLite物理大小。不得将快照数当股票代码去重数。

升级不需要configure/begin_research/finalize，保留原runId、范围、游标、配置、历史观察与判断。SQL记录先落库并回读校验，最后提交根；SQL或根写失败只留可核对的孤立缓存，旧根保持。宿主返回明确DB_NOT_OPEN（请求未执行）时只重开并重试该请求一次；其他错误不自动重放。同键重试保留原参数；版本不符先重新读取并核对。沿原runId续采，不另开批次。

归档只处理completed/failed/cancelled且尚无archivePath的完整研究，确定性内容地址保留原始批次，当前state仅留摘要与路径；get_research照常分页读原始快照。已有正式报告归档不重写，未完成研究不归档，不因维护操作新建报告、交易、计划、IM或调度。

## 清理保护与故障恢复

预览完整分页列举本mode全部JSON文件，包括原根、原始备份、归档、正式建议、冻结提交意图；先校验所有压缩片与独立记录，再递归标记引用图。仅无引用的repository_objects行和符合内容地址规则的storage/chunks片可成为候选。其他文件、数据库、审计记录、正式资料与备份永不作为删除目标。未知/损坏JSON、缺片、摘要错误、清单不完整或版本改变均阻止清理。

每次最多2000项，UI显示前20项摘要和完整候选数/逻辑大小；更大范围分批重新预览。执行需显式confirm:true，按当前根SHA、模式、revision和候选指纹重新核对；旧预览失效不强行删除。两模式DB和文件清理均独立。

清理工作单在独立数据库持久化。每批对象删除与进度记账在同一db.batch事务；失败以同一requestKey/原参数恢复，完成同键只返回原回执。文件删除与SQLite记账无法跨介质原子化：崩溃后已消失文件标missingFiles，不伪造删除回执或已回收字节。其他已确认作业先行删除的对象记missingObjects，不重复计算删除或回收字节。最终分列deletedObjects/missingObjects/deletedFiles/missingFiles/reclaimedLogicalBytes/fileBytesDeleted，不把逻辑字节冒充磁盘净减。

界面维护操作锁定资料模式；状态/预览按mode与请求代次校验，旧模式回包不覆盖新模式。不要在预览变化后盲目用旧令牌清理。

---

以下保留0.13格式和旧接口说明，兼容读取与故障诊断：

# 大目录容量与原批次恢复（0.13）

STORE_LIMIT不是必须缩小行业范围或删除旧批次的理由。本版把大JSON保存为可校验的分片，小索引最后由宿主原子写入；当前采集游标、每个行业归属、报价时点、原始警告、请求键及已有判断都保留。完整目录是否值得研究仍是用户的范围选择，不能为通过容量测试偷偷只留30–50个行业。

## 诊断与迁移

1. `get_state({mode:'live'})`读取实际revision和runId。get_state不迁移、不清空库。storage字段显示legacy_inline/chunked、主索引/逻辑字节数、编码及备份。
2. `get_research({mode:'live',runId,view:'storage'})`只读诊断。memberships/uniqueSymbols及游标属于所选run；logicalBytes和storage属于该mode的整体状态，不能混淆。同股不同板块有不同的行业归属或观察时间，不可按代码直接删除。
3. 在用户授权修复容量时，以实际revision调用：

```js
plan_control({mode:'live',action:'storage_compact',requestKey:'本次稳定迁移键',storage:{expectedRevision:实际revision}})
```

不需要configure、begin_research、record_failure或finalize。版本不符返回REVISION_CONFLICT并停止；读新状态后重新核对，不用旧副本覆盖。首次替换旧状态前，在同一作品库保存原state.json的逐字备份，回读比较并记录SHA256；原主状态不提前移走。备份在storage/backups内，simulation使用其独立前缀。

4. 新分片均写入并回读校验成功后，再原子替换主索引。返回原批次/游标与新的storage统计。对比迁移前的runId、sectorCursor、memberCursor、归属数、config和plan；迁移仅增加一次状态revision。
5. 按原runId继续collect_batch，同一次补采重试用同一requestKey。无需新建批次或重新采已完成的行业。可用一只/一小批做恢复验证，再按原授权继续。全局状态版本可能由其他活动推进，应重新读取而非假定固定数字。

## 格式与故障边界

- 大记录按128KiB逻辑字节分片，每片有编码及解码SHA256、字节数；支持时独立gzip，缺少压缩API时写UTF8分片，不删除重复归属。未改变的编码分片按内容哈希复用。
- 每个物理编码片≤256KiB，主索引≤512KiB。逻辑记录仍有256MiB安全边界；过多分片导致索引超限时也停止，不能把内存/磁盘当无限。旧单文件12MiB上限不再卡住这类拆分状态。
- 主索引物理schema=2，解码后的逻辑state仍是schema=1。旧0.12及以前版本会拒读新索引，不应直接降级运行。完整原始备份保留，不自动回滚到未经确认的孤立片段。
- 缺片、编码/摘要/长度损坏、解码API不支持时明确失败，不把空状态或空数组当恢复成功。写片或备份失败时原根索引保持；中断留下的片段不自动当作已提交数据。
- 报告、建议、定稿提交意图和其他大JSON同样走此编码，读取/导出先校验并恢复逻辑JSON；建议canonical和SHA口径不变。不能只压缩state而让定稿再次写超大原文失败。
- 不自动删备份、片段或请求历史，不做有损清理。本版不把压缩当作数据质量验证，失败K线、未知交易状态和原文缺项仍保留原义。

## 查询分页

get_research的目录、股票、资讯、资料覆盖及派工清单支持offset/limit（默认30，最多100），返回nextOffset。nextOffset=null才读完；totalSectors/totalStocks/totalAssignments是完整范围数，不是当前页数。股票页也保留未就绪标的，未分档不是被丢弃。

行业资讯用`view:'news',sectorId`分页；任务中newsReadRequest指向该清单，freshNewsIds说明本页时效可用ID。allowedNewsIds只覆盖当前任务实际提供的资讯页，其他引用须先读取对应页。资料包按股票-行业归属分页，totalDossiers是全run资料包数，pageDossierCount是本页实际返回数。

主代理须先固定并读完待派工清单再分发/写入，不能在已提交行业导致pending清单缩短后沿旧offset跳过行业。期间输入证据变化仍按0.12指纹规则重新分工。
