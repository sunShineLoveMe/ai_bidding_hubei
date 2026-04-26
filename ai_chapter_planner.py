import json
import re
from datetime import datetime, timezone
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
    rows: list[dict[str, Any]] = []
    for item in items[:limit]:
        row: dict[str, Any] = {}
        for field in fields:
            value = item.get(field)
            if value not in (None, ""):
                row[field] = value
        rows.append(row)
    return rows


def _build_rule_outline(payload: dict[str, Any]) -> dict[str, Any]:
    project = payload.get("project") or {}
    analysis = payload.get("analysis") or {}
    project_meta = analysis.get("project_meta") or {}
    ai_report = project_meta.get("ai_report") or {}

    base_chapters = [
        ("投标函及投标函附录", "响应招标文件投标函、报价、工期、质量等基础承诺。", "high"),
        ("法定代表人身份证明及授权委托书", "放置法定代表人身份证明、授权委托书、被授权人身份证明等签章文件。", "high"),
        ("联合体协议书及承诺文件", "如允许或要求联合体投标，集中响应联合体牵头人、职责分工和承诺事项。", "medium"),
        ("投标保证金及财务承诺", "响应投标保证金、履约保证、财务状况和资金承诺要求。", "high"),
        ("资格审查资料", "集中放置营业执照、资质证书、安全生产许可、信誉声明、人员证书、业绩证明等材料。", "high"),
        ("类似项目业绩", "按招标文件评分和资格要求整理类似项目合同、中标通知书、验收证明、业主证明等。", "high"),
        ("项目管理机构", "展示项目经理、技术负责人、质量、安全、施工和资料管理人员配置及证书。", "high"),
        ("技术响应及偏离表", "逐条响应发包人要求、技术标准、合同条款和实质性要求，明确无偏离或偏离说明。", "high"),
        ("施工组织设计/实施方案", "围绕施工部署、进度、质量、安全、环保、资源配置和关键工序组织形成技术方案。", "high"),
        ("质量、安全、进度保障措施", "对评分项和履约风险做专项响应，突出过程控制、验收、应急和交付保障。", "medium"),
        ("商务响应文件", "响应付款、合同、服务、税费、廉政、保密、农民工工资等商务条款。", "medium"),
        ("报价文件及工程量清单", "按招标文件格式组织报价、清单、单价分析和相关说明。", "high"),
    ]

    requirements = payload.get("requirements") or []
    scoring_items = payload.get("scoringItems") or []
    risks = payload.get("risks") or []
    materials = ai_report.get("material_checklist") or []

    chapters: list[dict[str, Any]] = []
    for index, (title, purpose, priority) in enumerate(base_chapters, start=1):
        keyword = title[:4]
        mapped_requirements = [
            item.get("content") for item in requirements
            if item.get("content") and (keyword in item.get("content", "") or keyword in item.get("source_section", ""))
        ][:5]
        mapped_scoring = [
            item.get("item") for item in scoring_items
            if item.get("item") and (keyword in item.get("item", "") or keyword in item.get("source_section", ""))
        ][:4]
        mapped_risks = [
            item.get("content") for item in risks
            if item.get("content") and (keyword in item.get("content", "") or keyword in item.get("source_section", ""))
        ][:4]
        source_pages = sorted({
            item.get("source_page")
            for item in [*requirements, *scoring_items, *risks]
            if item.get("source_page") and (
                keyword in item.get("content", "")
                or keyword in item.get("item", "")
                or keyword in item.get("source_section", "")
            )
        })

        chapters.append({
            "order": index,
            "title": title,
            "priority": priority,
            "purpose": purpose,
            "response_points": mapped_requirements[:3] or ["需结合招标文件条款逐项响应，避免遗漏实质性要求。"],
            "mapped_requirements": mapped_requirements,
            "mapped_scoring_items": mapped_scoring,
            "mapped_risks": mapped_risks,
            "source_pages": source_pages[:8],
            "required_materials": [
                item.get("material") for item in materials
                if item.get("material") and (keyword in item.get("material", "") or title[:2] in item.get("category", ""))
            ][:5],
            "writing_notes": [
                "正文生成前先核对招标文件格式要求、签章要求和附件清单。",
                "章节内容应保留页码索引，便于后续评审响应和人工复核。",
            ],
        })

    return {
        "version": "rule-v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "project_name": project_meta.get("project_name") or project.get("project_name"),
        "tender_no": project_meta.get("tender_no") or project.get("project_no"),
        "summary": "基于招标解读结果生成的第一版投标文件章节大纲，可作为后续正文生成和 Word 排版输入。",
        "chapters": chapters,
        "next_steps": [
            "先人工确认章节是否覆盖招标文件格式和实质性条款。",
            "补齐企业资信、人员证书、业绩和产品资料后，再进入单章节正文生成。",
            "优先生成资格审查资料、技术响应及施工组织设计等高风险章节。",
        ],
    }


def _build_prompt(payload: dict[str, Any]) -> str:
    project = payload.get("project") or {}
    analysis = payload.get("analysis") or {}
    project_meta = analysis.get("project_meta") or {}
    ai_report = project_meta.get("ai_report") or {}

    context = {
        "project": {
            "project_name": project_meta.get("project_name") or project.get("project_name"),
            "tender_no": project_meta.get("tender_no") or project.get("project_no"),
            "summary": analysis.get("summary"),
            "ai_core_conclusion": (ai_report.get("project_brief") or {}).get("core_conclusion"),
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
            45,
        ),
        "chapter_suggestions": _compact_items(
            payload.get("chapterSuggestions") or [],
            ["chapter_title", "priority", "reason"],
            30,
        ),
        "ai_document_plan": ai_report.get("document_plan") or [],
        "ai_material_checklist": ai_report.get("material_checklist") or [],
    }

    return f"""
你是资深水利工程投标文件编制负责人。请基于招标文件结构化解读，生成“投标文件章节目录 + 章节大纲”。

要求：
1. 面向后续自动生成标书正文，不要写完整正文。
2. 章节要覆盖资格、商务、技术、报价、格式文件、风险响应和评分响应。
3. 每个章节必须说明编写目标、响应点、关联要求、关联评分项、风险提醒、需要准备的资料、来源页码和写作注意事项。
4. 不要编造招标文件没有的信息；无法确认的写“需人工复核”。
5. 输出必须是严格 JSON，不要 Markdown，不要代码块。

输出 JSON 格式：
{{
  "version": "ai-v1",
  "project_name": "...",
  "tender_no": "...",
  "summary": "...",
  "chapters": [
    {{
      "order": 1,
      "title": "...",
      "priority": "high/medium/low",
      "purpose": "...",
      "response_points": ["..."],
      "mapped_requirements": ["..."],
      "mapped_scoring_items": ["..."],
      "mapped_risks": ["..."],
      "source_pages": [1, 2],
      "required_materials": ["..."],
      "writing_notes": ["..."]
    }}
  ],
  "next_steps": ["..."]
}}

结构化招标信息：
{json.dumps(context, ensure_ascii=False)}
""".strip()


def generate_bid_outline(project_id: str) -> dict[str, Any]:
    payload = get_project_interpretation(project_id)
    analysis = payload.get("analysis")
    if not analysis:
        raise RuntimeError("当前项目尚无结构化解读数据，请先完成招标文件解析和落库。")

    fallback_outline = _build_rule_outline(payload)
    prompt = _build_prompt(payload)
    response = call_dashscope_api([{"role": "user", "content": prompt}], json_mode=True)
    content = response["output"]["choices"][0]["message"]["content"]
    ai_outline = _strip_llm_json(content)

    if not isinstance(ai_outline.get("chapters"), list) or not ai_outline["chapters"]:
        ai_outline = fallback_outline
        ai_outline["version"] = "rule-v1-fallback"
    else:
        ai_outline["version"] = ai_outline.get("version") or "ai-v1"
        ai_outline["generated_at"] = datetime.now(timezone.utc).isoformat()
        ai_outline["model"] = response.get("model") or "dashscope"

    project_meta = analysis.get("project_meta") or {}
    project_meta["bid_outline"] = ai_outline

    updated = (
        get_supabase_client()
        .table("bid_analysis")
        .update({"project_meta": project_meta})
        .eq("id", analysis["id"])
        .execute()
    )
    if not updated.data:
        raise RuntimeError("标书章节大纲写回 Supabase 失败")

    return ai_outline
