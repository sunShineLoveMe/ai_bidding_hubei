# Task Plan: Token 用量与成本统计

## Goal
将 AI/OCR 用量统计升级为独立一级菜单，用于按标书项目评估单次生成流程消耗了多少 token、使用了哪些模型、调用是否成功，以及人民币预估成本。

## Scope
- DashScope 原生文本生成调用用量采集。
- DashScope 流式章节生成用量采集，无法获取 usage 时按字符数估算并标记。
- OpenAI 兼容 Embedding 调用用量采集。
- DashScope Rerank 调用用量采集。
- 一级菜单「用量与成本」展示近 30 天调用次数、输入 token、输出 token、人民币预估费用、项目筛选、模型类型拆分和最近调用明细。

## Phases
- [x] Phase 1: 查询模型厂商官方 usage 字段和计费口径
- [x] Phase 2: 提供 Supabase SQL 表、视图和 RPC
- [x] Phase 3: 后端增加统一 AI 用量落库函数和成本估算
- [x] Phase 4: 接入 Qwen 文本生成、流式生成、Embedding、Rerank
- [x] Phase 5: 增加 `/api/bidding/settings/ai-usage` 查询接口
- [x] Phase 6: 设置页新增“用量与成本”Tab
- [x] Phase 7: 后端编译、前端构建和接口探测验证
- [x] Phase 8: 将“用量与成本”升级为一级菜单，移出设置页，补充项目筛选、模型类型拆分和 CNY 展示

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
- `frontend/src/pages/UsageCost/index.tsx`
- `frontend/src/App.tsx`
- `frontend/src/components/layout/AppLayout.tsx`
- `sql/20260507_update_ai_usage_pricing_cny.sql`

## Verification
```bash
python -m py_compile backend/db/supabase_repo.py backend/ai/qwen_client.py backend/rag/vector_store.py backend/ai/rerank_client.py backend/ai/section_writer.py backend/ai/chapter_planner.py backend/ai/interpreter.py backend/api/routes.py
npm run build
curl -s -o /tmp/ai_usage_summary.json -w "%{http_code}\n" "http://127.0.0.1:3012/api/bidding/ai-usage?days=30"
```

验证结果：
- 后端编译通过。
- 前端构建通过，仍有既有 chunk size warning。
- 用量统计接口返回 `200`。

## Notes
- 费用为预估值，最终以模型厂商账单为准。
- 当前已覆盖主要 AI 调用链路；MinerU/OCR 价格已在 SQL 中预留页数统计和手工价格配置，后续可接解析链路。
- 成本中心统一按人民币 CNY 展示。若历史 SQL 已写入 USD 口径价格或日志，执行 `sql/20260507_update_ai_usage_pricing_cny.sql` 转为人民币口径。
- 若 DashScope 原生流式接口未返回 usage，系统会按输入/输出字符数估算 token，并标记 `usage_estimated=true`。

## Status
**Complete** - Token 用量与成本统计已升级为独立一级菜单和人民币成本中心。

---

# Task Plan: P0 开源与安全最小闭环

## Goal
补齐单机版/私有化部署前的最低安全基线，降低配置泄露、跨域误开放、上传异常文件、错误详情暴露和弱密钥风险。

## Scope
- `.env.example` 完整化。
- CORS 白名单环境变量化。
- 生产环境启动配置校验。
- 本地访问保护和可选访问令牌。
- 500 错误响应脱敏。
- 上传文件扩展名、MIME 和大小限制。
- 调试 `print` 收敛为 logging。

## Phases
- [x] Phase 1: 新增集中安全工具模块 `backend/core/security.py`
- [x] Phase 2: Flask 启动接入 CORS 白名单、访问保护、生产配置校验和错误脱敏
- [x] Phase 3: 招标文件、MinerU zip、知识库文件、资信/产品资产上传接入文件校验
- [x] Phase 4: 移除默认 ONLYOFFICE 弱密钥，改为环境变量必填校验
- [x] Phase 5: 补全 `.env.example` 安全、模型、Supabase、MinerU、OnlyOffice、上传和路径配置
- [x] Phase 6: 清理核心运行链路调试 print，改为 logging
- [x] Phase 7: README 路线图同步完成状态

## Files Changed
- `backend/core/security.py`
- `main.py`
- `backend/api/routes.py`
- `backend/api/users.py`
- `backend/ai/qwen_client.py`
- `backend/export/md_to_word.py`
- `.env.example`
- `README.md`
- `task_plan.md`

## Verification

```bash
python -m py_compile main.py backend/core/security.py backend/api/routes.py backend/api/users.py backend/ai/qwen_client.py backend/export/md_to_word.py
python -c "import main; print(main.app.test_client().get('/api/health').json)"
python -c "from io import BytesIO; import main; c=main.app.test_client(); r=c.post('/api/bidding/upload', data={'userId':'1','file':(BytesIO(b'x'),'bad.exe')}, content_type='multipart/form-data'); print(r.status_code, r.json)"
```

验证结果：
- 后端编译通过。
- Flask test client 健康检查返回 `{'status': 'ok'}`。
- 非法上传 `.exe` 被拦截并返回 `400`。

## Notes
- `APP_AUTH_ENABLED=false` 时不影响现有本机开发流程；生产或客户环境可开启 `APP_AUTH_ENABLED=true` 并配置 `APP_AUTH_TOKEN`。
- `APP_ENV=production` 或 `REQUIRE_STRICT_CONFIG=true` 会启用严格配置校验，弱密钥和占位密钥会导致启动失败。
- 目前未执行“开源前移除真实业务文件、生成文件、解析产物、缓存、日志和本地运行配置”，该项需要在正式开源/交付前单独清理工作区。

## Status
**Complete** - P0 安全与部署最小闭环已完成，正式开源/交付前仍需单独清理本地真实业务文件和生成产物。

---

# Task Plan: P1.1 DashScope/Qwen 调用稳定性增强

## Goal
降低标书解读、章节正文生成、RAG 问答等模型调用在限流、网络抖动和临时服务异常下的失败率，并让失败原因和重试情况可追踪。

## Scope
- DashScope 普通文本生成增加自动重试。
- DashScope 流式生成增加连接前/首包前重试，已输出正文后不自动重试，避免重复内容。
- 支持指数退避、最大重试次数、重试状态码和超时时间配置。
- 限流和临时服务不可用返回更明确的用户级错误。
- AI 用量日志 metadata 记录 attempts、retry_attempts、max_retries、retryable、final_success。
- README 和 `.env.example` 同步实施配置说明。

## Phases
- [x] Phase 1: 抽取 DashScope 重试、退避、状态码判断和公开错误提示工具函数
- [x] Phase 2: 非流式文本生成接入重试与最终一次用量落库
- [x] Phase 3: 流式生成接入安全重试策略，避免已输出正文后重复重试
- [x] Phase 4: 增加 `.env.example` 和 runtime settings 默认配置
- [x] Phase 5: README 路线图和实施配置说明同步

## Files Changed
- `backend/ai/qwen_client.py`
- `backend/core/config.py`
- `.env.example`
- `README.md`
- `task_plan.md`

## Verification

```bash
python -m py_compile backend/ai/qwen_client.py backend/core/config.py
```

验证结果：
- 后端编译通过。
- 本地 monkeypatch 验证：第一次返回 429 后自动等待并重试，第二次成功返回，usage metadata 记录 `attempts=2`、`retry_attempts=1`。

## Notes
- 默认 `DASHSCOPE_MAX_RETRIES=2`，即首次请求失败后最多再试 2 次。
- 默认重试状态码为 `429,500,502,503,504`；认证、参数错误等非临时错误不重试。
- 流式生成如果已经向前端输出正文片段，后续异常不自动重试，避免重复拼接正文。

## Status
**Complete** - DashScope/Qwen 主调用已完成重试、指数退避、限流提示和可配置超时接入。
