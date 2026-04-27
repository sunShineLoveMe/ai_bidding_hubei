import json
import re
import time
from datetime import datetime, timezone
from typing import Any, Iterator

from db_supabase import get_project_interpretation, get_supabase_client, replace_bid_sections_from_outline
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


def _text(value: Any) -> str:
    return str(value) if value is not None else ""


def _contains_keyword(item: dict[str, Any], keyword: str, fields: list[str]) -> bool:
    return any(keyword in _text(item.get(field)) for field in fields)


def _normalize_outline_chapters(chapters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    order_index = 0

    def visit(items: list[dict[str, Any]], level: int, prefix: str = "") -> None:
        nonlocal order_index
        for index, item in enumerate(items, start=1):
            order_index += 1
            children = item.get("children") or item.get("subsections") or []
            order = item.get("order") or (f"{prefix}.{index}" if prefix else index)
            row = {key: value for key, value in item.items() if key not in {"children", "subsections"}}
            row["order"] = order
            row["order_index"] = item.get("order_index") or order_index
            row["level"] = max(1, min(int(item.get("level") or level), 4))
            row["title"] = row.get("title") or "未命名章节"
            row["priority"] = row.get("priority") or "medium"
            row["response_points"] = row.get("response_points") or []
            row["mapped_requirements"] = row.get("mapped_requirements") or []
            row["mapped_scoring_items"] = row.get("mapped_scoring_items") or []
            row["mapped_risks"] = row.get("mapped_risks") or []
            row["source_pages"] = row.get("source_pages") or []
            row["required_materials"] = row.get("required_materials") or []
            row["writing_notes"] = row.get("writing_notes") or []
            normalized.append(row)
            if isinstance(children, list) and children:
                visit(children, min(level + 1, 4), str(order))

    visit(chapters, 1)
    return normalized


def _build_rule_outline(payload: dict[str, Any]) -> dict[str, Any]:
    project = payload.get("project") or {}
    analysis = payload.get("analysis") or {}
    project_meta = analysis.get("project_meta") or {}
    ai_report = project_meta.get("ai_report") or {}

    base_chapters = [
        {
            "title": "投标函及格式文件",
            "purpose": "响应招标文件投标函、报价、工期、质量等基础承诺。",
            "priority": "high",
            "children": [
                {"title": "投标函及投标函附录", "purpose": "按招标文件格式填写投标报价、工期、质量目标、项目经理等基础承诺。", "priority": "high"},
                {"title": "法定代表人身份证明及授权委托书", "purpose": "放置法定代表人身份证明、授权委托书、被授权人身份证明等签章文件。", "priority": "high"},
                {"title": "投标保证金", "purpose": "按要求提供投标保证金凭证、保函或缴纳证明，并核对有效期。", "priority": "high"},
                {"title": "联合体协议及分包说明", "purpose": "如适用，响应联合体协议、牵头人、职责分工、拟分包事项。", "priority": "medium"},
            ],
        },
        {
            "title": "资格审查资料",
            "purpose": "集中放置营业执照、资质证书、安全生产许可、信誉声明、人员证书、业绩证明等材料。",
            "priority": "high",
            "children": [
                {"title": "企业基本资格资料", "purpose": "整理营业执照、资质证书、安全生产许可证、基本账户等资格资料。", "priority": "high"},
                {"title": "信誉与合规承诺", "purpose": "响应信用中国、失信被执行人、行贿犯罪记录、禁止投标情形等要求。", "priority": "high"},
                {"title": "类似项目业绩", "purpose": "整理类似项目合同、中标通知书、验收证明、业主证明和联合体业绩说明。", "priority": "high"},
                {"title": "项目管理机构", "purpose": "展示项目经理、技术负责人、质量、安全、施工和资料管理人员配置及证书。", "priority": "high"},
            ],
        },
        {
            "title": "商务响应文件",
            "purpose": "响应付款、合同、服务、税费、廉政、保密、农民工工资等商务条款。",
            "priority": "medium",
            "children": [
                {"title": "商务条款响应", "purpose": "逐条响应合同、付款、履约担保、工期、质量和服务承诺。", "priority": "medium"},
                {"title": "偏离表及承诺函", "purpose": "明确商务和技术条款无偏离或偏离说明，避免实质性不响应。", "priority": "high"},
                {"title": "中小企业及政策性文件", "purpose": "按项目属性提供中小企业声明、政府采购政策响应等文件。", "priority": "medium"},
            ],
        },
        {
            "title": "技术响应文件",
            "purpose": "围绕发包人要求、技术标准、实施组织、质量安全和交付保障形成技术方案。",
            "priority": "high",
            "children": [
                {"title": "发包人要求响应", "purpose": "逐条响应发包人要求、技术标准、工程范围和关键技术参数。", "priority": "high"},
                {"title": "承包人建议书", "purpose": "围绕设计优化、设备配置、施工组织、资源保障提出可执行建议。", "priority": "high"},
                {
                    "title": "施工组织设计/实施方案",
                    "purpose": "围绕施工部署、进度、质量、安全、环保、资源配置和关键工序组织形成方案。",
                    "priority": "high",
                    "children": [
                        {"title": "施工部署与资源配置", "purpose": "描述总体施工部署、人员设备投入和关键资源配置。", "priority": "high"},
                        {"title": "进度计划与节点控制", "purpose": "围绕里程碑节点、工期控制和赶工预案形成进度方案。", "priority": "high"},
                        {
                            "title": "质量安全环保措施",
                            "purpose": "专项响应质量控制、安全管理、文明施工和环境保护要求。",
                            "priority": "high",
                            "children": [
                                {"title": "质量控制措施", "purpose": "聚焦工艺控制、材料检验、过程验收和质量追溯。", "priority": "high"},
                                {"title": "安全生产措施", "purpose": "聚焦现场安全组织、危险源控制、应急演练和责任落实。", "priority": "high"},
                                {"title": "环保与文明施工措施", "purpose": "响应扬尘、噪声、废料回收、现场围挡和文明施工。", "priority": "medium"},
                            ],
                        },
                    ],
                },
                {"title": "质量、安全、进度保障措施", "purpose": "对评分项和履约风险做专项响应，突出过程控制、验收、应急和交付保障。", "priority": "medium"},
            ],
        },
        {
            "title": "报价文件及工程量清单",
            "purpose": "按招标文件格式组织报价、清单、单价分析和相关说明。",
            "priority": "high",
            "children": [
                {"title": "价格清单", "purpose": "按招标文件格式填报价格清单、分项报价和汇总报价。", "priority": "high"},
                {"title": "报价说明及风险提示", "purpose": "说明报价口径、税费、暂估价、风险范围和需人工复核事项。", "priority": "medium"},
            ],
        },
        {
            "title": "其他响应资料",
            "purpose": "放置招标文件要求的补充资料、承诺、证明和投标人认为需提供的资料。",
            "priority": "low",
            "children": [
                {"title": "其他证明材料", "purpose": "归集招标文件要求但不属于前述章节的证明、声明和附件。", "priority": "low"},
                {"title": "页码索引及附件清单", "purpose": "建立材料索引，便于评审查找和后续 Word 导出。", "priority": "low"},
            ],
        },
    ]

    requirements = payload.get("requirements") or []
    scoring_items = payload.get("scoringItems") or []
    risks = payload.get("risks") or []
    materials = ai_report.get("material_checklist") or []

    def enrich_node(node: dict[str, Any], level: int) -> dict[str, Any]:
        title = node.get("title") or "未命名章节"
        keyword = title[:4]
        mapped_requirements = [
            item.get("content") for item in requirements
            if item.get("content") and _contains_keyword(item, keyword, ["content", "source_section"])
        ][:5]
        mapped_scoring = [
            item.get("item") for item in scoring_items
            if item.get("item") and _contains_keyword(item, keyword, ["item", "source_section"])
        ][:4]
        mapped_risks = [
            item.get("content") for item in risks
            if item.get("content") and _contains_keyword(item, keyword, ["content", "source_section"])
        ][:4]
        source_pages = sorted({
            item.get("source_page")
            for item in [*requirements, *scoring_items, *risks]
            if item.get("source_page") and _contains_keyword(item, keyword, ["content", "item", "source_section"])
        })
        writing_notes = [
            "正文生成前先核对招标文件格式要求、签章要求和附件清单。" if level == 1 else "正文生成前先核对本节是否为招标文件指定格式或评分点。",
            "章节内容应保留页码索引，便于后续评审响应和人工复核。" if level <= 2 else "如涉及证书、金额、人员、日期，应使用【待补充】占位，禁止编造。",
        ]
        enriched = {
            "title": title,
            "priority": node.get("priority") or "medium",
            "purpose": node.get("purpose"),
            "response_points": mapped_requirements[:3] or (["需结合招标文件条款逐项响应，避免遗漏实质性要求。"] if level == 1 else ["围绕本节目标补充对应招标响应内容。"]),
            "mapped_requirements": mapped_requirements,
            "mapped_scoring_items": mapped_scoring,
            "mapped_risks": mapped_risks,
            "source_pages": source_pages[:8],
            "required_materials": [
                item.get("material") for item in materials
                if item.get("material") and (keyword in _text(item.get("material")) or title[:2] in _text(item.get("category")))
            ][:5],
            "writing_notes": writing_notes,
            "children": [enrich_node(child, min(level + 1, 4)) for child in node.get("children") or []],
        }
        return enriched

    chapters = _normalize_outline_chapters([enrich_node(node, 1) for node in base_chapters])

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
4. 目录层级必须灵活处理：简单章节可以只保留一级，复杂章节可以展开到二级、三级，必要时四级；不要机械地让每章层级一致。
5. 不要编造招标文件没有的信息；无法确认的写“需人工复核”。
6. 输出必须是严格 JSON，不要 Markdown，不要代码块。

输出 JSON 格式：
{{
  "version": "ai-v1",
  "project_name": "...",
  "tender_no": "...",
  "summary": "...",
  "chapters": [
    {{
      "title": "...",
      "priority": "high/medium/low",
      "purpose": "...",
      "response_points": ["..."],
      "mapped_requirements": ["..."],
      "mapped_scoring_items": ["..."],
      "mapped_risks": ["..."],
      "source_pages": [1, 2],
      "required_materials": ["..."],
      "writing_notes": ["..."],
      "children": [
        {{
          "title": "...",
          "priority": "high/medium/low",
          "purpose": "...",
          "response_points": ["..."],
          "mapped_requirements": ["..."],
          "mapped_scoring_items": ["..."],
          "mapped_risks": ["..."],
          "source_pages": [1, 2],
          "required_materials": ["..."],
          "writing_notes": ["..."],
          "children": []
        }}
      ]
    }}
  ],
  "next_steps": ["..."]
}}

结构化招标信息：
{json.dumps(context, ensure_ascii=False)}
""".strip()


def _generate_outline_from_ai_or_rule(payload: dict[str, Any]) -> dict[str, Any]:
    fallback_outline = _build_rule_outline(payload)
    try:
        prompt = _build_prompt(payload)
        response = call_dashscope_api([{"role": "user", "content": prompt}], json_mode=True)
        content = response["output"]["choices"][0]["message"]["content"]
        ai_outline = _strip_llm_json(content)
    except Exception as exc:
        ai_outline = fallback_outline
        ai_outline["version"] = "rule-v1-fallback"
        ai_outline["fallback_reason"] = f"AI 章节大纲生成失败，已使用规则版大纲: {exc}"
        return ai_outline

    if not isinstance(ai_outline.get("chapters"), list) or not ai_outline["chapters"]:
        ai_outline = fallback_outline
        ai_outline["version"] = "rule-v1-fallback"
        ai_outline["fallback_reason"] = "AI 返回结果缺少 chapters，已使用规则版大纲。"
        return ai_outline

    ai_outline["chapters"] = _normalize_outline_chapters(ai_outline["chapters"])
    ai_outline["version"] = ai_outline.get("version") or "ai-v1"
    ai_outline["generated_at"] = datetime.now(timezone.utc).isoformat()
    if "model" not in ai_outline:
        ai_outline["model"] = locals().get("response", {}).get("model") or "dashscope"
    return ai_outline


def generate_bid_outline(project_id: str) -> dict[str, Any]:
    payload = get_project_interpretation(project_id)
    analysis = payload.get("analysis")
    if not analysis:
        raise RuntimeError("当前项目尚无结构化解读数据，请先完成招标文件解析和落库。")

    ai_outline = _generate_outline_from_ai_or_rule(payload)

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
    replace_bid_sections_from_outline(project_id, ai_outline)

    return ai_outline


def save_bid_outline(project_id: str, outline: dict[str, Any], analysis: dict[str, Any]) -> None:
    project_meta = analysis.get("project_meta") or {}
    project_meta["bid_outline"] = outline

    updated = (
        get_supabase_client()
        .table("bid_analysis")
        .update({"project_meta": project_meta})
        .eq("id", analysis["id"])
        .execute()
    )
    if not updated.data:
        raise RuntimeError("标书章节大纲写回 Supabase 失败")


def stream_bid_outline(project_id: str) -> Iterator[dict[str, Any]]:
    payload = get_project_interpretation(project_id)
    analysis = payload.get("analysis")
    if not analysis:
        raise RuntimeError("当前项目尚无结构化解读数据，请先完成招标文件解析和落库。")

    yield {
        "type": "start",
        "message": "AI 正在结合招标解读结果生成章节大纲。",
    }

    outline = _generate_outline_from_ai_or_rule(payload)

    yield {
        "type": "meta",
        "outline": {
            key: value for key, value in outline.items()
            if key != "chapters"
        },
        "total": len(outline.get("chapters") or []),
    }

    for index, chapter in enumerate(outline.get("chapters") or [], start=1):
        yield {
            "type": "chapter",
            "index": index,
            "total": len(outline.get("chapters") or []),
            "chapter": chapter,
        }
        time.sleep(0.12)

    save_bid_outline(project_id, outline, analysis)
    replace_bid_sections_from_outline(project_id, outline)
    yield {
        "type": "done",
        "outline": outline,
    }
