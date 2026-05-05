# Task Plan: 技术标 / 商务标分册大纲升级

## Goal
按 `docs/技术标商务标分册整改TODO.md` 推进下一阶段编码，让章节大纲生成支持真实投标分册结构，并同步 TODO 与 README 状态。

## Phases
- [x] Phase 1: 读取整改 TODO、README 和现有章节生成链路
- [x] Phase 2: 后端分册大纲结构改造
- [x] Phase 3: 前端类型兼容与文档同步
- [x] Phase 4: 构建/静态验证
- [x] Phase 5: 总结交付

## Key Questions
1. 如何在不破坏现有 `chapters` 前端消费方式的前提下支持 `volumes`？
2. 规则版 fallback 和 AI 输出是否都能稳定写入 `metadata.volume_type`？
3. README 与 TODO 如何准确反映已完成和仍待办事项？

## Decisions Made
- 采用兼容结构：后端保存 `volumes` 作为业务分册结构，同时继续输出扁平 `chapters` 给现有工作台、解读页和导出接口使用。
- 暂不新增数据库表，继续通过 `bid_sections.metadata.volume_type`、`volume_name`、`export_group` 承载分册归属。
- 本轮优先完成 TODO 阶段三，并同步 README 阶段十相关文档项。

## Errors Encountered
- None.

## Status
**Complete** - 阶段三分册大纲升级已完成，TODO 与 README 已同步，构建验证通过。

## Archived Previous Plan: 本地带图片标书 MVP

### Goal
为 Mac M1 本地环境规划一个能从产品 PDF 手册抽取图片、检索匹配素材、生成带图片 Word 标书的最小可用 MVP。

### Phases
- [x] Phase 1: 识别现有项目结构
- [x] Phase 2: 梳理 MVP 技术路线
- [x] Phase 3: 输出编码设计与实施步骤
- [ ] Phase 4: 后续按规划实现代码

### Decisions Made
- 沿用现有 Flask + SQLite + ChromaDB 原型：当前项目已有上传、文本向量化、通义调用、Markdown 转 Word 能力，MVP 不需要重构为 FastAPI/PostgreSQL。
- 图片检索先用结构化元数据 + 周边文本 embedding：营业执照、产品图、手册插图是确定性素材，多模态检索作为后续增强。
- PDF 图片抽取优先用 PyMuPDF：Mac M1 安装简单，能抽文字、图片、页码和图片位置，适合最小闭环。
- Word 插图通过扩展 md_to_word.py 支持 Markdown 图片语法：生成阶段输出 `![图注](本地图片路径)`，导出阶段插入真实图片。
