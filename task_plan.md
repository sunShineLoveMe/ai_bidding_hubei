# Task Plan: Token 用量与成本统计

## Goal
在设置面板增加 AI/OCR 用量统计能力，用于评估单个项目和近期系统调用消耗了多少 token、预估花费多少成本。

## Scope
- DashScope 原生文本生成调用用量采集。
- DashScope 流式章节生成用量采集，无法获取 usage 时按字符数估算并标记。
- OpenAI 兼容 Embedding 调用用量采集。
- DashScope Rerank 调用用量采集。
- 设置页展示近 30 天调用次数、输入 token、输出 token、预估费用和最近调用明细。

## Phases
- [x] Phase 1: 查询模型厂商官方 usage 字段和计费口径
- [x] Phase 2: 提供 Supabase SQL 表、视图和 RPC
- [x] Phase 3: 后端增加统一 AI 用量落库函数和成本估算
- [x] Phase 4: 接入 Qwen 文本生成、流式生成、Embedding、Rerank
- [x] Phase 5: 增加 `/api/bidding/settings/ai-usage` 查询接口
- [x] Phase 6: 设置页新增“用量与成本”Tab
- [x] Phase 7: 后端编译、前端构建和接口探测验证

## Files Changed
- `sql/20260507_create_ai_usage_tracking.sql`
- `backend/db/supabase_repo.py`
- `backend/ai/qwen_client.py`
- `backend/ai/section_writer.py`
- `backend/ai/chapter_planner.py`
- `backend/ai/interpreter.py`
- `backend/ai/rerank_client.py`
- `backend/rag/vector_store.py`
- `backend/api/routes.py`
- `frontend/src/pages/Settings/index.tsx`

## Verification
```bash
python -m py_compile backend/db/supabase_repo.py backend/ai/qwen_client.py backend/rag/vector_store.py backend/ai/rerank_client.py backend/ai/section_writer.py backend/ai/chapter_planner.py backend/ai/interpreter.py backend/api/routes.py
npm run build
curl -s -o /tmp/ai_usage_summary.json -w "%{http_code}\n" "http://127.0.0.1:3012/api/bidding/settings/ai-usage?days=30"
```

验证结果：
- 后端编译通过。
- 前端构建通过，仍有既有 chunk size warning。
- 用量统计接口返回 `200`。

## Notes
- 费用为预估值，最终以模型厂商账单为准。
- 当前已覆盖主要 AI 调用链路；MinerU/OCR 价格已在 SQL 中预留页数统计和手工价格配置，后续可接解析链路。
- 若 DashScope 原生流式接口未返回 usage，系统会按输入/输出字符数估算 token，并标记 `usage_estimated=true`。

## Status
**Complete** - 第一版 Token 用量与成本统计已完成。
