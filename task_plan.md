# Task Plan: Word 图片显示不完整修复

## Goal
修复下载后的标书 DOCX 中图片只显示局部、被裁成横条的问题。

## Root Cause
- Word 正文样式使用固定 28 磅行距。
- `python-docx` 插入图片时，图片作为行内对象放在普通段落里。
- 图片段落继承固定行距后，Word 会按固定行高裁剪图片显示区域，导致只露出一部分图片。

## Phases
- [x] Phase 1: 定位 DOCX 图片插入逻辑
- [x] Phase 2: 为图片段落增加独立段落格式
- [x] Phase 3: 同步处理 Markdown 图片和 Mermaid 图片段落
- [x] Phase 4: 编译和临时 DOCX 样例验证

## Files Changed
- `backend/export/md_to_word.py`

## Decisions Made
- 正文段落继续保留正式标书所需的固定行距。
- 图片段落单独使用单倍行距、无首行缩进、上下保留少量间距，避免图片被 Word 裁剪。
- 图片宽度仍按页面宽度控制，不改变原始图片纵横比。

## Verification
```bash
python -m py_compile backend/export/md_to_word.py
```

临时 DOCX 样例验证结果：
- 文档中存在 `<w:drawing>` 图片对象。
- 图片所在段落使用 `w:lineRule="auto"`，不再继承固定 `exact` 行距。

## Status
**Complete** - Word 图片段落裁剪问题已修复，需重新导出标书后生效。
