import re
from typing import Any, Iterator

from app_config import build_enterprise_context
from bid_writing_plan import ensure_chapter_writing_plan
from db_supabase import get_project_interpretation
from qwen_client import call_dashscope_api, stream_dashscope_api


def _text(value: Any) -> str:
    return str(value) if value is not None else ""


def _compact_list(items: list[str] | None, limit: int = 6) -> str:
    values = [item for item in (items or []) if item]
    return "\n".join(f"- {item}" for item in values[:limit]) or "- 需人工复核"


def _chunk_text(content: str, size: int = 90) -> Iterator[str]:
    parts = re.split(r"(\n+)", content)
    current = ""
    for part in parts:
        if len(current) + len(part) >= size:
            if current:
                yield current
            current = part
        else:
            current += part
    if current:
        yield current


def build_section_prompt(project_id: str, chapter: dict[str, Any]) -> str:
    payload = get_project_interpretation(project_id)
    project = payload.get("project") or {}
    analysis = payload.get("analysis") or {}
    project_meta = analysis.get("project_meta") or {}

    title = _text(chapter.get("title")) or "未命名章节"
    purpose = _text(chapter.get("purpose"))
    writing_plan = ensure_chapter_writing_plan(chapter)
    context = {
        "project_name": project_meta.get("project_name") or project.get("project_name"),
        "tender_no": project_meta.get("tender_no") or project.get("project_no"),
        "summary": analysis.get("summary"),
        "chapter_title": title,
        "chapter_purpose": purpose,
        "response_points": chapter.get("response_points") or [],
        "mapped_requirements": chapter.get("mapped_requirements") or [],
        "mapped_scoring_items": chapter.get("mapped_scoring_items") or [],
        "mapped_risks": chapter.get("mapped_risks") or [],
        "required_materials": chapter.get("required_materials") or [],
        "source_pages": chapter.get("source_pages") or [],
        "writing_notes": chapter.get("writing_notes") or [],
        "writing_plan": writing_plan,
    }

    enterprise_context = build_enterprise_context()

    return f"""
你是资深投标文件撰写专家，熟悉水利水电工程总承包、设备配套、质量管理和招投标文件格式要求。
企业画像：
{enterprise_context}

请为当前投标章节生成可直接放入标书的正文草稿。

写作要求：
1. 只输出章节正文，不要解释你如何生成。
2. 语言正式、稳健、可落地，符合国内投标文件表达习惯。
3. 不要编造企业没有提供的证书编号、人员姓名、合同金额、具体日期；遇到缺失信息，用“【待补充：...】”占位。
4. 必须回应章节目标、响应要点、评分项和风险点。
5. 如适合表格，用 Markdown 表格输出。
6. 正文字数按章节写作计划控制。本次生成尽量覆盖完整章节；若目标字数较长，可先输出结构完整的第一版，并保留可续写的小标题。

项目信息：
- 项目名称：{context["project_name"] or "需人工复核"}
- 招标编号：{context["tender_no"] or "需人工复核"}
- 项目摘要：{context["summary"] or "需人工复核"}

当前章节：
- 标题：{title}
- 编写目标：{purpose or "需人工复核"}
- 来源页码：{context["source_pages"] or "需人工复核"}

章节写作计划：
- 重要性：{writing_plan.get("importance") or "medium"}
- 目标字数：{writing_plan.get("target_words") or "需人工复核"} 字
- 建议篇幅：{writing_plan.get("suggested_pages") or "需人工复核"} 页
- 生成方式：{writing_plan.get("generation_mode") or "single_pass"}
- 是否需要表格：{"是" if writing_plan.get("needs_table") else "否"}
- 是否需要图片/流程图：{"是" if writing_plan.get("needs_image") else "否"}
- 是否需要资质材料：{"是" if writing_plan.get("needs_qualification") else "否"}
- 是否需要业绩支撑：{"是" if writing_plan.get("needs_case") else "否"}
- 写作策略：{writing_plan.get("strategy") or "需人工复核"}

响应要点：
{_compact_list(context["response_points"])}

关联要求：
{_compact_list(context["mapped_requirements"])}

关联评分项：
{_compact_list(context["mapped_scoring_items"])}

风险提醒：
{_compact_list(context["mapped_risks"])}

需要准备的资料：
{_compact_list(context["required_materials"])}

写作注意事项：
{_compact_list(context["writing_notes"])}
""".strip()


def stream_bid_section(project_id: str, chapter: dict[str, Any]) -> Iterator[dict[str, Any]]:
    prompt = build_section_prompt(project_id, chapter)
    yield {
        "type": "start",
        "title": chapter.get("title") or "未命名章节",
    }

    emitted = False
    try:
        for chunk in stream_dashscope_api([{"role": "user", "content": prompt}]):
            emitted = True
            yield {
                "type": "chunk",
                "content": chunk,
            }
    except Exception:
        response = call_dashscope_api([{"role": "user", "content": prompt}], json_mode=False)
        content = response["output"]["choices"][0]["message"]["content"]
        for chunk in _chunk_text(content):
            emitted = True
            yield {
                "type": "chunk",
                "content": chunk,
            }

    if not emitted:
        yield {
            "type": "chunk",
            "content": "【待补充：当前章节正文生成失败，请稍后重新生成。】",
        }

    yield {
        "type": "done",
    }
