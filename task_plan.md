# Task Plan: 企业资信库/产品库图片批量导入

## Goal
将 `assets/credit_database` 和 `assets/product_database` 中的脱敏合成图片批量导入知识库，并补充结构化属性、语义标签、适用章节和检索文本，支撑后续标书编制和智能客服图文检索。

## Scope
- 企业资信库：证照、人员证书、业绩材料、商务响应模板等脱敏样张。
- 产品库：水利施工设备、检测仪器、安全文明施工设施、技术标图表模板等白底展示图。
- 导入目标：`knowledge_assets` 表和 Supabase Storage。

## Phases
- [x] Phase 1: 梳理现有知识库上传和检索链路
- [x] Phase 2: 编写批量导入脚本，支持 dry-run、去重、Storage 上传、元数据入库和 embedding
- [x] Phase 3: 按文件名和 prompt 语义补齐资信库、产品库分类规则
- [x] Phase 4: 实际导入 31 张图片资产，并生成导入报告
- [x] Phase 5: 针对新增 8 张产品图校准类别、标签和适用章节
- [x] Phase 6: 编译校验和 dry-run 校验

## Commands
```bash
python scripts/batch_import_mock_assets.py --dry-run
python scripts/batch_import_mock_assets.py
python scripts/batch_import_mock_assets.py --no-embedding
```

## Result
- 已导入总数：31 张。
- 企业资信库：23 张。
- 产品库：8 张。
- 导入报告：`outputs/mock_asset_import_report.json`。
- 已校准产品库重点分类：
  - `主要机械设备和劳动力配置计划模板（脱敏样张）` -> `技术标图表模板`
  - `水利工程安全文明施工标准化设施产品展示图` -> `安全文明施工设施`

## Acceptance Criteria
- [x] 不需要逐张手工上传图片。
- [x] 每张图片有标题、分类、标签、适用章节、推荐分册、检索文本。
- [x] 产品库白底设备/图表类图片可按设备、参数、施工章节和技术标场景检索。
- [x] 资信库脱敏样张明确标注为测试占位，避免误作正式投标原件。
- [x] 后续新增图片可重复运行脚本，默认跳过已存在资产。

## Notes
- 正式企业资料上线前，应将脱敏样张替换为真实证照、证书、业绩和产品资料，并由业务人员复核。
- 若只想补充结构化资料、不生成向量，可使用 `--no-embedding`。
