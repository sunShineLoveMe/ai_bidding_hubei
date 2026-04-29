from typing import Any

from db_supabase import get_project_interpretation


def _normalize(value: Any) -> str:
    return str(value or "").replace(" ", "").replace("\n", "").replace("\t", "").lower()


def _meaningful(value: str, length: int = 8) -> bool:
    return len(value) >= length


def _mapped_values(section: dict[str, Any], field: str) -> list[str]:
    values = section.get(field) or []
    if not isinstance(values, list):
        return []
    return [_normalize(value) for value in values if value]


def _match_section(content: str, sections: list[dict[str, Any]], check_type: str) -> dict[str, Any] | None:
    target = _normalize(content)
    mapped_field = {
        "requirement": "mapped_requirements",
        "scoring": "mapped_scoring_items",
        "risk": "mapped_risks",
    }[check_type]

    for section in sections:
        mapped_matched = any(
            _meaningful(value) and (value in target or target[:60] in value)
            for value in _mapped_values(section, mapped_field)
        )
        title = _normalize(section.get("title"))
        title_matched = _meaningful(title) and (title in target or target[:16] in title)
        content_matched = _meaningful(target) and target[:40] in _normalize(section.get("content"))
        if mapped_matched or title_matched or content_matched:
            return section
    return None


def _row(
    *,
    row_id: str,
    category: str,
    importance: str,
    content: str,
    status: str,
    section: dict[str, Any] | None,
    source_page: int | None,
    source_text: str | None,
) -> dict[str, Any]:
    return {
        "id": row_id,
        "category": category,
        "importance": importance,
        "content": content,
        "status": status,
        "matchedChapter": section.get("title") if section else None,
        "matchedChapterId": section.get("id") if section else None,
        "sourcePage": source_page,
        "sourceText": source_text or content,
    }


def build_compliance_report(project_id: str) -> dict[str, Any]:
    payload = get_project_interpretation(project_id)
    project = payload.get("project")
    sections = payload.get("sections") or []
    rows: list[dict[str, Any]] = []

    for item in payload.get("requirements") or []:
        content = item.get("content") or item.get("title") or ""
        if not content:
            continue
        section = _match_section(content, sections, "requirement")
        rows.append(_row(
            row_id=f"requirement-{item.get('id')}",
            category="要求条款",
            importance=item.get("priority") or item.get("requirement_type") or "medium",
            content=content,
            status="covered" if section else "missing",
            section=section,
            source_page=item.get("source_page"),
            source_text=item.get("source_text") or item.get("content"),
        ))

    for item in payload.get("scoringItems") or []:
        content = item.get("item") or item.get("requirement") or ""
        if not content:
            continue
        section = _match_section(content, sections, "scoring")
        rows.append(_row(
            row_id=f"scoring-{item.get('id')}",
            category="评分项",
            importance=f"{item.get('score')}分" if item.get("score") else item.get("category") or "medium",
            content=content,
            status="covered" if section else "partial",
            section=section,
            source_page=item.get("source_page"),
            source_text=item.get("source_text") or item.get("requirement") or item.get("item"),
        ))

    for item in payload.get("risks") or []:
        content = item.get("content") or ""
        if not content:
            continue
        section = _match_section(content, sections, "risk")
        rows.append(_row(
            row_id=f"risk-{item.get('id')}",
            category="风险项",
            importance=item.get("risk_level") or item.get("risk_type") or "medium",
            content=content,
            status="covered" if section else "missing",
            section=section,
            source_page=item.get("source_page"),
            source_text=item.get("source_text") or item.get("content"),
        ))

    total = len(rows)
    covered = sum(1 for row in rows if row["status"] == "covered")
    partial = sum(1 for row in rows if row["status"] == "partial")
    missing = sum(1 for row in rows if row["status"] == "missing")
    percent = round(((covered + partial * 0.5) / total) * 100) if total else 0

    missing_rows = [row for row in rows if row["status"] == "missing"]
    high_risk_missing = [
        row for row in missing_rows
        if row["category"] == "风险项" or str(row.get("importance")).lower() in {"high", "red", "否决", "废标"}
    ]

    recommendations = []
    if missing:
        recommendations.append("优先补齐未覆盖的资格要求、否决风险和强制性响应条款。")
    if partial:
        recommendations.append("评分项中“待补强”的内容建议补充证明材料、页码索引和可量化承诺。")
    if not sections:
        recommendations.append("当前尚未生成标书章节大纲，请先生成章节大纲后再执行覆盖检查。")
    if not recommendations:
        recommendations.append("当前章节已覆盖主要解析项，建议继续做正文质量、格式和附件完整性复核。")

    return {
        "projectId": project_id,
        "projectName": project.get("project_name") if project else None,
        "summary": {
            "total": total,
            "covered": covered,
            "partial": partial,
            "missing": missing,
            "percent": percent,
            "highRiskMissing": len(high_risk_missing),
        },
        "rows": rows,
        "recommendations": recommendations,
    }
