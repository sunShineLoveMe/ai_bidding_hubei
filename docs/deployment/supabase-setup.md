# Supabase 初始化与补充表

> 快速开始见 [quickstart.md](./quickstart.md)

### 3.1 Supabase 补充表

当前上传链路已优先创建 Supabase 项目和文件记录，并返回 `projectId` 供前端自动执行「解析 → AI 解读 → 章节大纲」流程。轻量用户识别和 OnlyOffice 文档映射也已迁移到 Supabase，SQLite 仅作为兼容回退。

请在 Supabase SQL Editor 执行：

```sql
-- sql/20260429_app_users_and_onlyoffice_documents.sql
-- sql/20260507_create_ai_usage_tracking.sql
-- sql/20260507_update_ai_usage_pricing_cny.sql
-- sql/20260508_create_bid_generation_tasks.sql
-- sql/20260508_create_bid_export_tasks.sql
-- sql/20260508_supabase_idempotency_indexes.sql
-- sql/20260508_add_asset_applicable_volumes.sql
```

上述脚本会创建或补充：

| 表 | 用途 |
| --- | --- |
| `app_users` | 保存浏览器匿名指纹与单机版操作人员 ID，用于替代早期 SQLite `users` 表 |
| `onlyoffice_documents` | 保存 OnlyOffice 文档 key、项目 ID、文件路径和回调下载地址，用于保存回调定位目标文件 |
| `ai_model_prices` | 维护模型和 OCR 人民币单价，供 Token 用量成本估算使用 |
| `ai_usage_logs` | 保存 AI 调用明细，包括项目、阶段、模型、Token、人民币费用和原始 usage |
| `ai_usage_project_summary` / `ai_usage_daily_summary` | 汇总项目级和日期级调用成本，供用量与成本中心展示 |

如果 `20260429` 脚本尚未执行，系统会尽量回退 SQLite；但推荐新部署直接执行 SQL，确保主链路统一到 Supabase。`20260507_create` 脚本是 Token 用量与成本统计的必需表结构，未执行时一级菜单「用量与成本」无法展示真实统计。若历史环境已写入 USD 口径价格或日志，请补充执行 `20260507_update_ai_usage_pricing_cny.sql`，将价格和历史成本折算为人民币。`20260508_create_bid_generation_tasks.sql` 用于记录"一键编写全文"的后端任务态，支持刷新后恢复批量章节生成进度。`20260508_create_bid_export_tasks.sql` 用于记录 DOCX 导出任务，支持长文档后台导出和前端轮询。`20260508_supabase_idempotency_indexes.sql` 用于给知识库文档、知识库分片和资信/产品资产补充防重复索引，其中资信/产品资产按 `storage_bucket/storage_path` 防重；如果历史库已有重复记录，需先备份并清理重复数据后再执行。`20260508_add_asset_applicable_volumes.sql` 用于给企业资信库和产品库增加 `applicable_volumes` 独立适用分册字段，并升级 `match_knowledge_assets` RPC，支持 RAG 和自动插图按技术标、商务标、资格文件、报价文件、附件材料做硬过滤。
