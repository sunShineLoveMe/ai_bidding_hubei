# AI 应用 Harness 工程稳定性调研报告

> 调研日期：2026-05-27  
> 调研对象：当前 AI 标书系统代码库  
> 调研目标：评估是否可以采用 Harness 工程思想，提升 AI 应用在生产环境中的稳定输出表现  
> 约束：本报告仅做技术调研与实施建议，不修改业务代码

## 1. 结论摘要

当前项目**非常适合引入 Harness 工程思想**，而且不是“从零建设”。项目已经具备一部分生产 AI 应用的关键基础：

- LLM 调用统一封装：`backend/ai/qwen_client.py`
- 分阶段模型配置：`backend/core/config.py`
- 模型调用重试、超时、失败日志和用量记录
- RAG 检索、Rerank、关键词兜底：`backend/rag/retrieval.py`
- 规则 + LLM 双轨合规检查：`backend/ai/compliance_checker.py`、`backend/ai/semantic_compliance.py`
- 大文件分段解读和失败回退：`backend/ai/interpreter.py`
- 后端回归测试：`tests/`
- 用量与成本中心：`ai_usage_logs` 相关链路

但当前系统仍主要是“功能测试 + 运行日志 + 人工体验判断”，还没有形成完整 Harness 工程闭环。生产稳定性真正需要的是：

```text
固定样本集 → 可复放任务 → 多维评分器 → 发布门禁 → 线上追踪 → 失败样本回流 → 持续迭代
```

因此建议将 Harness 作为电网行业改造和二期多企业基础版的底层工程能力同步建设。它不直接增加业务功能，但会显著降低 AI 输出漂移、模型替换、Prompt 调整、RAG 数据变化、合规误判和多企业数据隔离失效带来的生产风险。

## 2. 外部工程实践调研

### 2.1 为什么传统测试不够

OpenAI 的评估最佳实践明确指出，生成式 AI 具有变异性，同样输入可能产生不同输出，因此传统软件测试不足以覆盖 AI 架构。Evals 被定义为一种在这种变异性下测试 AI 系统的方法，并建议“尽早、经常评估”“设计任务特定 eval”“记录所有内容”“尽可能自动化”“持续评估”。参考：OpenAI Evaluation Best Practices  
https://developers.openai.com/api/docs/guides/evaluation-best-practices

这与当前项目高度相关：标书正文、合规复核、RAG 问答和大纲生成都不是固定输出，不能只用 `unittest` 判断代码不报错。

### 2.2 Harness 的核心不是“测模型”，而是“测系统”

OpenAI Evals 将 evals 定义为评估 LLM 或基于 LLM 构建的系统的框架，并强调可以为具体业务用例编写自定义 eval。参考：OpenAI Evals  
https://github.com/openai/evals

当前项目不是单纯调用模型，而是一个多步骤系统：

```text
文档解析 → 结构化解读 → RAG 召回 → 大纲生成 → 正文生成 → 合规检查 → Word 导出
```

所以 Harness 不应只问“模型答得好不好”，而应评估完整链路是否稳定满足业务目标。

### 2.3 Harness 工程应支持阈值化与发布门禁

Harness Evals 这类开源框架强调每个 metric 产生 0.0-1.0 的标准化分数，并通过可配置阈值决定 pass/fail。参考：Harness Evals  
https://github.com/harness/harness-evals

这对当前项目很关键：不能靠“感觉这次生成不错”上线，而应把关键任务变成阈值：

- 招标要求抽取 F1 ≥ 0.85
- 评分项召回率 ≥ 0.90
- RAG 上下文命中率 ≥ 0.80
- 合规检查高风险漏报数 = 0
- Word 导出结构错误 = 0
- 多企业隔离越权命中 = 0

### 2.4 线上稳定性需要 Trace + Eval + Monitoring 一体化

LLM Observability 的工程实践强调，传统可观测性只看 uptime、错误率、延迟，但 AI 应用可能请求成功却输出错误、低质量或不合适内容；生产中需要把 tracing、evals、monitoring 作为一套流程：监控发现变化，trace 定位单次执行的 retrieval、prompt、tool、model output，eval 衡量输出是否合格。参考：Braintrust LLM Observability Guide  
https://www.braintrust.dev/articles/llm-observability-guide

当前项目已有 `ai_usage_logs`，但更接近“用量/成本日志”，还不是完整 AI trace。Harness 化后需要记录：

- 输入文档摘要和样本 ID
- prompt version
- model version
- retrieved chunk IDs
- rerank score
- output hash
- evaluator scores
- guardrail result
- human review label

### 2.5 高价值业务需要专家参与 Golden Set

OpenAI 关于 evals 的业务实践建议：由技术和领域专家共同定义端到端工作流、关键决策点和成功标准，形成 golden set，并持续进行 error analysis。参考：OpenAI - How evals drive the next chapter in AI for businesses  
https://openai.com/index/evals-drive-next-chapter-of-ai/

标书系统尤其适合这种方式。客户提供的 5-10 份国网招标样本不应只用于 Prompt 调优，还应沉淀为：

- 招标解析 Golden Set
- 评分项 Golden Set
- 否决项 Golden Set
- 资质匹配 Golden Set
- 标书大纲 Golden Set
- 正文质量人工评分集
- 合规检查误报/漏报案例集

### 2.6 风险管理框架要求持续评估与治理

NIST AI RMF 旨在帮助组织把可信性考虑纳入 AI 产品、服务和系统的设计、开发、使用和评估，并发布了生成式 AI 风险管理 Profile。参考：NIST AI Risk Management Framework  
https://www.nist.gov/itl/ai-risk-management-framework

对电网招投标场景而言，系统输出会影响商务风险、资质响应、条款响应和投标材料质量，不能只依赖 Prompt。需要治理机制：风险分类、评估指标、人工复核、日志留痕、持续监控。

## 3. 当前项目 Harness 基础盘点

### 3.1 已经具备的能力

| 能力 | 当前实现 | Harness 价值 |
| --- | --- | --- |
| 模型统一调用 | `backend/ai/qwen_client.py` 兼容 DeepSeek / DashScope | 适合统一加 trace、prompt version、evaluator hook |
| 重试与超时 | `_max_attempts()`、`_retry_status_codes()`、`_llm_request_timeout()` | 具备生产稳定性基础 |
| 分阶段模型配置 | `get_stage_model()` 支持 interpretation、outline、compliance、section 等阶段 | 可按阶段设计独立 eval |
| 用量日志 | `record_ai_usage_log()` 记录 provider、model、stage、tokens、cost、success、latency | 可扩展为 trace + eval result |
| 大文件分段解读 | `interpreter.py` 中分段、失败记录、merge、fallback | 适合设计 segmented eval |
| RAG 检索 | 向量检索 + rerank + 关键词兜底 | 可设计 context recall / precision eval |
| 合规双轨 | 规则覆盖 + LLM 语义复核 + heuristic fallback | 适合做高风险漏报门禁 |
| 测试基础 | `tests/test_rag_retrieval.py`、`test_semantic_compliance.py` 等 | 可扩展为 eval harness |
| 成本中心 | 前端已有用量与成本页面 | 可扩展质量分、失败率、漂移指标 |

### 3.2 当前主要缺口

| 缺口 | 现状 | 生产风险 |
| --- | --- | --- |
| 缺少 Golden Set | 测试多为单元测试和 mock 数据 | Prompt 改动后不知道业务质量是否下降 |
| 缺少 Prompt 版本管理 | Prompt 散落在各 AI 模块字符串中 | 无法追踪某次输出由哪个 prompt 版本产生 |
| 缺少 Eval Run 概念 | `unittest` 不等于业务质量评估 | 无法做发布前质量门禁 |
| 缺少 Trace Span | 只有用量日志，没有完整链路 trace | 线上问题难定位是解析、RAG、Prompt 还是模型问题 |
| 缺少质量评分表 | `ai_usage_logs` 记录成本，不记录质量 | 只能知道花了多少钱，不知道输出是否可靠 |
| 缺少 RAG 指标 | 召回是否正确主要靠人工体验 | 知识库变化可能导致静默劣化 |
| 缺少合规漏报评估 | 有合规功能，但没有基准漏报集 | 高风险否决项漏报难提前发现 |
| 缺少多企业隔离 Eval | 当前仍是单企业逻辑 | 二期多企业基础版必须防止跨企业召回 |
| 缺少隐私脱敏策略 | `ai_usage_logs` 可能记录 input/output 文本 | 生产环境可能记录敏感企业资料和标书内容 |

## 4. Harness 工程在本项目中的定义

建议把 Harness 定义为位于业务代码和生产环境之间的“AI 质量保障层”：

```text
                ┌────────────────────────────┐
                │       Harness 工程层        │
                │                            │
输入样本 ──────▶│ eval cases / replay runner │
                │ scorers / guardrails       │─────▶ 发布门禁
生产日志 ──────▶│ traces / metrics / review   │─────▶ 线上监控
                │ error taxonomy / dataset   │─────▶ Prompt 与模型迭代
                └────────────────────────────┘
```

它不是一个单独“测试脚本”，而是一套贯穿研发、验收和生产的机制：

1. **研发阶段**：每次改 Prompt、模型、RAG、规则，都跑 eval。
2. **发布阶段**：关键指标不过阈值，不允许上线。
3. **生产阶段**：采样线上请求，自动评分，发现漂移。
4. **运营阶段**：把失败案例加入 Golden Set，形成数据飞轮。

## 5. 适合本项目的 Harness 分层设计

### 5.1 Harness 目录建议

未来可新增独立目录，不侵入业务逻辑：

```text
backend/harness/
  cases/
    tender_parse_cases.jsonl
    rag_cases.jsonl
    outline_cases.jsonl
    compliance_cases.jsonl
    section_writing_cases.jsonl
    tenant_isolation_cases.jsonl
  runners/
    run_parse_eval.py
    run_rag_eval.py
    run_outline_eval.py
    run_compliance_eval.py
    run_full_pipeline_eval.py
  scorers/
    deterministic.py
    llm_judge.py
    rag_metrics.py
    compliance_metrics.py
    docx_metrics.py
  reports/
    eval_report_*.json
    eval_report_*.md
```

### 5.2 数据表建议

如果进入生产化，可以在 Supabase 中增加 Harness 表：

| 表 | 用途 |
| --- | --- |
| `eval_cases` | 固定样本、输入、期望结果、标签、适用阶段 |
| `eval_runs` | 每次评估运行记录、代码版本、模型版本、Prompt 版本 |
| `eval_scores` | 每个 case 的评分结果 |
| `prompt_versions` | Prompt 模板、版本、适用阶段 |
| `ai_trace_spans` | 一次 AI 任务的分步骤 trace |
| `guardrail_results` | 线上 guardrail 触发记录 |
| `human_review_labels` | 专家复核结果和错误分类 |

### 5.3 与现有 `ai_usage_logs` 的关系

`ai_usage_logs` 不建议删除，它适合继续做成本和调用审计。Harness 应与其关联：

```text
ai_usage_logs.id
  └── ai_trace_spans.usage_log_id
        └── eval_scores.trace_id
```

这样可以回答：

- 哪个模型最贵？
- 哪个阶段失败率最高？
- 哪个 Prompt 版本质量下降？
- 哪些 RAG 召回导致低分？
- 哪些客户/项目触发最多合规风险？

## 6. 关键业务链路的 Harness 化方案

### 6.1 招标文件解析 Harness

目标：验证 PDF/DOCX/OCR 后的结构化结果是否稳定。

样本来源：

- 水利样本库
- 电网样本 5-10 份
- 扫描版、复杂表格、压缩包、长文档

评分指标：

| 指标 | 说明 | 建议门禁 |
| --- | --- | --- |
| 项目信息抽取准确率 | 项目名、招标编号、招标人、截止时间 | ≥ 0.90 |
| 评分项召回率 | 应抽取评分项是否被抽取 | ≥ 0.90 |
| 资格项召回率 | 资质、业绩、人员、授权 | ≥ 0.90 |
| 否决项召回率 | 废标/否决/星号条款 | ≥ 0.95 |
| 页码证据完整率 | 是否保留 source_page/source_text | ≥ 0.85 |

### 6.2 RAG Harness

目标：验证知识库召回是否命中正确资料，而不是只看模型回答是否顺。

当前基础：

- `search_knowledge_base()`
- `search_knowledge_assets()`
- `rerank_documents()`
- 关键词 fallback
- `tests/test_rag_retrieval.py`

建议指标：

| 指标 | 说明 | 建议门禁 |
| --- | --- | --- |
| Context Recall | 应召回资料是否出现在 Top-K | ≥ 0.85 |
| Context Precision | Top-K 中有效资料占比 | ≥ 0.70 |
| Asset Recall | 产品图、资质证书、业绩附件是否命中 | ≥ 0.80 |
| Cross-tenant Leakage | 多企业场景下是否召回其他企业资料 | 必须 0 |
| Citation Completeness | 回答是否列出依据 | ≥ 0.90 |

### 6.3 大纲生成 Harness

目标：验证生成大纲是否覆盖评分项、资格项、风险项，而非只看章节数量。

指标：

- 评分项覆盖率
- 资格项覆盖率
- 高风险项覆盖率
- 分册分类正确率
- 章节数量合理性
- 重复章节率
- 无关章节率

建议门禁：

```text
评分项覆盖率 ≥ 0.90
高风险项覆盖率 = 1.00
重复章节率 ≤ 0.10
```

### 6.4 正文生成 Harness

正文生成最难做精确断言，建议采用混合评分：

1. 规则评分：是否包含必要关键词、章节标题、资料引用、占位符。
2. RAG grounding：正文内容是否可追溯到招标文件或企业资料。
3. LLM Judge：根据 rubric 打分。
4. 人工抽检：业务专家定期校准 LLM Judge。

评分维度：

| 维度 | 说明 |
| --- | --- |
| 响应完整性 | 是否回应招标要求 |
| 企业事实一致性 | 是否编造证书、人员、金额、日期 |
| 证据可追溯性 | 是否引用企业资料、产品资料、招标条款 |
| 写作专业度 | 是否符合投标文本风格 |
| 冗余重复度 | 是否为了凑字数重复 |
| 占位符合理性 | 缺失信息是否用“待补充”而不是编造 |

### 6.5 合规检查 Harness

当前项目已有 `semantic_compliance.py`，适合继续增强为正式合规 Harness。

关键指标：

| 指标 | 说明 | 建议门禁 |
| --- | --- | --- |
| 高风险漏报数 | 应提示但未提示的否决项 | 0 |
| 高风险误报率 | 错误提示高风险 | ≤ 0.10 |
| 评分项覆盖判断准确率 | covered/partial/missing 分类 | ≥ 0.85 |
| 证据摘录准确率 | evidence 是否真来自正文 | ≥ 0.90 |
| LLM fallback 成功率 | 模型失败后 heuristic 是否可用 | ≥ 0.95 |

### 6.6 Word 导出 Harness

当前项目已有 `tests/test_docx_export.py`，建议进一步加入真实文档渲染检查：

- DOCX 能打开
- 目录字段存在
- 标题层级正确
- 页眉页脚存在
- 图片不越界
- 表格不丢失
- LibreOffice 刷新字段成功或降级记录存在

### 6.7 多企业基础版 Harness

电网二期必须重点建设。

最小评估集：

```text
企业 A 上传资质 A1
企业 B 上传资质 B1
企业 A 提问/生成正文
断言：不能召回 B1
断言：不能访问 B 的项目、文件、导出文档
断言：用量统计按企业隔离
```

门禁：

```text
跨企业数据泄露 = 0
跨企业 RAG 召回 = 0
跨企业文件访问 = 0
```

这类测试应优先级高于“智能查重”“文本差异化”等增强功能。

## 7. Guardrails 设计

Harness 不只做离线 eval，也应进入运行时。

### 7.1 输入侧 Guardrails

- 文件类型和大小限制
- OCR 页数/成本预估
- 敏感信息检测
- Prompt injection 检测
- 多企业权限校验
- 招标文件与企业资料类型识别

### 7.2 中间过程 Guardrails

- RAG 召回必须带企业 ID 过滤
- 高风险条款必须进入合规检查队列
- 评分项必须映射到至少一个章节
- 正文生成不得使用其他企业资料
- 模型失败必须有可解释降级路径

### 7.3 输出侧 Guardrails

- 不得编造证书编号、人员姓名、合同金额、日期
- 高风险缺失项必须阻断导出或强提示
- 输出正文必须保留“待补充”占位
- 合规报告必须声明“辅助参考”
- Word 导出失败必须记录降级原因

## 8. 当前项目实施 Harness 的优先级

### P0：立即可做，不改变业务形态

1. 建立 `eval_cases/` 样本目录。
2. 从现有 tests 中抽出 RAG、合规、大纲、解析的固定 case。
3. 为每个 AI stage 定义质量指标。
4. 新增离线 eval runner，输出 JSON/Markdown 报告。
5. 将当前电网 5-10 份样本整理为 Golden Set。

### P1：发布门禁

1. 在 CI 或本地发布脚本中运行 eval。
2. 设定最低分阈值。
3. 关键指标不通过禁止发布：
   - 高风险漏报
   - 多企业数据泄露
   - RAG 召回严重下降
   - DOCX 导出不可用

### P2：Trace 与线上监控

1. 将 `ai_usage_logs` 扩展为 trace 体系。
2. 每次请求记录 prompt version、retrieved IDs、scores、output hash。
3. 线上采样自动评分。
4. 增加质量看板：
   - 阶段成功率
   - 平均质量分
   - 高风险项漏报率
   - RAG 命中率
   - 成本/质量比

### P3：反馈闭环

1. 前端增加“回答是否有用/是否引用错误/是否编造”反馈。
2. 高价值失败样本进入人工复核队列。
3. 人工标签回流 eval_cases。
4. Prompt、模型、RAG 策略按 eval 分数迭代。

## 9. 推荐的评分器组合

### 9.1 确定性评分器

适用于：

- JSON schema 是否完整
- 必填字段是否存在
- 页码证据是否存在
- 章节数量是否达标
- 是否跨企业访问
- 是否包含禁用词
- 是否输出 Markdown 表格
- 是否保留占位符

优势：稳定、便宜、适合作为 CI 门禁。

### 9.2 LLM Judge

适用于：

- 正文专业度
- 条款响应充分性
- 证据是否支持结论
- 合规复核 status 是否合理
- 大纲结构是否贴合评分项

注意：LLM Judge 本身也要被人工校准，不能无条件信任。

### 9.3 人工专家复核

适用于：

- 首批 Golden Set
- 高风险废标项
- 客户验收样本
- LLM Judge 低置信度样本
- 线上负反馈样本

## 10. 与电网改造的结合方式

电网项目不应先大量改 Prompt 再凭感觉验收。建议从第一周就建立 Harness：

### 10.1 电网一期 MVP Harness

围绕系统功能清单 1：

- 国网样本解析 eval
- 电网字段抽取 eval
- 电网分册大纲 eval
- 电网资信库/产品库召回 eval
- 电网正文生成 rubric
- 条款响应检查 eval
- Word 导出 eval

### 10.2 电网二期多企业 Harness

围绕系统功能清单 2：

- 企业账号隔离 eval
- 企业知识库隔离 eval
- 企业用量统计隔离 eval
- 相似内容检查 eval
- 增强合规扫描 eval
- 资质匹配与到期提示 eval
- 文本差异化表达 eval

其中，多企业隔离必须作为最高优先级，因为这是客户看中的核心点，也是生产风险最大的点。

## 11. 风险与注意事项

### 11.1 不建议一开始引入过重平台

可以先用轻量本地 runner + JSONL case + Markdown 报告，不必立即接入完整商业 LLMOps 平台。当前项目阶段更需要可落地的质量门禁，而不是复杂工具栈。

### 11.2 注意日志敏感信息

当前 `record_ai_usage_log()` 会记录 `input_text` 和 `output_text`。这对调试和 eval 有价值，但生产环境可能包含企业资质、标书正文、合同金额、人员信息。建议后续支持：

- 敏感字段脱敏
- 按环境开关记录全文
- 仅保存 hash/摘要/采样文本
- 多企业日志隔离
- 日志保留周期

### 11.3 Prompt 硬编码会阻碍 Harness

当前多个文件仍硬编码“水利工程”角色和行业话术。电网改造时应把 Prompt 模板和行业 Profile 分离，否则 eval 结果难以复用和比较。

### 11.4 不要把 Harness 等同于测试数量

当前已有 60+ 后端测试是优势，但 Harness 关注的是“AI 输出质量是否稳定符合业务目标”。测试通过不代表标书质量合格。

## 12. 建议验收口径

如果要把 Harness 工程纳入电网项目质量保障，可以在内部技术验收中采用：

```text
1. 建立不少于 5 份国网招标文件样本的 Golden Set。
2. 一期上线前完成解析、大纲、RAG、正文、合规、导出六类 Eval。
3. 二期上线前完成多企业隔离、相似内容检查、资质匹配、增强合规四类 Eval。
4. 高风险否决项漏报数为 0。
5. 多企业跨企业数据召回和文件访问为 0。
6. 每次模型、Prompt、RAG 规则调整后，必须运行核心 Eval 并保留报告。
```

## 13. 最终建议

本项目应采用 Harness 工程思想，并建议将其作为电网商业化版本的底层质量工程能力。

推荐实施原则：

1. **先轻后重**：先做 JSONL case + runner + scorer + report，不急于接复杂平台。
2. **先业务后工具**：先定义标书业务的成功标准，再选 Harness 工具。
3. **先高风险后全量**：优先覆盖否决项、资质、评分项、多企业隔离。
4. **先离线后线上**：先做发布前 eval，再做线上 trace 和 drift monitoring。
5. **先可解释后自动化**：先让每个分数能追溯原因，再进入 CI 门禁。

在当前代码基础上，Harness 化不是大改系统，而是把已有的 LLM 调用、RAG、合规、测试、用量日志组织成一套正式的生产质量闭环。对电网项目来说，这套能力会直接提高客户验收确定性，也能保护乙方：当客户质疑“AI 生成不稳定”时，可以用固定样本、评估报告、质量分数和人工复核记录来说明系统边界与改进路径。

## 14. 参考资料

- OpenAI Evaluation Best Practices  
  https://developers.openai.com/api/docs/guides/evaluation-best-practices
- OpenAI Evals  
  https://github.com/openai/evals
- Harness Evals  
  https://github.com/harness/harness-evals
- OpenAI: How evals drive the next chapter in AI for businesses  
  https://openai.com/index/evals-drive-next-chapter-of-ai/
- Braintrust: What is LLM observability?  
  https://www.braintrust.dev/articles/llm-observability-guide
- NIST AI Risk Management Framework  
  https://www.nist.gov/itl/ai-risk-management-framework

