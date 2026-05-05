from typing import Any


VOLUME_DEFINITIONS: dict[str, dict[str, str]] = {
    "all": {
        "name": "全部",
        "description": "完整投标文件",
    },
    "technical": {
        "name": "技术标",
        "description": "施工组织设计、技术响应、质量安全环保、进度资源和设备方案",
    },
    "business": {
        "name": "商务标",
        "description": "投标函、商务条款响应、偏离表、承诺函和合同响应",
    },
    "qualification": {
        "name": "资格文件",
        "description": "营业执照、资质证书、人员证书、业绩和信誉声明",
    },
    "price": {
        "name": "报价文件",
        "description": "工程量清单、投标报价、分项报价和单价分析",
    },
    "attachment": {
        "name": "附件材料",
        "description": "图纸、证照扫描件、产品图片、业绩证明和其他附件",
    },
    "other": {
        "name": "其他",
        "description": "未能自动归类的其他响应材料",
    },
}

VOLUME_ORDER = ["qualification", "business", "technical", "price", "attachment", "other"]


def _text(value: Any) -> str:
    return str(value) if value is not None else ""


def _contains_any(text: str, keywords: list[str]) -> bool:
    return any(keyword in text for keyword in keywords)


def normalize_volume_type(value: Any) -> str:
    volume_type = _text(value).strip().lower()
    return volume_type if volume_type in VOLUME_DEFINITIONS and volume_type != "all" else "other"


def volume_name(volume_type: Any) -> str:
    return VOLUME_DEFINITIONS.get(normalize_volume_type(volume_type), VOLUME_DEFINITIONS["other"])["name"]


def volume_description(volume_type: Any) -> str:
    return VOLUME_DEFINITIONS.get(normalize_volume_type(volume_type), VOLUME_DEFINITIONS["other"])["description"]


def infer_volume_type(section: dict[str, Any]) -> str:
    metadata = section.get("metadata") if isinstance(section.get("metadata"), dict) else {}
    existing = metadata.get("volume_type")
    if existing and _text(existing).strip().lower() in VOLUME_DEFINITIONS:
        return normalize_volume_type(existing)

    title = _text(section.get("title"))
    purpose = _text(section.get("purpose"))
    materials = " ".join(_text(item) for item in section.get("required_materials") or [])
    response_points = " ".join(_text(item) for item in section.get("response_points") or [])
    combined = f"{title} {purpose} {materials} {response_points}"

    if _contains_any(combined, ["资格", "资质", "证书", "营业执照", "安全生产许可", "人员", "项目经理", "技术负责人", "业绩", "信誉", "社保", "建造师"]):
        return "qualification"
    if _contains_any(combined, ["商务", "合同", "付款", "履约", "服务", "税费", "廉政", "保密", "偏离", "承诺", "投标函", "授权委托", "保证金"]):
        return "business"
    if _contains_any(combined, ["报价", "清单", "价格", "单价", "工程量", "投标总价", "分项报价"]):
        return "price"
    if _contains_any(combined, ["施工组织", "技术", "实施方案", "施工方案", "质量", "安全", "环保", "进度", "资源配置", "发包人要求", "承包人建议", "设备", "工艺", "调试"]):
        return "technical"
    if _contains_any(combined, ["附件", "图纸", "扫描件", "证明材料", "附录", "图片", "图册"]):
        return "attachment"
    return "other"


def ensure_section_volume(section: dict[str, Any]) -> dict[str, Any]:
    volume_type = infer_volume_type(section)
    metadata = section.get("metadata") if isinstance(section.get("metadata"), dict) else {}
    return {
        **section,
        "metadata": {
            **metadata,
            "volume_type": volume_type,
            "volume_name": metadata.get("volume_name") or volume_name(volume_type),
            "document_role": metadata.get("document_role") or "正文",
            "export_group": metadata.get("export_group") or f"{volume_name(volume_type)}文件",
        },
    }


def section_volume_type(section: dict[str, Any]) -> str:
    return infer_volume_type(section)
