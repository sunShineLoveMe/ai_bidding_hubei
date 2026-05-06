# Task Plan: DOCX 图片导出质量修复

## Goal
确保正式标书 DOCX 导出使用原图或清晰压缩图，同时前端资料预览继续使用缩略图。

## Phases
- [x] Phase 1: 确认图片预览与 DOCX 导出链路边界
- [x] Phase 2: 实现导出原图优先引用和清晰压缩
- [x] Phase 3: 同步 TODO、README 和 notes
- [x] Phase 4: 运行后端编译与 DOCX 图片验证

## Decisions Made
- 前端资信库、产品库预览继续请求 `variant=thumb`，不改变用户查看资料的加载速度。
- DOCX 导出链路优先使用本地原图路径；没有本地文件时使用后端知识资产原图接口 `variant=original`。
- Markdown 转 Word 时保留普通尺寸原图；超过阈值的图片按 2400px 长边和高质量参数压缩，避免 Word 文件过大或插图失败。

## Errors Encountered
- 临时 DOCX 图片验证脚本第一次使用 `python -c` 拼接多行循环，触发命令行换行转义语法错误；改为一行表达式重跑。

## Status
**Complete** - DOCX 导出图片链路已完成，后端编译、原图 URL 纠偏和临时 DOCX 嵌图验证通过。
