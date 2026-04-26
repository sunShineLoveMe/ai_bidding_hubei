import json
import re
from typing import Any

from db_supabase import get_project_interpretation, get_supabase_client
from qwen_client import call_dashscope_api


def _strip_llm_json(content: str) -> dict[str, Any]:
    clean = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", clean, flags=re.DOTALL)
    if match:
        clean = match.group(1).strip()
    return json.loads(clean)


def _compact_items(items: list[dict[str, Any]], fields: list[str], limit: int) -> list[dict[str, Any]]:
    compacted: list[dict[str, Any]] = []
    for item in items[:limit]:
        row: dict[str, Any] = {}
        for field in fields:
            value = item.get(field)
            if value is not None:
                row[field] = value
        compacted.append(row)
    return compacted


def _build_prompt(payload: dict[str, Any]) -> str:
    project = payload.get("project") or {}
    analysis = payload.get("analysis") or {}
    project_meta = analysis.get("project_meta") or {}

    context = {
        "project": {
            "id": project.get("id"),
            "project_name": project_meta.get("project_name") or project.get("project_name"),
            "tender_no": project_meta.get("tender_no") or project.get("project_no"),
            "project_type": project.get("project_type"),
            "summary": analysis.get("summary"),
        },
        "requirements": _compact_items(
            payload.get("requirements") or [],
            ["requirement_type", "priority", "content", "source_section", "source_page", "source_text"],
            70,
        ),
        "risks": _compact_items(
            payload.get("risks") or [],
            ["risk_level", "risk_type", "content", "action", "source_section", "source_page", "source_text"],
            50,
        ),
        "scoring_items": _compact_items(
            payload.get("scoringItems") or [],
            ["category", "item", "score", "requirement", "response_suggestion", "source_page", "source_text"],
            40,
        ),
        "chapter_suggestions": _compact_items(
            payload.get("chapterSuggestions") or [],
            ["chapter_title", "priority", "reason"],
            30,
        ),
    }

    return f"""
你是资深水利工程招投标顾问，服务对象是湖北恩施清江峡能精密制造企业。
企业业务包括水轮机叶片、螺母、紧固件、金属结构件、设备配套加工、质量检验、交付保障和现场服务。

请基于下方已经结构化的招标文件信息，生成一份给非技术业务人员阅读的深度招标解读报告。
要求：
1. 不要复述系统处理过程，不要提 MinerU、OCR、分片。
2. 不要编造原文没有的信息；不确定的地方明确写“需人工复核”。
3. 每个重点建议尽量带来源页码，并在 evidence 字段引用压缩后的原文依据，不要只给结论。
4. 输出必须是严格 JSON，不要 Markdown，不要代码块。
5. JSON 字段必须与下面格式一致。

输出 JSON 格式：
{{
  "executive_summary": ["..."],
  "project_brief": {{
    "project_name": "...",
    "tender_no": "...",
    "procurement_scope": "...",
    "key_deadlines": ["..."],
    "core_conclusion": "..."
  }},
  "qualification_review": [
    {{"requirement": "...", "judgement": "需准备/需复核/风险较高", "evidence": "对应原文依据或来源章节", "source_page": 1, "action": "..."}}
  ],
  "scoring_strategy": [
    {{"scoring_point": "...", "score": null, "strategy": "...", "supporting_materials": ["..."], "source_page": 1, "evidence": "对应原文依据或来源章节"}}
  ],
  "risk_warnings": [
    {{"risk_level": "high/medium/low", "risk": "...", "impact": "...", "source_page": 1, "evidence": "对应原文依据或来源章节", "mitigation": "..."}}
  ],
  "document_plan": [
    {{"chapter": "...", "purpose": "...", "key_points": ["..."], "related_requirements": ["..."]}}
  ],
  "material_checklist": [
    {{"material": "...", "category": "资信/业绩/技术/商务/其他", "required": true, "owner": "企业/项目/人工复核", "note": "..."}}
  ],
  "next_actions": ["..."]
}}

结构化招标信息：
{json.dumps(context, ensure_ascii=False)}
""".strip()


def generate_ai_interpretation_report(project_id: str) -> dict[str, Any]:
    payload = get_project_interpretation(project_id)
    analysis = payload.get("analysis")
    if not analysis:
        raise RuntimeError("当前项目尚无结构化解读数据，请先完成 MinerU 解析和落库。")

    prompt = _build_prompt(payload)
    response = call_dashscope_api([{"role": "user", "content": prompt}], json_mode=True)
    content = response["output"]["choices"][0]["message"]["content"]
    ai_report = _strip_llm_json(content)

    project_meta = analysis.get("project_meta") or {}
    project_meta["ai_report"] = ai_report
    project_meta["ai_report_model"] = response.get("model") or "dashscope"

    updated = (
        get_supabase_client()
        .table("bid_analysis")
        .update({"project_meta": project_meta})
        .eq("id", analysis["id"])
        .execute()
    )
    if not updated.data:
        raise RuntimeError("AI 解读报告写回 Supabase 失败")

    return ai_report
