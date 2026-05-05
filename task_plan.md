# Task Plan: 用户侧二分法投标包调整

## Goal
从真实用户使用角度，把第一层分册体验调整为技术标 / 商务标二分法；资格、报价、附件继续作为商务标内部资料类型保留，并同步 TODO 与 README 状态。

## Phases
- [x] Phase 1: 定位首页分册概览、工作台 Tabs 和导出过滤逻辑
- [x] Phase 2: 前端第一层改为全部 / 技术标 / 商务标
- [x] Phase 3: 后端商务标导出聚合资格、报价、附件和其他内部类型
- [x] Phase 4: 同步 TODO、README 和 notes
- [x] Phase 5: 构建/静态验证与交付

## Key Questions
1. 如何不丢失资格、报价、附件的内部策略能力，同时避免用户误以为要提交多个独立文件？
2. 商务标导出是否应包含内部 `business`、`qualification`、`price`、`attachment` 和 `other`？
3. 章节正文顶部是否需要同时显示用户侧分册和内部资料类型？

## Decisions Made
- 用户第一层只展示 `技术标` 和 `商务标`，`全部` 作为总览保留。
- 内部 `qualification`、`price`、`attachment`、`other` 全部归入用户侧 `商务标`，继续用于写作策略、资料召回和风险控制。
- 商务标 DOCX 导出按用户侧投标包聚合，而不是只导出内部 `business` 小类。

## Errors Encountered
- None.

## Status
**Complete** - 用户侧二分法投标包调整已完成，TODO 与 README 已同步，后端编译和前端构建验证通过。

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
