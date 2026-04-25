import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

from db_supabase import replace_bid_analysis, replace_project_rows


KEYWORD_GROUPS = {
    "资格要求": ["资质", "资格", "业绩", "信誉", "财务", "项目经理", "技术负责人", "联合体"],
    "商务要求": ["投标保证金", "投标有效期", "投标截止", "报价", "合同", "付款", "履约"],
    "技术要求": ["技术", "质量", "工期", "施工", "设计", "采购", "验收", "发包人要求"],
    "文件要求": ["投标文件", "电子投标", "签章", "上传", "递交", "格式", "目录"],
}

RISK_KEYWORDS = ["否决", "无效", "不予受理", "废标", "不得", "不接受", "逾期", "未按", "视为"]

SCORING_KEYWORDS = ["评分", "分值", "评审", "得分", "综合评估", "评标办法"]


def _read_json(path: str | None) -> Any:
    if not path:
        return None
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _read_text(path: str | None) -> str:
    if not path:
        return ""
    return Path(path).read_text(encoding="utf-8")


def _normalize_text(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text.replace("\r\n", "\n")).strip()


def _paragraphs(markdown: str) -> list[str]:
    parts = re.split(r"\n{2,}", markdown)
    return [_normalize_text(item) for item in parts if len(_normalize_text(item)) >= 12]


def _source_page_by_snippet(content_list: list[dict[str, Any]], snippet: str) -> int | None:
    if not snippet:
        return None
    needle = re.sub(r"\s+", "", snippet[:40])
    for item in content_list:
        text = re.sub(r"\s+", "", str(item.get("text") or ""))
        if needle and needle in text:
            page_idx = item.get("page_idx")
            return int(page_idx) + 1 if isinstance(page_idx, int) else None
    return None


def _heading_before(markdown: str, offset: int) -> str | None:
    prefix = markdown[:offset]
    matches = re.findall(r"^#{1,6}\s+(.+)$", prefix, flags=re.MULTILINE)
    return matches[-1].strip() if matches else None


def extract_project_meta(markdown: str) -> dict[str, Any]:
    title_match = re.search(r"#\s*(.+?（项目名称）.+?)(?:\n|$)", markdown)
    tender_no_match = re.search(r"招标编号[:：]\s*([A-Za-z0-9\-]+)", markdown)
    project_name = None
    if title_match:
        project_name = re.sub(r"\s+", "", title_match.group(1))
        project_name = project_name.split("（项目名称）")[0]

    return {
        "project_name": project_name,
        "tender_no": tender_no_match.group(1) if tender_no_match else None,
        "document_type": "招标文件",
        "parser": "mineru",
    }


def extract_requirements(markdown: str, content_list: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for paragraph in _paragraphs(markdown):
        compact = paragraph[:500]
        for requirement_type, keywords in KEYWORD_GROUPS.items():
            if any(keyword in compact for keyword in keywords):
                key = f"{requirement_type}:{compact[:120]}"
                if key in seen:
                    continue
                seen.add(key)
                offset = markdown.find(paragraph[:30])
                rows.append({
                    "requirement_type": requirement_type,
                    "title": compact[:80],
                    "content": compact,
                    "priority": "high" if any(k in compact for k in ["必须", "应当", "不得", "否决", "不接受"]) else "medium",
                    "source_section": _heading_before(markdown, max(0, offset)) if offset >= 0 else None,
                    "source_page": _source_page_by_snippet(content_list, paragraph),
                    "source_text": compact,
                })
                break
        if len(rows) >= 80:
            break
    return rows


def extract_risks(markdown: str, content_list: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for paragraph in _paragraphs(markdown):
        if not any(keyword in paragraph for keyword in RISK_KEYWORDS):
            continue
        compact = paragraph[:600]
        key = compact[:160]
        if key in seen:
            continue
        seen.add(key)
        offset = markdown.find(paragraph[:30])
        rows.append({
            "risk_level": "high" if any(k in compact for k in ["否决", "无效", "废标", "不予受理"]) else "medium",
            "risk_type": "否决/无效风险" if any(k in compact for k in ["否决", "无效", "废标"]) else "合规风险",
            "content": compact,
            "action": "生成投标文件前必须逐条校核并提供原文响应。",
            "source_section": _heading_before(markdown, max(0, offset)) if offset >= 0 else None,
            "source_page": _source_page_by_snippet(content_list, paragraph),
            "source_text": compact,
        })
        if len(rows) >= 60:
            break
    return rows


def extract_scoring_items(markdown: str, content_list: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for paragraph in _paragraphs(markdown):
        if not any(keyword in paragraph for keyword in SCORING_KEYWORDS):
            continue
        if "分" not in paragraph and "评审" not in paragraph:
            continue
        compact = paragraph[:600]
        key = compact[:160]
        if key in seen:
            continue
        seen.add(key)
        score_match = re.search(r"(\d+(?:\.\d+)?)\s*分", compact)
        offset = markdown.find(paragraph[:30])
        rows.append({
            "category": "评标办法",
            "item": compact[:120],
            "score": float(score_match.group(1)) if score_match else None,
            "requirement": compact,
            "response_suggestion": "投标章节应围绕该评分点提供可量化响应、证明材料和页码索引。",
            "target_chapter": "投标响应文件",
            "source_section": _heading_before(markdown, max(0, offset)) if offset >= 0 else None,
            "source_page": _source_page_by_snippet(content_list, paragraph),
            "source_text": compact,
        })
        if len(rows) >= 80:
            break
    return rows


def extract_chapter_suggestions(markdown: str) -> list[dict[str, Any]]:
    headings = [item.strip() for item in re.findall(r"^#{1,3}\s+(.+)$", markdown, flags=re.MULTILINE)]
    selected: list[str] = []
    for heading in headings:
        if any(keyword in heading for keyword in ["投标文件格式", "资格", "评标办法", "发包人要求", "合同", "技术", "项目管理"]):
            if heading not in selected:
                selected.append(heading)
        if len(selected) >= 30:
            break

    return [
        {
            "chapter_title": heading[:160],
            "reason": "来源于招标文件目录/章节结构，建议作为投标响应或校核章节。",
            "related_requirements": [],
            "priority": "high" if any(k in heading for k in ["资格", "评标办法", "发包人要求"]) else "medium",
        }
        for heading in selected
    ]


def build_document_chunks(
    *,
    markdown: str,
    content_list: list[dict[str, Any]],
    project_id: str,
    document_id: str | None,
    parse_id: str,
    bid_file_id: str | None,
    max_chars: int = 1800,
) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    current: list[str] = []
    current_page: int | None = None
    current_section: str | None = None

    def flush() -> None:
        nonlocal current, current_page, current_section
        content = "\n".join(current).strip()
        if not content:
            return
        chunks.append({
            "project_id": project_id,
            "document_id": document_id,
            "chunk_index": len(chunks),
            "content": content,
            "source_page": current_page,
            "source_section": current_section,
            "metadata": {
                "parse_id": parse_id,
                "bid_file_id": bid_file_id,
                "parser": "mineru",
                "source": "content_list",
            },
        })
        current = []
        current_page = None
        current_section = None

    for item in content_list:
        text = _normalize_text(str(item.get("text") or ""))
        if not text:
            continue
        page_idx = item.get("page_idx")
        page_no = int(page_idx) + 1 if isinstance(page_idx, int) else None
        if item.get("text_level") in {1, 2, 3} and len(text) <= 120:
            current_section = text
        if sum(len(part) for part in current) + len(text) > max_chars:
            flush()
        current.append(text)
        current_page = current_page or page_no
    flush()

    if chunks:
        return chunks

    for idx, start in enumerate(range(0, len(markdown), max_chars)):
        content = markdown[start:start + max_chars].strip()
        if content:
            chunks.append({
                "project_id": project_id,
                "document_id": document_id,
                "chunk_index": idx,
                "content": content,
                "metadata": {"parse_id": parse_id, "bid_file_id": bid_file_id, "parser": "mineru", "source": "markdown"},
            })
    return chunks


def build_analysis_summary(
    *,
    markdown: str,
    content_list: list[dict[str, Any]],
    artifacts: dict[str, Any],
    requirements: list[dict[str, Any]],
    scoring_items: list[dict[str, Any]],
    risks: list[dict[str, Any]],
    chapter_suggestions: list[dict[str, Any]],
) -> dict[str, Any]:
    type_counter = Counter(str(item.get("type") or "unknown") for item in content_list)
    return {
        "project_meta": extract_project_meta(markdown),
        "qualification_requirements": [item for item in requirements if item["requirement_type"] == "资格要求"][:30],
        "document_checklist": [item for item in requirements if item["requirement_type"] == "文件要求"][:30],
        "scoring_items": scoring_items[:40],
        "risk_items": risks[:40],
        "chapter_suggestions": chapter_suggestions[:30],
        "summary": (
            f"MinerU 已解析招标文件，Markdown 字符数 {len(markdown)}，"
            f"结构块 {len(content_list)} 个，块类型统计 {dict(type_counter)}。"
        ),
        "artifacts": artifacts,
    }


def ingest_mineru_artifacts_to_supabase(
    *,
    parse_id: str,
    project_id: str,
    bid_file_id: str | None,
    artifacts: dict[str, Any],
) -> dict[str, Any]:
    markdown = _read_text(artifacts.get("markdown_path"))
    content_list = _read_json(artifacts.get("content_list_path")) or []
    if not isinstance(content_list, list):
        content_list = []

    requirements = extract_requirements(markdown, content_list)
    risks = extract_risks(markdown, content_list)
    scoring_items = extract_scoring_items(markdown, content_list)
    chapter_suggestions = extract_chapter_suggestions(markdown)
    analysis = build_analysis_summary(
        markdown=markdown,
        content_list=content_list,
        artifacts=artifacts,
        requirements=requirements,
        scoring_items=scoring_items,
        risks=risks,
        chapter_suggestions=chapter_suggestions,
    )

    replace_bid_analysis(project_id, {
        "project_id": project_id,
        "project_meta": analysis["project_meta"],
        "qualification_requirements": analysis["qualification_requirements"],
        "document_checklist": analysis["document_checklist"],
        "scoring_items": analysis["scoring_items"],
        "risk_items": analysis["risk_items"],
        "chapter_suggestions": analysis["chapter_suggestions"],
        "summary": analysis["summary"],
    })
    replace_project_rows("bid_requirements", project_id, [{"project_id": project_id, **item} for item in requirements])
    replace_project_rows("bid_risks", project_id, [{"project_id": project_id, **item} for item in risks])
    replace_project_rows("bid_scoring_items", project_id, [{"project_id": project_id, **item} for item in scoring_items])
    replace_project_rows("bid_chapter_suggestions", project_id, [{"project_id": project_id, **item} for item in chapter_suggestions])

    chunks = build_document_chunks(
        markdown=markdown,
        content_list=content_list,
        project_id=project_id,
        document_id=None,
        bid_file_id=bid_file_id,
        parse_id=parse_id,
    )
    replace_project_rows("document_chunks", project_id, chunks)

    return {
        "project_id": project_id,
        "bid_file_id": bid_file_id,
        "markdown_chars": len(markdown),
        "content_blocks": len(content_list),
        "requirements": len(requirements),
        "risks": len(risks),
        "scoring_items": len(scoring_items),
        "chapter_suggestions": len(chapter_suggestions),
        "chunks": len(chunks),
    }
