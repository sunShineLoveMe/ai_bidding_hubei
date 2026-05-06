import logging
from flask import Blueprint, request, jsonify, current_app, Response, stream_with_context
import os
import sqlite3
import uuid
import json
import jwt
import requests
from datetime import datetime
from pathlib import Path
import mammoth
from unidecode import unidecode
import re
from werkzeug.utils import secure_filename
import codecs
import PyPDF2
from urllib.parse import quote
from backend.ai.qwen_client import call_dashscope_api, generate_bid_section
from backend.export.md_to_word import clean_formal_bid_text, convert_md_to_word
from backend.ai.chapter_planner import generate_bid_outline, stream_bid_outline
from backend.ai.section_writer import stream_bid_section
from backend.ai.interpreter import generate_ai_interpretation_report
from backend.ai.compliance_checker import build_compliance_report
from backend.db.supabase_repo import create_knowledge_asset, delete_bid_project, delete_bid_section, download_bid_file_to_local, download_knowledge_asset_file_variant, get_bid_file, get_latest_bid_file_for_project, get_onlyoffice_document, get_project_interpretation, list_bid_history, list_bid_sections, list_recent_bid_projects, reorder_bid_sections, reset_bid_sections_generation, save_onlyoffice_document, sync_uploaded_tender_to_supabase, update_bid_file_parse_status, update_bid_section_content, upload_knowledge_asset_file, upsert_bid_section
from backend.core.llm_json_utils import strip_llm_json
from backend.core.bid_volumes import delivery_volume_type, section_volume_type, volume_name
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import shutil
from datetime import timedelta
from backend.core.config import DEFAULT_SETTINGS, build_enterprise_context, get_setting, load_runtime_settings, save_runtime_settings

# 操作向量数据库的函数
from backend.parsing.document_parser import ingest_artifacts as ingest_mineru_artifacts_to_supabase, import_mineru_result_zip, parse_and_index_tender_file, read_parse_status, retry_mineru_result_download, write_parse_status
from backend.rag.vector_store import query_chroma
# 创建蓝图
bp = Blueprint('bidding', __name__)
knowledge_bp = Blueprint('knowledge', __name__)

# 临时的内存存储，用于在 upload -> pre-analysis -> chapter-analysis 之间传递小量状态
# 结构: { bidding_id: { 'biddingId': int, 'analysisData': dict|None, 'directoryStructure': dict|None } }
temp_analysis_store = {}
_temp_store_lock = threading.Lock()

# 环境变量
ONLYOFFICE_JWT_SECRET = os.getenv('ONLYOFFICE_JWT_SECRET', 'fsdftertrt34768586sfhjsdhfjhhjfsuhaiubue')
BACKEND_URL_FOR_DOCKER = os.getenv('BACKEND_URL_FOR_DOCKER', 'host.docker.internal:3012')
APP_HOST = os.getenv('APP_HOST', 'localhost:3012')

def _with_http_scheme(base_url):
    base_url = (base_url or '').strip().rstrip('/')
    if not base_url:
        return ''
    if base_url.startswith(('http://', 'https://')):
        return base_url
    return f'http://{base_url}'

def get_backend_public_base_url():
    """Return the backend URL reachable by the OnlyOffice document server."""
    return _with_http_scheme(
        os.getenv('APP_PUBLIC_BASE_URL')
        or os.getenv('BACKEND_URL_FOR_DOCKER')
        or BACKEND_URL_FOR_DOCKER
        or APP_HOST
    )

def get_backend_self_base_url():
    """Return the backend URL used by this service when it needs to fetch its own files."""
    return _with_http_scheme(
        os.getenv('APP_PUBLIC_BASE_URL')
        or os.getenv('APP_HOST')
        or APP_HOST
        or os.getenv('BACKEND_URL_FOR_DOCKER')
        or BACKEND_URL_FOR_DOCKER
    )

def get_db():
    """获取数据库连接"""
    conn = sqlite3.connect('bidding.db')
    conn.row_factory = sqlite3.Row
    return conn


@bp.route('/settings', methods=['GET'])
def get_runtime_settings():
    settings = load_runtime_settings()
    return jsonify({
        "settings": settings,
        "defaults": DEFAULT_SETTINGS,
        "sensitive": {
            "dashscope_api_key_configured": bool(os.getenv("DASHSCOPE_API_KEY")),
            "supabase_url_configured": bool(os.getenv("SUPABASE_URL")),
            "supabase_service_role_configured": bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY")),
        }
    }), 200


@bp.route('/settings', methods=['POST'])
def update_runtime_settings():
    data = request.get_json() or {}
    settings = data.get("settings") if isinstance(data.get("settings"), dict) else data
    saved = save_runtime_settings(settings)
    return jsonify({
        "settings": saved,
        "message": "系统设置已保存，新的模型配置会在下一次请求时生效。"
    }), 200

def read_tender_file(bidding_id):
    """读取招标文件"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM bidding WHERE id = ?', (bidding_id,))
        bidding = cursor.fetchone()
        conn.close()
        if not bidding:
            return jsonify({'error': '招标书不存在'}), 404
        file_path = Path(bidding['storage_path'])
        if file_path.suffix.lower() == '.pdf':
            return _read_pdf(file_path)
        else:
            with open(bidding['storage_path'], 'rb') as f:
                result = mammoth.extract_raw_text(f)
            return result.value
    except Exception as e:
        return jsonify({'error': f'读取文件失败: {str(e)}'}), 500

def _read_pdf(file_path):
    """读取PDF文件"""
    text = ""
    try:
        with open(file_path, 'rb') as file:
            pdf_reader = PyPDF2.PdfReader(file)
            for page in pdf_reader.pages:
                text += page.extract_text() + "\n"
        return text
    except Exception as e:
        return jsonify({'error': f'读取文件失败: {str(e)}'}), 500
    
def save_bid_section(content, section_name, output_dir, tender_name):
    '''保存投标文件小节'''
    output_path = Path(output_dir) / tender_name / f"{section_name}.txt"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    try:
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(content)
    except Exception as e:
            logging.error(f"保存章节 {section_name} 时出错: {e}")

def merge_sections(output_dir, tender_name, sections):
        """合并所有章节内容为一个完整的文档"""
        sections_dir = Path(output_dir) / tender_name
        if not sections_dir.exists():
            logging.error(f"目录 {sections_dir} 不存在！")
            return
        
        # 获取所有章节文件
        section_files = list(sections_dir.glob("*.txt"))
        if not section_files:
            logging.error(f"在 {sections_dir} 目录下未找到章节文件！")
            return
        
        # 创建合并后的文档
        merged_content = ["# 投标文件\n\n"] + [
            f"## {section_name}\n\n{content}\n\n"
            for section_name in sections
            if (section_file := sections_dir / f"{section_name}.txt").exists()
            for content in [section_file.read_text(encoding='utf-8')]
        ]
        output_file = sections_dir / f"{tender_name}_完整投标文件.md"
        try:
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write("\n".join(merged_content))
            logging.info(f"已生成完整投标文件：{output_file}")
            return output_file
        except Exception as e:
            logging.error(f"保存合并文件时出错: {e}")
            return None    


def _slug_filename(name: str, fallback: str = "bid-document") -> str:
    base = secure_filename(unidecode(name or "").strip()) or fallback
    return base


def _display_filename(name: str, fallback: str = "投标文件") -> str:
    """Keep Chinese project names in user-facing generated document filenames."""
    value = clean_formal_bid_text(name or "") or fallback
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", value)
    value = re.sub(r"\s+", " ", value).strip(" ._-")
    return (value or fallback)[:120]


def _output_url_for_path(path: Path) -> str:
    gen_folder = Path(current_app.config.get('GENERATED_FOLDER', 'outputs')).resolve()
    relative_path = Path(path).resolve().relative_to(gen_folder).as_posix()
    return f"/api/outputs/{quote(relative_path)}"


def _absolute_output_url_for_path(path: Path) -> str:
    return f"{get_backend_public_base_url()}{_output_url_for_path(path)}"


def _section_markdown_heading(level: int, title: str) -> str:
    depth = max(1, min(level, 6))
    return f'{"#" * depth} {title}\n\n'


def _clean_section_title(title: str, order: str | int | None = None) -> str:
    clean_title = (title or "未命名章节").strip()
    if not order:
        return clean_title
    order_text = str(order).strip()
    return re.sub(rf"^{re.escape(order_text)}\.?\s*", "", clean_title).strip() or clean_title


def _section_display_title(section: dict) -> str:
    order = section.get("order")
    title = _clean_section_title(section.get("title") or "未命名章节", order)
    if not order:
        return title
    order_text = str(order).strip()
    prefix = f"{order_text} " if "." in order_text else f"{order_text}. "
    return f"{prefix}{title}"


def _strip_duplicate_section_heading(content: str, section: dict) -> str:
    lines = (content or "").strip().splitlines()
    if not lines:
        return ""
    first = lines[0].strip()
    if not first.startswith("#"):
        return content.strip()
    heading_text = re.sub(r"^#{1,6}\s*", "", first).strip()
    order = section.get("order")
    clean_heading = _clean_section_title(heading_text, order)
    clean_title = _clean_section_title(section.get("title") or "未命名章节", order)
    if clean_heading == clean_title or heading_text == _section_display_title(section):
        return "\n".join(lines[1:]).strip()
    return content.strip()


def _asset_text(asset: dict) -> str:
    parts = [
        asset.get("title"),
        asset.get("description"),
        asset.get("category"),
        asset.get("asset_type"),
        asset.get("searchable_text"),
    ]
    parts.extend(asset.get("tags") or [])
    parts.extend(asset.get("applicable_sections") or [])
    return " ".join(str(item) for item in parts if item).lower()


def _section_text(section: dict) -> str:
    metadata = section.get("metadata") or {}
    plan = metadata.get("writing_plan") or {}
    parts = [
        _section_display_title(section),
        section.get("title"),
        section.get("content"),
        section.get("purpose"),
        plan.get("chapter_type"),
        plan.get("importance"),
    ]
    for key in ("response_points", "required_materials", "evidence_needs", "mapped_requirements"):
        value = section.get(key) or plan.get(key)
        if isinstance(value, list):
            parts.extend(value)
        elif value:
            parts.append(value)
    return " ".join(str(item) for item in parts if item).lower()


def _section_needs_image(section: dict) -> bool:
    metadata = section.get("metadata") or {}
    plan = metadata.get("writing_plan") or {}
    volume_type = section_volume_type(section)
    if volume_type == "price":
        return False
    if volume_type == "business":
        text = _section_text(section)
        return any(keyword in text for keyword in ["附件", "证明材料", "授权委托", "保证金", "保函", "扫描件"])
    if plan.get("needs_image"):
        return True
    text = _section_text(section)
    keywords = [
        "资质", "证书", "营业执照", "许可", "业绩", "产品", "设备", "材料", "施工",
        "水库", "泵站", "闸门", "大坝", "渠道", "除险", "加固", "组织实施", "工程范围",
    ]
    return any(keyword in text for keyword in keywords)


def _score_asset_for_section(asset: dict, section: dict) -> int:
    asset_text = _asset_text(asset)
    section_text = _section_text(section)
    volume_type = section_volume_type(section)
    score = 0

    for token in re.findall(r"[\u4e00-\u9fffA-Za-z0-9]{2,}", section_text):
        if token in asset_text:
            score += 2 if len(token) >= 4 else 1

    category = str(asset.get("category") or "")
    asset_type = str(asset.get("asset_type") or "")
    library_type = ""
    metadata = asset.get("metadata") or {}
    specs = asset.get("specs") or {}
    if isinstance(metadata, dict):
        library_type = str(metadata.get("library_type") or "")
    if not library_type and isinstance(specs, dict):
        library_type = str(specs.get("library_type") or "")

    if volume_type == "technical":
        if library_type == "product" or any(keyword in asset_text for keyword in ["产品", "设备", "参数", "工艺", "水轮机", "泵", "闸门", "控制柜"]):
            score += 22
        if library_type == "qualification":
            score -= 10
    elif volume_type == "qualification":
        if library_type == "qualification" or any(keyword in asset_text for keyword in ["资质", "证书", "营业执照", "许可", "业绩", "人员", "社保"]):
            score += 24
        if library_type == "product":
            score -= 12
    elif volume_type == "business":
        if any(keyword in asset_text for keyword in ["授权", "保证金", "保函", "承诺", "证明", "营业执照", "资质"]):
            score += 10
        if any(keyword in asset_text for keyword in ["产品", "设备", "工艺", "施工现场"]):
            score -= 18
    elif volume_type == "attachment":
        score += 6
    elif volume_type == "price":
        return -100

    if any(keyword in section_text for keyword in ["资质", "证书", "营业执照", "许可"]):
        if any(keyword in asset_text for keyword in ["资质", "证书", "营业执照", "许可", "脱敏"]):
            score += 18
    if any(keyword in section_text for keyword in ["产品", "设备", "材料", "报价", "清单"]):
        if any(keyword in asset_text for keyword in ["产品", "设备", "材料", "参数", "水轮机", "螺母", "叶片"]):
            score += 14
    if any(keyword in section_text for keyword in ["施工", "组织", "工程", "水库", "大坝", "渠道", "泵站", "除险", "加固"]):
        if any(keyword in asset_text for keyword in ["施工", "工程", "水库", "泵站", "渠道", "现场", "项目"]):
            score += 12
    if category and category.lower() in section_text:
        score += 6
    if asset_type and asset_type.lower() in section_text:
        score += 4
    return score


def _asset_image_ref(asset: dict) -> str:
    local_path = str(asset.get("local_path") or "").strip()
    if local_path:
        candidate = Path(local_path)
        if not candidate.is_absolute():
            candidate = Path.cwd() / candidate
        if candidate.exists() and candidate.is_file():
            return str(candidate)

    asset_id = str(asset.get("id") or "").strip()
    if asset_id:
        return f"{get_backend_self_base_url()}/api/bidding/knowledge/assets/{quote(asset_id)}/file?variant=original"

    public_url = str(asset.get("public_url") or "").strip()
    if public_url.startswith(("http://", "https://")):
        return public_url.replace("variant=thumb", "variant=original")

    storage_path = str(asset.get("storage_path") or "").strip()
    if storage_path.startswith(("http://", "https://")):
        return storage_path.replace("variant=thumb", "variant=original")
    return ""


def _asset_caption(asset: dict) -> str:
    title = str(asset.get("title") or "知识库图片资产").strip()
    category = str(asset.get("category") or "水利行业资料").strip()
    sensitive_note = "，脱敏示意图，不替代正式资质文件" if asset.get("is_sensitive") or asset.get("anonymized") else ""
    return f"图示：{title}（{category}{sensitive_note}）"


def _asset_allowed_for_volume(asset: dict, section: dict) -> bool:
    volume_type = section_volume_type(section)
    if volume_type == "price":
        return False
    asset_text = _asset_text(asset)
    metadata = asset.get("metadata") or {}
    specs = asset.get("specs") or {}
    library_type = ""
    if isinstance(metadata, dict):
        library_type = str(metadata.get("library_type") or "")
    if not library_type and isinstance(specs, dict):
        library_type = str(specs.get("library_type") or "")

    if volume_type == "technical":
        return library_type != "qualification" or any(keyword in asset_text for keyword in ["设备", "产品", "参数", "工艺", "施工", "现场"])
    if volume_type == "qualification":
        return library_type != "product" or any(keyword in asset_text for keyword in ["业绩", "证明", "资质", "证书"])
    if volume_type == "business":
        return any(keyword in asset_text for keyword in ["授权", "保证金", "保函", "承诺", "证明", "营业执照", "资质", "扫描件"])
    return True


def _build_section_image_markdown(section: dict, assets: list[dict], used_asset_ids: set[str]) -> str:
    if not assets or not _section_needs_image(section):
        return ""

    candidates: list[tuple[int, dict]] = []
    for asset in assets:
        image_ref = _asset_image_ref(asset)
        if not image_ref:
            continue
        asset_id = str(asset.get("id") or image_ref)
        if not _asset_allowed_for_volume(asset, section):
            continue
        score = _score_asset_for_section(asset, section)
        if asset_id in used_asset_ids:
            score -= 8
        if score > 0:
            candidates.append((score, asset))

    if not candidates:
        section_text = _section_text(section)
        fallback_keywords = ["产品", "设备", "施工", "工程", "水库", "泵站", "渠道", "现场", "资质", "证书", "营业执照"]
        for asset in assets:
            image_ref = _asset_image_ref(asset)
            if not image_ref:
                continue
            asset_text = _asset_text(asset)
            if any(keyword in asset_text for keyword in fallback_keywords) or any(keyword in section_text for keyword in fallback_keywords):
                candidates.append((1, asset))
        if not candidates:
            return ""

    candidates.sort(key=lambda item: item[0], reverse=True)
    volume_type = section_volume_type(section)
    max_images = 2 if volume_type in {"technical", "qualification", "attachment"} and any(keyword in _section_text(section) for keyword in ["资质", "证书", "产品", "设备", "附件"]) else 1
    snippets: list[str] = []
    for _, asset in candidates[:max_images]:
        image_ref = _asset_image_ref(asset)
        asset_id = str(asset.get("id") or image_ref)
        used_asset_ids.add(asset_id)
        alt = re.sub(r"[\[\]\(\)]", "", str(asset.get("title") or "水利行业配图")).strip()
        snippets.append(f"\n\n![{alt}]({image_ref})\n\n{_asset_caption(asset)}\n\n")
    return "".join(snippets)


def _asset_allowed_for_bid(asset: dict) -> bool:
    metadata = asset.get("metadata") or {}
    specs = asset.get("specs") or {}
    if isinstance(metadata, dict) and metadata.get("allowed_for_bid") is False:
        return False
    if isinstance(specs, dict) and specs.get("allowed_for_bid") is False:
        return False
    return True


def _section_with_descendants(sections: list[dict], section_id: str) -> list[dict]:
    selected_ids = {section_id}
    changed = True
    while changed:
        changed = False
        for section in sections:
            if section.get("parent_id") in selected_ids and section.get("id") not in selected_ids:
                selected_ids.add(section["id"])
                changed = True
    return [section for section in sections if section.get("id") in selected_ids]


def build_project_bid_markdown(
    project_id: str,
    focus_section_id: str | None = None,
    with_images: bool = False,
    volume_type: str | None = None,
) -> tuple[Path, str]:
    payload = get_project_interpretation(project_id)
    project = payload.get("project") or {}
    sections = list_bid_sections(project_id)
    if not sections:
        raise RuntimeError("当前项目暂无章节内容，请先生成章节大纲或正文。")

    project_name = (
        (payload.get("analysis") or {}).get("project_meta", {}) or {}
    ).get("project_name") or project.get("project_name") or "投标文件"
    project_name = clean_formal_bid_text(project_name) or "投标文件"
    folder_name = _slug_filename(project_name, f"project-{project_id[:8]}")
    output_dir = Path(current_app.config.get('GENERATED_FOLDER', 'outputs')) / folder_name
    output_dir.mkdir(parents=True, exist_ok=True)
    focus_section = None
    if focus_section_id:
        focus_section = next((section for section in sections if section.get("id") == focus_section_id), None)
        if focus_section:
            sections = _section_with_descendants(sections, focus_section_id)
    elif volume_type:
        if volume_type in {"technical", "business"}:
            sections = [section for section in sections if delivery_volume_type(section) == volume_type]
        else:
            sections = [section for section in sections if section_volume_type(section) == volume_type]
        if not sections:
            raise RuntimeError(f"当前项目暂无{volume_name(volume_type)}章节，请先生成或调整章节分册。")

    display_suffix = ""
    if focus_section:
        section_title = clean_formal_bid_text(focus_section.get('title') or "章节")
        display_suffix = f"-{section_title}-{focus_section_id[:8]}"
    elif volume_type:
        display_suffix = f"-{volume_name(volume_type)}"
    if with_images:
        display_suffix = f"{display_suffix}-图文"

    image_assets: list[dict] = []
    if with_images:
        try:
            image_assets = [
                asset for asset in list_knowledge_assets()
                if _asset_image_ref(asset)
                and _asset_allowed_for_bid(asset)
                and str(asset.get("asset_type") or "").lower() not in {"document", "markdown", "text"}
            ]
        except Exception:
            logging.exception("加载知识库图片资产失败，继续生成无配图 DOCX: %s", project_id)
            image_assets = []

    document_title = f"{project_name}-{volume_name(volume_type)}" if volume_type and not focus_section else project_name
    file_stem = _display_filename(f"{project_name}{display_suffix}", fallback=document_title)
    markdown_path = output_dir / f"{file_stem}.md"
    chunks: list[str] = [f"# {document_title}\n\n"]
    used_asset_ids: set[str] = set()
    for section in sections:
        title = _section_display_title(section)
        content = _strip_duplicate_section_heading(section.get("content") or "", section)
        chunks.append(_section_markdown_heading(int(section.get("level") or 1), title))
        if content:
            chunks.append(f"{content}\n\n" if content.endswith("\n") else f"{content}\n\n")
        else:
            chunks.append("待补充章节正文。\n\n")
        if with_images and "![" not in content:
            chunks.append(_build_section_image_markdown(section, image_assets, used_asset_ids))

    markdown_path.write_text("".join(chunks), encoding="utf-8")
    return markdown_path, document_title


def save_onlyoffice_document_mapping(*, document_key: str, project_id: str, title: str, file_path: str, download_url: str) -> None:
    try:
        save_onlyoffice_document(
            document_key=document_key,
            project_id=project_id,
            title=title,
            file_path=file_path,
            download_url=download_url,
        )
        return
    except Exception:
        logging.exception("Supabase onlyoffice_documents 写入失败，回退 SQLite: %s", document_key)

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            '''
            INSERT INTO onlyoffice_documents (document_key, project_id, title, file_path, download_url)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(document_key) DO UPDATE SET
              project_id=excluded.project_id,
              title=excluded.title,
              file_path=excluded.file_path,
              download_url=excluded.download_url,
              updated_at=CURRENT_TIMESTAMP
            ''',
            (document_key, project_id, title, file_path, download_url),
        )
        conn.commit()
    finally:
        conn.close()

def sync_and_parse_tender_in_background(file_path, original_filename, parse_id, supabase_sync=None):
    supabase_file_id = supabase_sync.get('file', {}).get('id') if supabase_sync else None
    try:
        if not supabase_sync:
            write_parse_status(parse_id, {
                "parse_status": "syncing_supabase",
                "parser": "mineru",
                "source_file": file_path,
                "file_name": original_filename,
            })
            supabase_sync = sync_uploaded_tender_to_supabase(file_path, original_filename)
            supabase_file_id = supabase_sync.get('file', {}).get('id') if supabase_sync else None
            write_parse_status(parse_id, {
                "parse_status": "supabase_synced",
                "project_id": supabase_sync.get('project', {}).get('id') if supabase_sync else None,
                "supabase_file_id": supabase_file_id,
            })
    except Exception as e:
        logging.exception("Supabase 招标文件后台同步失败，继续走本地 MinerU 解析: %s", file_path)
        write_parse_status(parse_id, {
            "parse_status": "supabase_sync_failed",
            "supabase_sync_error": str(e),
        })

    parse_and_index_tender_file(
        file_path=file_path,
        original_filename=original_filename,
        parse_id=parse_id,
        supabase_file_id=supabase_file_id,
    )

@bp.route('/upload', methods=['POST'])
def upload_bidding():
    """上传招标文件 —— 仅保存文件并写入 DB，不生成 OnlyOffice 配置"""
    if 'file' not in request.files:
        return jsonify({'error': '未接收到招标文件，请重新上传。'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '未选择招标文件，请选择后重新上传。'}), 400

    user_id = request.form.get('userId')
    if not user_id:
        return jsonify({'error': '未获取到当前操作人员身份，请刷新页面后重试。'}), 400

    try:
        original_filename = file.filename
        safe_filename = secure_filename(original_filename)
        unique_filename = f"{uuid.uuid4()}-{safe_filename}"
        file_path = os.path.join(current_app.config['UPLOAD_FOLDER'], unique_filename)

        # 保存文件到 uploads 目录
        file.save(file_path)

        parse_id = str(uuid.uuid4())
        write_parse_status(parse_id, {
            "parse_status": "uploaded",
            "parser": "mineru",
            "source_file": file_path,
            "file_name": original_filename,
        })

        supabase_sync = sync_uploaded_tender_to_supabase(file_path, original_filename)
        project_id = supabase_sync.get('project', {}).get('id')
        supabase_file_id = supabase_sync.get('file', {}).get('id')
        if not project_id or not supabase_file_id:
            return jsonify({'error': 'Supabase 项目或文件记录创建失败，请检查数据库配置。'}), 500

        write_parse_status(parse_id, {
            "parse_status": "supabase_synced",
            "parser": "mineru",
            "source_file": file_path,
            "file_name": original_filename,
            "project_id": project_id,
            "supabase_file_id": supabase_file_id,
        })

        # 项目和文件记录已同步到 Supabase；后台只负责 MinerU/OCR 解析和结构化入库。
        threading.Thread(
            target=sync_and_parse_tender_in_background,
            args=(file_path, original_filename, parse_id, supabase_sync),
            daemon=True,
        ).start()

        return jsonify({
            'message': '招标文件已上传，正在后台解析并生成结构化数据。',
            'biddingId': None,
            'originalFilename': original_filename,
            'projectId': project_id,
            'fileId': parse_id,
            'supabaseFileId': supabase_file_id,
            'supabaseSynced': True,
            'supabaseSyncError': None
        }), 201

    except Exception as e:
        logging.exception("招标文件上传处理失败")
        return jsonify({'error': f'招标文件上传处理失败: {str(e)}'}), 500

@bp.route('/parse-status/<file_id>', methods=['GET'])
def get_parse_status(file_id):
    """查询招标文件解析状态，合并 Supabase 当前状态与本地 MinerU 产物状态。"""
    try:
        local_status = read_parse_status(file_id) or {}
        download_retry_count = int(local_status.get("download_retry_count") or 0)
        max_download_retries = int(os.getenv("MINERU_DOWNLOAD_AUTO_RETRIES", "6"))
        retry_started_at = local_status.get("download_retry_started_at")
        retry_is_stale = True
        if retry_started_at:
            try:
                started_at = datetime.fromisoformat(str(retry_started_at).replace("Z", ""))
                retry_is_stale = (datetime.utcnow() - started_at).total_seconds() > int(
                    os.getenv("MINERU_DOWNLOAD_RETRY_STALE_SECONDS", "120")
                )
            except Exception:
                retry_is_stale = True
        if (
            local_status.get("parse_status") in {"mineru_failed", "mineru_download_failed", "mineru_download_retrying"}
            and local_status.get("batch_id")
            and local_status.get("mineru_state") == "done"
            and not local_status.get("artifacts")
            and download_retry_count < max_download_retries
            and (
                local_status.get("parse_status") != "mineru_download_retrying"
                or retry_is_stale
            )
        ):
            write_parse_status(file_id, {"parse_status": "mineru_download_retrying"})
            threading.Thread(target=retry_mineru_result_download, args=(file_id,), daemon=True).start()
            local_status = read_parse_status(file_id) or local_status

        supabase_file = None
        supabase_lookup_id = local_status.get("supabase_file_id") or file_id
        try:
            uuid.UUID(supabase_lookup_id)
            if local_status.get("supabase_file_id") or not local_status:
                supabase_file = get_bid_file(supabase_lookup_id)
        except ValueError:
            logging.warning("跳过 Supabase 查询，file_id 不是合法 UUID: %s", supabase_lookup_id)
        except Exception:
            logging.exception("查询 Supabase bid_files 失败: %s", supabase_lookup_id)

        return jsonify({
            'fileId': file_id,
            'parseStatus': local_status.get('parse_status') or (supabase_file or {}).get('parse_status'),
            'supabaseFile': supabase_file,
            'mineru': local_status,
        })
    except Exception as e:
        logging.exception("查询解析状态失败: %s", file_id)
        return jsonify({'error': f'查询解析状态失败: {str(e)}'}), 500

@bp.route('/parse-status/<file_id>/result-zip', methods=['POST'])
def upload_mineru_result_zip(file_id):
    """手动上传 MinerU 结果 zip，用于本机无法访问 MinerU CDN 的场景。"""
    if 'file' not in request.files:
        return jsonify({'error': '未接收到 MinerU 结果 zip 文件。'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '未选择 MinerU 结果 zip 文件。'}), 400

    try:
        output_dir = Path("parsed_outputs") / file_id
        output_dir.mkdir(parents=True, exist_ok=True)
        zip_path = output_dir / "manual_mineru_result.zip"
        file.save(zip_path)
        artifacts = import_mineru_result_zip(file_id, zip_path)
        return jsonify({
            'message': 'MinerU 结果 zip 已导入并完成解析产物处理。',
            'fileId': file_id,
            'artifacts': artifacts,
        })
    except Exception as e:
        logging.exception("导入 MinerU 结果 zip 失败: %s", file_id)
        write_parse_status(file_id, {"parse_status": "mineru_import_failed", "error": str(e)})
        return jsonify({'error': f'导入 MinerU 结果 zip 失败: {str(e)}'}), 500

@bp.route('/parse-status/<file_id>/ingest', methods=['POST'])
def ingest_mineru_artifacts(file_id):
    """将已完成的 MinerU 解析产物写入 Supabase 业务表。"""
    try:
        local_status = read_parse_status(file_id) or {}
        artifacts = local_status.get("artifacts")
        if not artifacts:
            return jsonify({'error': '当前任务尚无 MinerU 解析产物，请等待 mineru_done。'}), 400

        threading.Thread(target=ingest_mineru_artifacts_to_supabase, args=(file_id, artifacts), daemon=True).start()
        return jsonify({
            'message': 'MinerU 解析产物已进入 Supabase 落库任务。',
            'fileId': file_id,
        })
    except Exception as e:
        logging.exception("触发 MinerU 产物落库失败: %s", file_id)
        return jsonify({'error': f'触发 MinerU 产物落库失败: {str(e)}'}), 500

@bp.route('/interpretations/latest', methods=['GET'])
def get_latest_interpretation():
    """获取最近一个已有结构化解读的招标项目。"""
    try:
        projects = list_recent_bid_projects(limit=20)
        for project in projects:
            payload = get_project_interpretation(project["id"])
            if payload.get("analysis"):
                return jsonify(payload)
        return jsonify({
            'project': projects[0] if projects else None,
            'analysis': None,
            'requirements': [],
            'risks': [],
            'scoringItems': [],
            'chapterSuggestions': [],
            'documentChunks': [],
        })
    except Exception as e:
        logging.exception("查询最新招标解读失败")
        return jsonify({'error': f'查询最新招标解读失败: {str(e)}'}), 500


@bp.route('/history', methods=['GET'])
def get_bid_history():
    try:
        limit = int(request.args.get("limit", 100))
        items = list_bid_history(limit=limit)
        for item in items:
            local_status = _find_local_parse_status_for_supabase_file(item.get("latest_file_id"))
            if not local_status:
                continue
            parse_status = local_status.get("parse_status") or item.get("parse_status")
            item["parse_status"] = parse_status
            item["parse_task_id"] = local_status.get("_parse_id")
            item["parse_error"] = (
                local_status.get("error")
                or local_status.get("reason")
                or local_status.get("supabase_sync_error")
            )
            item["parse_retryable"] = bool(local_status.get("retryable"))
            item["parse_updated_at"] = local_status.get("updated_at")
            if parse_status in {
                "mineru_failed",
                "index_failed",
                "ocr_required",
                "mineru_download_failed",
                "mineru_import_failed",
                "supabase_sync_failed",
            }:
                item["stage"] = "解析失败"
                item["action"] = "查看"
                item["parse_retryable"] = True
            elif parse_status in {
                "uploaded",
                "pending",
                "syncing_supabase",
                "supabase_synced",
                "mineru_submitted",
                "mineru_running",
                "mineru_split_submitted",
                "mineru_split_running",
                "mineru_downloading",
                "mineru_download_retrying",
                "mineru_importing_zip",
                "mineru_fallback_native",
            } and not item.get("chunk_count"):
                item["stage"] = "解析中"
                item["action"] = "查看状态"
        return jsonify({"items": items}), 200
    except Exception as e:
        logging.exception("查询历史记录失败")
        return jsonify({'error': f'查询历史记录失败: {str(e)}'}), 500


def _find_local_parse_status_for_supabase_file(supabase_file_id):
    if not supabase_file_id:
        return None
    status_root = Path("parsed_outputs")
    if not status_root.exists():
        return None
    latest_status = None
    latest_mtime = 0.0
    for status_path in status_root.glob("*/mineru_status.json"):
        try:
            payload = json.loads(status_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if payload.get("supabase_file_id") != supabase_file_id:
            continue
        mtime = status_path.stat().st_mtime
        if mtime >= latest_mtime:
            latest_mtime = mtime
            payload["_parse_id"] = status_path.parent.name
            latest_status = payload
    return latest_status


@bp.route('/history/<project_id>/retry-parse', methods=['POST'])
def retry_bid_history_parse(project_id):
    try:
        uuid.UUID(project_id)
        file_record = get_latest_bid_file_for_project(project_id)
        if not file_record:
            return jsonify({'error': '未找到该项目的招标文件记录，无法重试解析。'}), 404

        local_status = _find_local_parse_status_for_supabase_file(file_record.get("id")) or {}
        source_file = local_status.get("source_file")
        if source_file and Path(source_file).exists():
            local_path = Path(source_file)
        else:
            local_path = download_bid_file_to_local(file_record, current_app.config['UPLOAD_FOLDER'])

        parse_id = str(uuid.uuid4())
        original_filename = file_record.get("file_name") or local_path.name
        update_bid_file_parse_status(file_record["id"], "pending")
        write_parse_status(parse_id, {
            "parse_status": "supabase_synced",
            "parser": "mineru",
            "source_file": str(local_path),
            "file_name": original_filename,
            "project_id": project_id,
            "supabase_file_id": file_record["id"],
            "retry_from": local_status.get("_parse_id"),
        })
        threading.Thread(
            target=parse_and_index_tender_file,
            kwargs={
                "file_path": str(local_path),
                "original_filename": original_filename,
                "parse_id": parse_id,
                "supabase_file_id": file_record["id"],
            },
            daemon=True,
        ).start()
        return jsonify({
            "message": "解析重试任务已启动",
            "projectId": project_id,
            "fileId": parse_id,
            "supabaseFileId": file_record["id"],
        }), 202
    except ValueError:
        return jsonify({'error': 'project_id 不是合法 UUID。'}), 400
    except Exception as e:
        logging.exception("重试解析历史记录失败: %s", project_id)
        return jsonify({'error': f'重试解析失败: {str(e)}'}), 500


@bp.route('/history/<project_id>', methods=['DELETE'])
def delete_bid_history_project(project_id):
    try:
        delete_bid_project(project_id)
        return jsonify({"message": "历史项目已删除", "projectId": project_id}), 200
    except Exception as e:
        logging.exception("删除历史项目失败: %s", project_id)
        return jsonify({'error': f'删除历史项目失败: {str(e)}'}), 500

@bp.route('/interpretations/<project_id>', methods=['GET'])
def get_interpretation(project_id):
    """按项目获取招标文件结构化解读结果。"""
    try:
        uuid.UUID(project_id)
        return jsonify(get_project_interpretation(project_id))
    except ValueError:
        return jsonify({'error': 'project_id 不是合法 UUID。'}), 400
    except Exception as e:
        logging.exception("查询招标解读失败: %s", project_id)
        return jsonify({'error': f'查询招标解读失败: {str(e)}'}), 500

@bp.route('/interpretations/<project_id>/ai-report', methods=['POST'])
def generate_interpretation_ai_report(project_id):
    """生成并保存大模型深度招标解读报告。"""
    try:
        uuid.UUID(project_id)
        report = generate_ai_interpretation_report(project_id)
        return jsonify({
            'message': 'AI 深度解读报告已生成。',
            'projectId': project_id,
            'aiReport': report,
        })
    except ValueError:
        return jsonify({'error': 'project_id 不是合法 UUID。'}), 400
    except Exception as e:
        logging.exception("生成 AI 深度解读报告失败: %s", project_id)
        return jsonify({'error': f'生成 AI 深度解读报告失败: {str(e)}'}), 500

@bp.route('/interpretations/<project_id>/bid-outline', methods=['POST'])
def generate_interpretation_bid_outline(project_id):
    """生成并保存标书章节目录与章节大纲。"""
    try:
        uuid.UUID(project_id)
        outline = generate_bid_outline(project_id)
        return jsonify({
            'message': '标书章节大纲已生成。',
            'projectId': project_id,
            'bidOutline': outline,
        })
    except ValueError:
        return jsonify({'error': 'project_id 不是合法 UUID。'}), 400
    except Exception as e:
        logging.exception("生成标书章节大纲失败: %s", project_id)
        return jsonify({'error': f'生成标书章节大纲失败: {str(e)}'}), 500

@bp.route('/interpretations/<project_id>/compliance-check', methods=['GET'])
def get_interpretation_compliance_check(project_id):
    """基于结构化条款和标书章节输出合规覆盖检查。"""
    try:
        uuid.UUID(project_id)
        volume_type = request.args.get("volumeType")
        if volume_type not in {"technical", "business"}:
            volume_type = None
        return jsonify(build_compliance_report(project_id, volume_type=volume_type))
    except ValueError:
        return jsonify({'error': 'project_id 不是合法 UUID。'}), 400
    except Exception as e:
        logging.exception("生成合规覆盖检查失败: %s", project_id)
        return jsonify({'error': f'生成合规覆盖检查失败: {str(e)}'}), 500

@bp.route('/interpretations/<project_id>/bid-outline/stream', methods=['GET'])
def stream_interpretation_bid_outline(project_id):
    """以 SSE 方式逐章生成并保存标书章节大纲。"""
    try:
        uuid.UUID(project_id)
    except ValueError:
        return jsonify({'error': 'project_id 不是合法 UUID。'}), 400

    def event_stream():
        try:
            for event in stream_bid_outline(project_id):
                event_type = event.pop("type", "message")
                yield f"event: {event_type}\n"
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            logging.exception("流式生成标书章节大纲失败: %s", project_id)
            yield "event: error\n"
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

    return Response(
        stream_with_context(event_stream()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
        },
    )

@bp.route('/interpretations/<project_id>/sections/stream', methods=['POST'])
def stream_interpretation_bid_section(project_id):
    """以 SSE 方式生成单个标书章节正文。"""
    try:
        uuid.UUID(project_id)
    except ValueError:
        return jsonify({'error': 'project_id 不是合法 UUID。'}), 400

    chapter = request.get_json(silent=True) or {}
    if not chapter.get("title"):
        return jsonify({'error': '缺少章节标题。'}), 400

    def event_stream():
        full_content = f"## {chapter.get('title') or '未命名章节'}\n\n"
        with_images = bool(chapter.get("withImages"))
        try:
            for event in stream_bid_section(project_id, chapter):
                event_type = event.pop("type", "message")
                if event_type == "chunk":
                    full_content += event.get("content", "")
                if event_type == "done" and chapter.get("id"):
                    if with_images:
                        try:
                            image_assets = [
                                asset for asset in list_knowledge_assets()
                                if _asset_image_ref(asset)
                                and _asset_allowed_for_bid(asset)
                                and str(asset.get("asset_type") or "").lower() not in {"document", "markdown", "text"}
                            ]
                            image_markdown = _build_section_image_markdown(
                                {**chapter, "content": full_content},
                                image_assets,
                                set(),
                            )
                            if image_markdown:
                                full_content += image_markdown
                                yield "event: chunk\n"
                                yield f"data: {json.dumps({'content': image_markdown}, ensure_ascii=False)}\n\n"
                        except Exception:
                            logging.exception("章节图文配图失败，继续保存纯文本章节: %s", chapter.get("id"))
                    saved_section = update_bid_section_content(project_id, chapter["id"], full_content, "generated", chapter)
                    if saved_section.get("id") != chapter.get("id"):
                        yield "event: saved\n"
                        yield f"data: {json.dumps({'id': saved_section.get('id'), 'oldId': chapter.get('id')}, ensure_ascii=False)}\n\n"
                yield f"event: {event_type}\n"
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            logging.exception("流式生成章节正文失败: %s", project_id)
            if chapter.get("id"):
                try:
                    update_bid_section_content(project_id, chapter["id"], "", "failed", chapter)
                except Exception:
                    logging.exception("写入章节失败状态失败: %s", chapter.get("id"))
            yield "event: error\n"
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

    return Response(
        stream_with_context(event_stream()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
        },
    )


@bp.route('/interpretations/<project_id>/compliance-supplement', methods=['POST'])
def generate_compliance_supplement(project_id):
    """Generate a focused supplement paragraph for an uncovered compliance row."""
    try:
        uuid.UUID(project_id)
    except ValueError:
        return jsonify({'error': 'project_id 不是合法 UUID。'}), 400

    payload = request.get_json(force=True) or {}
    row = payload.get("row") or {}
    section = payload.get("section") or {}
    if not row.get("content"):
        return jsonify({'error': '缺少待补强检查项内容。'}), 400
    if not section.get("title"):
        return jsonify({'error': '缺少建议补强章节。'}), 400

    prompt = f"""
你是资深投标文件审查与补强专家。请针对一个未响应或待补强的招标检查项，生成一段可直接追加到当前章节中的正式标书补强内容。

要求：
1. 只输出 Markdown 正文片段，不要解释生成过程。
2. 语言正式、稳健、可落地，符合国内水利施工投标文件表达习惯。
3. 不得编造证书编号、人员姓名、合同金额、具体日期、未提供的企业业绩；缺失事实用“【待补充：...】”占位。
4. 不使用 emoji、图标符号或装饰性提示符。
5. 内容应紧扣检查项，补充可执行措施、证明材料、页码索引或人工复核提示。
6. 篇幅控制在 300-600 字。

企业画像：
{build_enterprise_context()}

当前章节：
- 标题：{section.get("title")}
- 编写目标：{section.get("purpose") or "需结合章节正文补强"}
- 所属分册：{volume_name(section_volume_type(section))}

当前章节已有正文摘要：
{str(section.get("content") or "")[:1600]}

待补强检查项：
- 类别：{row.get("category") or "检查项"}
- 状态：{row.get("status") or "missing"}
- 重要性：{row.get("importance") or "medium"}
- 内容：{row.get("content")}
- 来源页码：{row.get("sourcePage") or "需复核"}
- 原文依据：{row.get("sourceText") or row.get("content")}
""".strip()

    try:
        response = call_dashscope_api([{"role": "user", "content": prompt}], json_mode=False)
        content = response["output"]["choices"][0]["message"]["content"].strip()
        content = clean_formal_bid_text(content)
        if not content:
            raise RuntimeError("模型未返回有效补强内容。")
        return jsonify({
            "projectId": project_id,
            "sectionId": section.get("id"),
            "rowId": row.get("id"),
            "content": content,
        })
    except Exception as e:
        logging.exception("生成条款补强内容失败: %s", project_id)
        return jsonify({'error': f'生成条款补强内容失败: {str(e)}'}), 500


@bp.route('/interpretations/<project_id>/sections', methods=['GET'])
def get_bid_sections(project_id):
    """查询项目标书章节。"""
    try:
        uuid.UUID(project_id)
        return jsonify({"sections": list_bid_sections(project_id)})
    except ValueError:
        return jsonify({'error': 'project_id 不是合法 UUID。'}), 400
    except Exception as e:
        logging.exception("查询标书章节失败: %s", project_id)
        return jsonify({'error': f'查询标书章节失败: {str(e)}'}), 500

@bp.route('/interpretations/<project_id>/sections', methods=['POST'])
def save_bid_section_api(project_id):
    """新增或更新单个标书章节。"""
    try:
        uuid.UUID(project_id)
        section = request.get_json(force=True)
        saved = upsert_bid_section(project_id, section)
        return jsonify({"section": saved})
    except ValueError:
        return jsonify({'error': 'project_id 不是合法 UUID。'}), 400
    except Exception as e:
        logging.exception("保存标书章节失败: %s", project_id)
        return jsonify({'error': f'保存标书章节失败: {str(e)}'}), 500

@bp.route('/interpretations/<project_id>/sections/reorder', methods=['POST'])
def reorder_bid_sections_api(project_id):
    """批量保存章节顺序和父子关系。"""
    try:
        uuid.UUID(project_id)
        payload = request.get_json(force=True) or {}
        sections = payload.get("sections") or []
        saved = reorder_bid_sections(project_id, sections)
        return jsonify({"sections": saved})
    except ValueError:
        return jsonify({'error': 'project_id 不是合法 UUID。'}), 400
    except Exception as e:
        logging.exception("批量排序标书章节失败: %s", project_id)
        return jsonify({'error': f'批量排序标书章节失败: {str(e)}'}), 500


@bp.route('/interpretations/<project_id>/sections/reset-generation', methods=['POST'])
def reset_bid_sections_generation_api(project_id):
    """重置标书章节生成状态，可选清空正文内容。"""
    try:
        uuid.UUID(project_id)
        payload = request.get_json(silent=True) or {}
        clear_content = bool(payload.get("clearContent"))
        sections = reset_bid_sections_generation(project_id, clear_content=clear_content)
        return jsonify({
            "message": "章节生成状态已重置。",
            "clearContent": clear_content,
            "sections": sections,
        })
    except ValueError:
        return jsonify({'error': 'project_id 不是合法 UUID。'}), 400
    except Exception as e:
        logging.exception("重置标书章节生成状态失败: %s", project_id)
        return jsonify({'error': f'重置标书章节生成状态失败: {str(e)}'}), 500


@bp.route('/interpretations/<project_id>/sections/<section_id>', methods=['DELETE'])
def remove_bid_section(project_id, section_id):
    """删除单个标书章节。"""
    try:
        uuid.UUID(project_id)
        uuid.UUID(section_id)
        delete_bid_section(project_id, section_id)
        return jsonify({"message": "章节已删除。"})
    except ValueError:
        return jsonify({'error': 'project_id 或 section_id 不是合法 UUID。'}), 400
    except Exception as e:
        logging.exception("删除标书章节失败: %s", project_id)
        return jsonify({'error': f'删除标书章节失败: {str(e)}'}), 500


@bp.route('/interpretations/<project_id>/onlyoffice-config', methods=['POST'])
def generate_onlyoffice_config(project_id):
    """基于 bid_sections 生成 DOCX，并返回 ONLYOFFICE editorConfig。"""
    try:
        uuid.UUID(project_id)
    except ValueError:
        return jsonify({'error': 'project_id 不是合法 UUID。'}), 400

    try:
        request_payload = request.get_json(silent=True) or {}
        focus_section_id = request_payload.get("sectionId")
        if focus_section_id:
            try:
                uuid.UUID(focus_section_id)
            except ValueError:
                focus_section_id = None

        markdown_path, project_name = build_project_bid_markdown(project_id, focus_section_id)
        generated_docx_path = convert_md_to_word(markdown_path)
        if not generated_docx_path or not Path(generated_docx_path).exists():
            raise RuntimeError("DOCX 生成失败，未找到输出文件。")

        generated_docx_path = Path(generated_docx_path)
        gen_folder = Path(current_app.config.get('GENERATED_FOLDER', 'outputs'))
        gen_folder.mkdir(parents=True, exist_ok=True)

        target_name = generated_docx_path.name
        target = gen_folder / target_name
        if generated_docx_path.resolve() != target.resolve():
            shutil.copy2(str(generated_docx_path), str(target))

        backend_url = get_backend_public_base_url()
        file_url = _absolute_output_url_for_path(target)
        callback_url = f"{backend_url}/api/bidding/save-callback"
        doc_key = str(uuid.uuid4())
        display_title = f"{project_name}.docx"

        payload = {
            'document': {
                'fileType': 'docx',
                'key': doc_key,
                'title': display_title,
                'url': file_url,
                'permissions': {
                    'chat': False,
                    'comment': False,
                    'copy': True,
                    'download': True,
                    'edit': True,
                    'fillForms': False,
                    'modifyContentControl': False,
                    'modifyFilter': False,
                    'print': True,
                    'protect': False,
                    'review': False,
                },
            },
            'documentType': 'word',
            'editorConfig': {
                'callbackUrl': callback_url,
                'lang': 'zh-CN',
                'region': 'zh-CN',
                'mode': 'edit',
                'user': {
                    'id': f"project-{project_id[:8]}",
                    'name': '企业标书编制岗',
                },
                'customization': {
                    'autosave': True,
                    'chat': False,
                    'comments': False,
                    'compactHeader': True,
                    'compactToolbar': True,
                    'feedback': False,
                    'forcesave': True,
                    'help': False,
                    'hideRightMenu': True,
                    'hideRulers': False,
                    'toolbarNoTabs': True,
                    'uiTheme': 'theme-light',
                },
            }
        }
        token = jwt.encode(payload, ONLYOFFICE_JWT_SECRET, algorithm='HS256')
        editor_config_with_token = {**payload, 'token': token}

        save_onlyoffice_document_mapping(
            document_key=doc_key,
            project_id=project_id,
            title=project_name,
            file_path=str(target),
            download_url=_output_url_for_path(target),
        )

        return jsonify({
            'message': 'ONLYOFFICE 配置生成成功',
            'markdown': str(markdown_path),
            'editorConfig': editor_config_with_token,
            'fileUrl': file_url,
            'downloadUrl': _output_url_for_path(target),
        }), 201
    except Exception as e:
        logging.exception("生成 ONLYOFFICE 配置失败: %s", project_id)
        return jsonify({'error': f'生成 ONLYOFFICE 配置失败: {str(e)}'}), 500


@bp.route('/interpretations/<project_id>/download-docx', methods=['POST'])
def download_bid_docx(project_id):
    """基于 bid_sections 生成符合国内标书排版习惯的 DOCX 下载文件。"""
    try:
        uuid.UUID(project_id)
    except ValueError:
        return jsonify({'error': 'project_id 不是合法 UUID。'}), 400

    try:
        request_payload = request.get_json(silent=True) or {}
        section_id = request_payload.get("sectionId")
        with_images = bool(request_payload.get("withImages"))
        volume_type = request_payload.get("volumeType")
        if volume_type not in {"technical", "business", "qualification", "price", "attachment", "other"}:
            volume_type = None
        if section_id:
            try:
                uuid.UUID(section_id)
            except ValueError:
                section_id = None

        markdown_path, project_name = build_project_bid_markdown(
            project_id,
            section_id,
            with_images=with_images,
            volume_type=None if section_id else volume_type,
        )
        generated_docx_path = convert_md_to_word(markdown_path)
        if not generated_docx_path or not Path(generated_docx_path).exists():
            raise RuntimeError("DOCX 生成失败，未找到输出文件。")

        generated_docx_path = Path(generated_docx_path)
        return jsonify({
            'message': 'DOCX 已生成。',
            'projectId': project_id,
            'sectionId': section_id,
            'withImages': with_images,
            'volumeType': volume_type,
            'projectName': project_name,
            'fileName': generated_docx_path.name,
            'downloadUrl': _output_url_for_path(generated_docx_path),
        }), 201
    except Exception as e:
        logging.exception("生成 DOCX 下载文件失败: %s", project_id)
        return jsonify({'error': f'生成 DOCX 下载文件失败: {str(e)}'}), 500
     
@bp.route('/save-callback', methods=['POST'])
def save_callback():
    """OnlyOffice 保存回调"""
    try:
        body = request.get_json(force=True)
        logging.info(f'[INFO] Save callback received: {json.dumps(body, indent=2, ensure_ascii=False)}')

        # OnlyOffice status 2 = readyForSave, 6 = mustSave
        if body.get('status') in [2, 6]:
            download_url = body.get('url')
            document_key = body.get('key')

            if not download_url:
                logging.warning(f'No download URL provided for key {document_key}')
                return jsonify({'error': 0})

            doc_row = None
            try:
                doc_row = get_onlyoffice_document(document_key)
            except Exception:
                logging.exception("Supabase onlyoffice_documents 查询失败，回退 SQLite: %s", document_key)
                conn = get_db()
                try:
                    cursor = conn.cursor()
                    cursor.execute('SELECT * FROM onlyoffice_documents WHERE document_key = ?', (document_key,))
                    doc_row = cursor.fetchone()
                finally:
                    conn.close()

            if doc_row:
                target_path = doc_row['file_path']
                Path(target_path).parent.mkdir(parents=True, exist_ok=True)
                resp = requests.get(download_url, stream=True, timeout=60)
                resp.raise_for_status()
                with open(target_path, 'wb') as f:
                    for chunk in resp.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)
                logging.info('ONLYOFFICE 文档已保存到 %s', target_path)
                return jsonify({'error': 0})

            conn = get_db()
            try:
                cursor = conn.cursor()
                cursor.execute('SELECT * FROM bidding WHERE document_key = ?', (document_key,))
                bidding = cursor.fetchone()

                if not bidding:
                    logging.error(f'Bidding with key {document_key} not found')
                    return jsonify({'error': 0})

                target_path = bidding['bid_document'] or bidding['storage_path']
                Path(target_path).parent.mkdir(parents=True, exist_ok=True)

                resp = requests.get(download_url, stream=True, timeout=60)
                resp.raise_for_status()
                with open(target_path, 'wb') as f:
                    for chunk in resp.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)

                # 更新 DB 状态为已编辑，并保存 bid_document 路径
                cursor.execute('UPDATE bidding SET status=?, bid_document=? WHERE id=?',
                               ('已编辑', target_path, bidding['id']))
                conn.commit()
                logging.info(f'投标文件 {bidding["original_filename"]} 已保存至 {target_path}')
            finally:
                conn.close()

        # OnlyOffice 要求返回 { "error": 0 }
        return jsonify({'error': 0})

    except Exception as e:
        logging.exception('OnlyOffice 保存回调处理失败')
        return jsonify({'error': 0})
    
@bp.route('/pre-analysis_bid', methods=['POST'])
def pre_analysis_bid():
    """预处理招标文件"""
    data = request.get_json()
    bidding_id = data.get('biddingId')
    if not bidding_id:
        return jsonify({'error': '缺少招标文件业务编号。'}), 400
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM bidding WHERE id = ?', (bidding_id,))
        bidding = cursor.fetchone()
        conn.close()
        if not bidding:
            return jsonify({'error': '招标书不存在'}), 404
        # 读取文件内容
        bid_content = read_tender_file(bidding_id)

        enterprise_context = build_enterprise_context()
        pre_analysis_prompt =  f'''
        你是资深招投标文件分析师，熟悉水利工程、设备配套、质量、安全、交付和商务响应要求。
        企业画像：
        {enterprise_context}
        请根据以下招标书内容，提炼出完整信息，并严格按照下面的JSON格式返回你的分析结果，不要有任何多余的解释，只返回以下json内容。
        {{
            "bidding_requirements":"...",
            "bidding_summary":"...",
            "bidding_meta":"..."
        }}
        "bidding_requirements": 必须包含的文件和材料。
        "bidding_summary":对招标书内容的总结，包括采购/施工/供货内容、服务期限、服务地点、质量标准、交付要求、验收要求等。
        "bidding_meta":招标书中具体的实质性要求内容、资质要求、技术规范、商务条款和评分标准。
        招标书内容如下:
        ---
        {bid_content}
        ---
        '''
        response = call_dashscope_api([
            {'role': 'user', 'content': pre_analysis_prompt}
        ])
        # print(f'[INFO] Pre-analysis response: {response}')
        # 兼容不同返回结构
        try:
            http_data = response['output']['choices'][0]['message']['content']
        except (KeyError, IndexError, TypeError):
            return jsonify({'error': 'API响应格式错误'}), 500

        try:
            analysis_result = strip_llm_json(http_data)
            # 将 pre-analysis 的结果写入临时存储（如果存在对应的 bidding_id）
            try:
                with _temp_store_lock:
                    if bidding_id in temp_analysis_store:
                        temp_analysis_store[bidding_id]['analysisData'] = analysis_result
                    else:
                        temp_analysis_store[bidding_id] = {
                            'biddingId': bidding_id,
                            'analysisData': analysis_result,
                            'directoryStructure': None,
                        }
            except Exception:
                logging.exception('写入 temp_analysis_store.analysisData 失败')
        except Exception as e:
            print(f'[ERROR] JSON解析失败: {str(e)}')
            return jsonify({'error': 'API返回内容解析失败'}), 500
        return jsonify(analysis_result)

    except Exception as e:
        print(f'[ERROR] 招标文件预分析失败，业务编号 {bidding_id}: {str(e)}')
        return jsonify({'error': '预分析失败，请稍后重试。'}), 500        

@bp.route('/chapter-analysis_bid', methods=['POST'])
def chapter_analysis_bid():
    """招标文件章节分析"""
    data = request.get_json()
    
    bidding_id = data.get('biddingId')
    if not bidding_id:
        return jsonify({'error': '缺少招标文件业务编号。'}), 400
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM bidding WHERE id = ?', (bidding_id,))
        bidding = cursor.fetchone()
        conn.close()
        if not bidding:
            return jsonify({'error': '招标书不存在'}), 404
        # 读取文件内容
        bid_content = read_tender_file(bidding_id)
        enterprise_context = build_enterprise_context()
        post_analysis_prompt = f'''
        你是资深招投标文件结构分析师，熟悉水利工程投标文件的技术、商务、资质、质量、安全、交付和售后响应要求。
        企业画像：
        {enterprise_context}
        请根据以下招标书内容，输出投标书其他响应文件的格式章节内容（除封面章节），并严格按照下面的JSON格式返回你的分析结果，不要有任何多余的解释。
        {{
            "chapter_format":"..."
        }}
        "chapter_format":招标书中的其他响应文件格式，如果有表格内容，请用Markdown表格的形式返回。
        招标书内容如下:
        ---
        {bid_content}
        ---
        '''
        response = call_dashscope_api([
                {'role': 'user', 'content': post_analysis_prompt}
            ])
        try:
             http_data = response['output']['choices'][0]['message']['content']
             temp_analysis_store[bidding_id]['directoryStructure'] = http_data
        except (KeyError, IndexError, TypeError):
             return jsonify({'error': 'API响应格式错误'}), 500


        analysis_result = strip_llm_json(http_data)
        return jsonify(analysis_result)

    except Exception as e:
        print(f'[ERROR] 招标文件章节提取失败，业务编号 {bidding_id}: {str(e)}')
        return jsonify({'error': '章节提取分析失败，请稍后重试。'}), 500
    
@bp.route('/chapter-design', methods=['POST'])
def chapter_design():
    """投标文件章节设计"""
    data = request.get_json()
    bidding_id = data.get('biddingId') 
    logging.info(f"temp_analysis_store: {temp_analysis_store}")
    print(f"temp_analysis_store: {temp_analysis_store}")
    # 获取分析结果和目录结构
    analysis_data = temp_analysis_store.get(bidding_id, {}).get('analysisData')
    directory_structure = temp_analysis_store.get(bidding_id, {}).get('directoryStructure')

    if not all([bidding_id, analysis_data, directory_structure]):
        return jsonify({'error': '招标文件分析数据不完整，请按流程重新执行预分析与章节提取。'}), 400

    # 提取招标书信息
    bidding_requirements = analysis_data.get('bidding_requirements', '')
    bidding_summary = analysis_data.get('bidding_summary', '')
    bidding_meta = analysis_data.get('bidding_meta', '')

    # 构建提示词
    enterprise_context = build_enterprise_context()
    chapter_design_prompt = (
        f"你是资深投标文件目录结构设计专家，熟悉水利工程施工、设备配套和供应链项目投标规范。\n"
        f"企业画像：\n{enterprise_context}\n\n"
        f"请根据以下信息，整理出最终的标书章节结构：\n\n"
        f"必须包含的文件和材料：{bidding_requirements}\n"
        f"招标书内容总结：{bidding_summary}\n"
        f"招标书具体要求和评分标准：{bidding_meta}\n"
        f"投标书章节大纲：{directory_structure}\n\n"
        "基于以上招标文件要求和企业画像，请补充章节的子节目录，确保投标文件完整、严谨、可执行且符合要求。\n"
        "要求：\n"
        "1、输出的投标书章节结构必须遵循目录结构，并包含所有必要的子章节。\n"
        "2、章节大纲中某一章如果是xxx表、xxx函、xxx清单、封面等，则该章下不需要再细分子节，返回原本的章节内容。\n"
        "3、输出必须是有效的JSON格式，格式如下：\n"
        '''{
  "chapters": [
    {
      "title": "",
      "type": "normal|table",
      "content": "",
      "sections": [
        {
          "title": "",
          "subsections": [
            {
              "title": "",
              "describe": ""
            }
          ]
        }
      ]
    }
  ]
}'''
        "字段说明：\n"
        "title：章节标题。\n"
        "type：章节类型，normal表示文本章节，table表示表格章节。\n"
        "content：table章节需填写原本章节内容。\n"
        "sections：二级标题。\n"
        "subsections：三级标题，最少5-7点三级标题。\n"
        "describe：三级标题内容的描述。\n"
    )

    try:
        # 调用 LLM API
        response = call_dashscope_api([
            {'role': 'user', 'content': chapter_design_prompt}
        ])
        print(f'[INFO] response: {response}')

        # 获取返回内容
        try:
            http_data = response['output']['choices'][0]['message']['content']
        except (KeyError, IndexError, TypeError):
            return jsonify({'error': 'API响应格式错误'}), 500

        try:
            analysis_result = strip_llm_json(http_data)
        except json.JSONDecodeError as e:
            print("------ JSON Parse Error ------")
            print(f"Error: {e}")
            print("Raw text snippet:")
            print(http_data[:2000])
            return jsonify({'error': f'JSON解析失败: {str(e)}'}), 500

        return jsonify(analysis_result)

    except Exception as e:
        print(f'[ERROR] 投标章节设计失败，业务编号 {bidding_id}: {str(e)}')
        return jsonify({'error': '章节生成失败，请稍后重试。'}), 500

    



@bp.route('/generate-bid-document', methods=['POST'])
def generate_bid_document():
    """生成完整投标书文件，并在生成 .docx 后构造 OnlyOffice editorConfig 返回"""
    data = request.get_json()
    bidding_id = data.get('biddingId')
    chapter_design = data.get('chapterDesign')
    if not bidding_id:
        return jsonify({'error': '缺少招标文件业务编号。'}), 400
    if not chapter_design:
        return jsonify({'error': '缺少投标文件章节设计结果。'}), 400

    # 如果前端传的是字符串形式的 JSON，尝试解析
    if isinstance(chapter_design, str):
        try:
            chapter_design = json.loads(chapter_design)
        except Exception as e:
            logging.error(f"chapterDesign JSON 解析失败: {e}")
            return jsonify({'error': 'chapterDesign JSON 解析失败'}), 400
    if isinstance(chapter_design, dict) and 'chapters' in chapter_design:
        chapter_design = chapter_design['chapters']
    if not isinstance(chapter_design, list):
        return jsonify({'error': 'chapterDesign 格式错误，应为章节数组或包含 chapters 的对象'}), 400

    try:
        # 读取 bidding 记录
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM bidding WHERE id = ?', (bidding_id,))
        bidding = cursor.fetchone()
        conn.close()
        if not bidding:
            return jsonify({'error': '招标书不存在'}), 404

        tender_name = Path(bidding['original_filename']).stem
        # 如果已经生成 markdown，直接转换
        markdown_file = Path("outputs") / tender_name / f"{tender_name}_完整投标文件.md"
        if markdown_file.exists():
            logging.info("已存在生成的 Markdown 文件，直接调用转换函数。")
            try:
                generated_docx_path = convert_md_to_word(markdown_file)
            except Exception as e:
                logging.exception("已生成 Markdown 转 Word 失败")
                return jsonify({'error': '已存在 Markdown，但转换为 Word 失败'}), 500

            if not generated_docx_path or not Path(generated_docx_path).exists():
                logging.error(f"convert_md_to_word 未返回有效路径或文件不存在: {generated_docx_path}")
                return jsonify({'error': '已生成 Markdown，但 docx 未找到'}), 500

            generated_docx_path = Path(generated_docx_path)

            # 继续到下面的步骤（复制到 GENERATED_FOLDER、构造 editorConfig 等）
        else:
            # 按原逻辑生成章节内容并合并为 markdown
            # 用你原来的生成逻辑（这里为最小改动保留）
            saved_section_names = []
            for chapter in chapter_design:
                c_type = (chapter.get('type') or "normal").strip().lower()
                c_title = chapter.get('title', "")
                c_content = chapter.get('content', "")
                if c_type == 'table':
                    if c_content:
                        save_bid_section(c_content, c_title, "outputs", tender_name)
                        saved_section_names.append(c_title)
                elif c_type == 'normal':
                    sections = chapter.get('sections', [])
                    tasks = []
                    with ThreadPoolExecutor(max_workers=8) as executor:
                        for section in sections:
                            subsections = section.get('subsections', [])
                            for subsection in subsections:
                                sub_title = subsection.get('title', '')
                                sub_content = subsection.get('describe', '')
                                vector_context = query_chroma(sub_content)
                                if not sub_title or not sub_content:
                                    logging.warning(f"跳过无效的 subsection：{sub_title}")
                                    continue
                                future = executor.submit(generate_bid_section, sub_title, sub_content, vector_context)
                                tasks.append((future, sub_title))
                        for future, sub_title in tasks:
                            try:
                                generated_content = future.result()
                                save_bid_section(generated_content, sub_title, "outputs", tender_name)
                                saved_section_names.append(sub_title)
                            except Exception:
                                logging.exception("投标正文小节生成失败: %s", sub_title)
                else:
                    logging.warning(f"未知的 chapter type '{c_type}'，跳过：{c_title}")

            merged_md_path = merge_sections("outputs", tender_name, saved_section_names)
            if not merged_md_path:
                logging.error("合并章节生成 Markdown 失败。")
                return jsonify({'error': '合并章节失败'}), 500

            try:
                generated_docx_path = convert_md_to_word(merged_md_path)
            except Exception:
                logging.exception("Markdown 转 Word 失败")
                return jsonify({'error': 'Markdown 转 Word 失败'}), 500

            if not generated_docx_path or not Path(generated_docx_path).exists():
                logging.error(f"convert_md_to_word 未返回有效路径或文件不存在: {generated_docx_path}")
                return jsonify({'error': '生成的 docx 文件不存在'}), 500

            generated_docx_path = Path(generated_docx_path)

        # === 下面开始：把生成的 docx 放到 GENERATED_FOLDER 并构造 OnlyOffice editorConfig（内联实现） ===
        

        gen_folder = Path(current_app.config.get('GENERATED_FOLDER', 'outputs'))
        gen_folder.mkdir(parents=True, exist_ok=True)

        target = gen_folder / _display_filename(generated_docx_path.stem, "投标文件")
        target = target.with_suffix(generated_docx_path.suffix)
        if generated_docx_path.resolve() != target.resolve():
            shutil.copy2(str(generated_docx_path), str(target))

        backend_url = get_backend_public_base_url()
        file_url = _absolute_output_url_for_path(target)
        callback_url = f"{backend_url}/api/bidding/save-callback"

        # document key（用于 OnlyOffice 缓存），使用 DB 中已有的或者新生成
        doc_key = bidding[4]

        payload = {
            'document': {
                'fileType': 'docx',
                'key': doc_key,
                'title': bidding['original_filename'],
                'url': file_url,
            },
            'documentType': 'word',
            'editorConfig': {
                'callbackUrl': callback_url,
                'mode': 'edit',
                'user': {
                    'id': f"user-{bidding['user_id']}",
                    'name': '企业标书编制岗'
                },
                'customization': {'forcesave': True}
            }
        }

        # 生成JWT令牌
        token = jwt.encode(payload, ONLYOFFICE_JWT_SECRET, algorithm='HS256')
        editor_config_with_token = {**payload, 'token': token}
        

        # 更新 DB：记录生成的 docx 路径与 document_key、状态
        conn = get_db()
        cur = conn.cursor()
        cur.execute('UPDATE bidding SET bid_document=?, document_key=?, status=? WHERE id=?',
                    (str(target), doc_key, '已生成', bidding['id']))
        conn.commit()
        conn.close()

        # 返回 editorConfig 给前端，前端用此配置初始化 OnlyOffice
        return jsonify({
            'message': '投标文件已生成',
            'markdown': str(markdown_file if markdown_file.exists() else merged_md_path),
            'editorConfig': editor_config_with_token,
            'fileUrl': file_url,
            'downloadUrl': _output_url_for_path(target)
        }), 201

    except Exception as e:
        logging.exception(f"生成投标书过程出错: {e}")
        return jsonify({'error': f'生成投标书失败: {str(e)}'}), 500

from backend.rag.ingestion import ingest_knowledge_document, create_knowledge_document, update_knowledge_document_status
from backend.rag.retrieval import (
    generate_knowledge_answer,
    search_knowledge_assets,
    search_knowledge_base,
    stream_knowledge_answer,
)

def sync_and_parse_knowledge_in_background(file_path, original_filename, parse_id, document_id):
    try:
        write_parse_status(parse_id, {
            "parse_status": "mineru_submitted",
            "parser": "mineru",
            "source_file": file_path,
            "file_name": original_filename,
        })
        # For simplicity, we directly call mineru tasks here
        # Assuming parse_and_index_tender_file creates the mineru batch, but we want our own ingestion logic
        # So we can use the same run mineru logic but with custom ingestion
        from backend.parsing.document_parser import _run_mineru_parse_and_index, has_mineru_token, _should_use_mineru_first
        from backend.parsing.mineru_client import download_and_extract_zip, wait_for_batch_file_result, create_local_file_batch_task
        
        output_dir = Path("parsed_outputs") / parse_id
        
        task = create_local_file_batch_task(
            local_file_path=file_path,
            file_name=original_filename,
            data_id=parse_id,
        )
        
        def on_progress(result: dict) -> None:
            pass
            
        result = wait_for_batch_file_result(batch_id=task.batch_id, data_id=parse_id, on_progress=on_progress)
        full_zip_url = result.get("full_zip_url")
        if not full_zip_url:
            raise RuntimeError(f"MinerU finished without full_zip_url")
            
        artifacts = download_and_extract_zip(full_zip_url, output_dir)
        
        # Now call our custom ingestion
        ingest_knowledge_document(
            document_id=document_id,
            original_filename=original_filename,
            markdown_path=artifacts.get("markdown_path"),
            extract_dir=str(output_dir)
        )
        
    except Exception as e:
        logging.exception("知识库解析入库失败")
        update_knowledge_document_status(document_id, "failed")

@knowledge_bp.route('/upload', methods=['POST'])
@bp.route('/knowledge/upload', methods=['POST'])
def upload_knowledge():
    if 'file' not in request.files:
        return jsonify({'error': '未接收到知识库文件'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '未选择知识库文件'}), 400

    try:
        original_filename = file.filename
        safe_filename = secure_filename(original_filename)
        unique_filename = f"{uuid.uuid4()}-{safe_filename}"
        file_path = os.path.join(current_app.config['UPLOAD_FOLDER'], unique_filename)
        file.save(file_path)

        # 1. Create Knowledge Document DB Record
        document_id = create_knowledge_document(
            title=original_filename,
            category="general",
            bucket="knowledge",
            object_path=f"temp/{unique_filename}",
            source_type=Path(original_filename).suffix.lstrip(".")
        )

        parse_id = str(uuid.uuid4())
        
        threading.Thread(
            target=sync_and_parse_knowledge_in_background,
            args=(file_path, original_filename, parse_id, document_id),
            daemon=True,
        ).start()

        return jsonify({
            'message': '知识文档已上传，正在后台提取图文特征',
            'documentId': document_id
        }), 201

    except Exception as e:
        logging.exception("知识库文件上传处理失败")
        return jsonify({'error': f'文件上传失败: {str(e)}'}), 500

@knowledge_bp.route('/search', methods=['POST'])
@bp.route('/knowledge/search', methods=['POST'])
def search_knowledge():
    data = request.get_json()
    query = data.get('query')
    if not query:
        return jsonify({'error': '缺少检索问题 query'}), 400
        
    try:
        # 1. 向量化并检索 Supabase
        contexts = search_knowledge_base(query, match_threshold=0.3, match_count=8)
        assets = search_knowledge_assets(query, match_count=8)
        
        # 2. RAG 生成回答
        result = generate_knowledge_answer(query, contexts, assets)
        
        return jsonify(result), 200
        
    except Exception as e:
        logging.exception("知识库检索问答失败")
        return jsonify({'error': f'检索问答失败: {str(e)}'}), 500

@knowledge_bp.route('/search/stream', methods=['POST'])
@bp.route('/knowledge/search/stream', methods=['POST'])
def stream_search_knowledge():
    data = request.get_json() or {}
    query = (data.get('query') or '').strip()
    if not query:
        return jsonify({'error': '缺少检索问题 query'}), 400

    def is_relevant_knowledge_query(text: str) -> bool:
        keywords = [
            "水利", "水库", "除险", "加固", "招标", "投标", "标书", "资格", "资质", "评标",
            "评分", "废标", "否决", "施工", "监理", "勘察", "设计", "EPC", "总承包",
            "工期", "质量", "安全", "环保", "水保", "防汛", "度汛", "灌区", "泵站",
            "水闸", "堤防", "河道", "合同", "报价", "工程量清单", "投标文件", "招标文件",
            "企业知识库", "企业资信", "资信库", "企业产品", "产品库", "标准话术", "政策法规",
            "水利标准", "章节", "正文", "图片", "附件", "材料", "样张", "业绩", "类似业绩",
            "营业执照", "执照", "许可证", "安全生产许可", "人员", "社保", "缴纳证明",
            "证书", "证件", "产品", "设备", "图册", "参考图", "配图",
        ]
        lowered = text.lower()
        ascii_keywords = ["bid", "tender", "rag", "qualification", "water", "reservoir", "product", "asset", "certificate"]
        return any(keyword in text for keyword in keywords) or any(keyword in lowered for keyword in ascii_keywords)

    def emit(payload: dict) -> str:
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    @stream_with_context
    def generate():
        yield emit({"type": "start"})
        try:
            yield emit({"type": "status", "message": "正在检索企业知识库和图片资产..."})
            contexts = search_knowledge_base(query, match_threshold=0.3, match_count=8)
            assets = search_knowledge_assets(query, match_count=8)
            if not contexts and not assets and not is_relevant_knowledge_query(query):
                yield emit({
                    "type": "chunk",
                    "content": "抱歉，当前企业知识库主要服务于水利招投标、标书编制、企业资信、产品资料、业绩材料、人员证书、施工组织设计和废标风险等问题。这个问题与当前知识库范围不太相关，我暂时不能基于本知识库给出可靠回答。",
                })
                yield emit({"type": "done"})
                return
            yield emit({
                "type": "status",
                "message": f"已召回 {len(contexts)} 条资料、{len(assets)} 个图片资产，正在生成回答..."
            })
            for event in stream_knowledge_answer(query, contexts, assets):
                yield emit(event)
        except Exception as e:
            logging.exception("知识库流式检索问答失败")
            yield emit({"type": "error", "error": f"检索问答失败: {str(e)}"})

    return Response(generate(), mimetype='text/event-stream')


def _compact_followup_assets(assets: list[dict]) -> list[dict]:
    compacted = []
    for index, asset in enumerate((assets or [])[:8], 1):
        compacted.append({
            "index": index,
            "title": asset.get("title"),
            "category": asset.get("category"),
            "asset_type": asset.get("asset_type"),
            "description": asset.get("description"),
            "tags": asset.get("tags") or [],
            "applicable_sections": asset.get("applicable_sections") or [],
        })
    return compacted


def _compact_followup_sources(sources: list[dict]) -> list[dict]:
    compacted = []
    for index, source in enumerate((sources or [])[:5], 1):
        metadata = source.get("metadata") or {}
        compacted.append({
            "index": index,
            "title": metadata.get("source_org") or metadata.get("source_file") or metadata.get("category_label") or metadata.get("category"),
            "doc_type": metadata.get("doc_type"),
            "content_preview": str(source.get("content") or "").replace("\n", " ")[:240],
        })
    return compacted


def _normalize_followups(payload: dict) -> dict:
    intent = str(payload.get("intent") or "general_qa").strip() or "general_qa"
    followups = payload.get("followups")
    if not isinstance(followups, list):
        followups = []

    cleaned = []
    seen = set()
    for item in followups:
        text = str(item or "").strip()
        if not text or text in seen:
            continue
        if len(text) > 80:
            text = text[:80].rstrip("，。；;,. ") + "？"
        if not text.endswith(("?", "？")):
            text += "？"
        cleaned.append(text)
        seen.add(text)
        if len(cleaned) >= 3:
            break

    return {
        "intent": intent,
        "followups": cleaned,
    }


def _parse_followup_model_content(content) -> dict:
    if isinstance(content, dict):
        return content
    if isinstance(content, str):
        parsed = strip_llm_json(content)
        return parsed if isinstance(parsed, dict) else {}
    return {}


@knowledge_bp.route('/followups', methods=['POST'])
@bp.route('/knowledge/followups', methods=['POST'])
def generate_knowledge_followups():
    data = request.get_json() or {}
    question = str(data.get("question") or "").strip()
    answer = str(data.get("answer") or "").strip()
    if not question or not answer:
        return jsonify({"intent": "general_qa", "followups": []}), 200

    assets = data.get("assets") if isinstance(data.get("assets"), list) else []
    sources = data.get("sources") if isinstance(data.get("sources"), list) else []
    prompt_payload = {
        "user_question": question[:800],
        "assistant_answer": answer[:2600],
        "retrieved_assets": _compact_followup_assets(assets),
        "retrieved_sources": _compact_followup_sources(sources),
    }
    prompt = f"""你是 AI 标书系统的企业知识库问答意图识别器。
请根据用户问题、助手回答、召回资料和图片资产，判断用户下一步最可能需要什么，并生成 3 个专业、具体、可点击的后续问题。

要求：
1. 问题必须服务于水利招投标、标书编制、企业资信、产品资料、业绩材料、风险核查或材料入库。
2. 问题要像业务人员自然会追问的话，不能泛泛而谈。
3. 如果回答涉及图片资产，要优先引导“图片适合放在哪个章节”“哪些能插入正文/附件”“还缺哪些原件或证明”。
4. 如果回答涉及资质、人员、社保、营业执照、许可证，要优先引导材料完整性和废标风险核查。
5. 如果回答涉及产品、设备、参数，要优先引导技术响应配图和参数匹配。
6. 只输出 JSON，不要输出 Markdown，不要解释。

JSON 格式：
{{
  "intent": "asset_lookup | qualification_check | bid_writing | risk_check | product_matching | material_gap | general_qa",
  "followups": ["问题1", "问题2", "问题3"]
}}

输入：
{json.dumps(prompt_payload, ensure_ascii=False)}
"""
    try:
        response = call_dashscope_api(
            [
                {"role": "system", "content": "你只输出合法 JSON。"},
                {"role": "user", "content": prompt},
            ],
            model=get_setting("knowledge_followup_model", get_setting("text_model", "qwen-turbo-latest")),
            json_mode=True,
        )
        content = (
            response.get("output", {})
            .get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        parsed = _parse_followup_model_content(content)
        return jsonify(_normalize_followups(parsed)), 200
    except Exception:
        logging.exception("生成知识库追问建议失败")
        return jsonify({"intent": "general_qa", "followups": []}), 200

from backend.db.supabase_repo import (
    get_knowledge_asset_detail,
    get_knowledge_document_detail,
    list_knowledge_assets,
    list_knowledge_documents,
)

@knowledge_bp.route('/documents', methods=['GET'])
@bp.route('/knowledge/documents', methods=['GET'])
def get_knowledge_documents():
    try:
        docs = list_knowledge_documents()
        return jsonify(docs), 200
    except Exception as e:
        logging.exception("查询知识库文档列表失败")
        return jsonify({'error': f'查询失败: {str(e)}'}), 500


@knowledge_bp.route('/documents/<document_id>', methods=['GET'])
@bp.route('/knowledge/documents/<document_id>', methods=['GET'])
def get_knowledge_document(document_id):
    try:
        detail = get_knowledge_document_detail(document_id)
        if not detail:
            return jsonify({'error': '知识库文档不存在'}), 404
        return jsonify(detail), 200
    except Exception as e:
        logging.exception("查询知识库文档详情失败")
        return jsonify({'error': f'查询失败: {str(e)}'}), 500


@knowledge_bp.route('/assets', methods=['GET'])
@bp.route('/knowledge/assets', methods=['GET'])
def get_knowledge_assets():
    try:
        asset_type = request.args.get('asset_type')
        category = request.args.get('category')
        assets = list_knowledge_assets(asset_type=asset_type, category=category)
        return jsonify(assets), 200
    except Exception as e:
        logging.exception("查询知识资产列表失败")
        return jsonify({'error': f'查询失败: {str(e)}'}), 500


@knowledge_bp.route('/assets/<asset_id>', methods=['GET'])
@bp.route('/knowledge/assets/<asset_id>', methods=['GET'])
def get_knowledge_asset(asset_id):
    try:
        asset = get_knowledge_asset_detail(asset_id)
        if not asset:
            return jsonify({'error': '知识资产不存在'}), 404
        return jsonify(asset), 200
    except Exception as e:
        logging.exception("查询知识资产详情失败")
        return jsonify({'error': f'查询失败: {str(e)}'}), 500


@knowledge_bp.route('/assets/<asset_id>/file', methods=['GET'])
@bp.route('/knowledge/assets/<asset_id>/file', methods=['GET'])
def get_knowledge_asset_file(asset_id):
    try:
        variant = request.args.get("variant") or "original"
        result = download_knowledge_asset_file_variant(asset_id, variant=variant)
        if not result:
            return jsonify({'error': '知识资产文件不存在'}), 404

        asset, data = result
        mime_type = asset.get("mime_type") or "application/octet-stream"
        filename = asset.get("file_name") or asset.get("title") or f"{asset_id}"
        return Response(
            data,
            mimetype=mime_type,
            headers={
                "Content-Disposition": f"inline; filename*=UTF-8''{requests.utils.quote(str(filename))}",
                "Cache-Control": "private, max-age=86400" if variant == "thumb" else "private, max-age=300",
            },
        )
    except Exception as e:
        logging.exception("读取知识资产文件失败")
        return jsonify({'error': f'读取文件失败: {str(e)}'}), 500


def _split_form_list(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
    except Exception:
        pass
    return [item.strip() for item in re.split(r"[,，\n]", value) if item.strip()]


def _build_asset_searchable_text(payload: dict) -> str:
    parts = [
        payload.get("title"),
        payload.get("description"),
        payload.get("category"),
        payload.get("asset_type"),
        payload.get("ai_caption"),
    ]
    parts.extend(payload.get("tags") or [])
    parts.extend(payload.get("applicable_sections") or [])
    specs = payload.get("specs") or {}
    if isinstance(specs, dict):
        parts.extend(str(value) for value in specs.values() if value)
    return "\n".join(str(part).strip() for part in parts if str(part or "").strip())


@knowledge_bp.route('/assets/upload', methods=['POST'])
@bp.route('/knowledge/assets/upload', methods=['POST'])
def upload_knowledge_asset():
    try:
        file = request.files.get('file')
        if not file or not file.filename:
            return jsonify({'error': '请上传图片或附件文件'}), 400

        library_type = request.form.get('library_type') or 'qualification'
        if library_type not in {'qualification', 'product'}:
            return jsonify({'error': 'library_type 仅支持 qualification 或 product'}), 400

        asset_type = request.form.get('asset_type') or ('qualification_image' if library_type == 'qualification' else 'product_image')
        category = request.form.get('category') or ('企业资信' if library_type == 'qualification' else '产品资料')
        title = (request.form.get('title') or file.filename).strip()
        description = (request.form.get('description') or '').strip()
        tags = _split_form_list(request.form.get('tags'))
        applicable_sections = _split_form_list(request.form.get('applicable_sections'))
        allowed_for_bid = request.form.get('allowed_for_bid', 'true').lower() in {'1', 'true', 'yes', 'on'}
        is_sensitive = request.form.get('is_sensitive', 'false').lower() in {'1', 'true', 'yes', 'on'}
        anonymized = request.form.get('anonymized', 'true').lower() in {'1', 'true', 'yes', 'on'}

        upload_dir = Path(current_app.config['UPLOAD_FOLDER'])
        upload_dir.mkdir(parents=True, exist_ok=True)
        original_filename = file.filename
        unique_filename = f"asset-{uuid.uuid4()}-{secure_filename(original_filename) or 'upload'}"
        local_path = upload_dir / unique_filename
        file.save(local_path)

        storage_info = upload_knowledge_asset_file(
            local_file_path=local_path,
            original_filename=original_filename,
            library_type=library_type,
        )

        payload = {
            "title": title,
            "description": description,
            "category": category,
            "asset_type": asset_type,
            "file_name": original_filename,
            "file_ext": storage_info.get("file_ext"),
            "mime_type": storage_info.get("mime_type"),
            "file_size": storage_info.get("file_size"),
            "storage_bucket": storage_info.get("bucket"),
            "storage_path": storage_info.get("object_path"),
            "public_url": storage_info.get("public_url"),
            "source_type": "user_upload",
            "license": "企业自有资料",
            "attribution": request.form.get('attribution') or "用户上传",
            "is_synthetic": False,
            "is_sensitive": is_sensitive,
            "anonymized": anonymized,
            "industry": "水利行业",
            "applicable_sections": applicable_sections,
            "tags": tags,
            "specs": {
                "library_type": library_type,
                "allowed_for_bid": allowed_for_bid,
                "usage_note": request.form.get('usage_note') or '',
                "certificate_no": request.form.get('certificate_no') or '',
                "issuer": request.form.get('issuer') or '',
                "product_model": request.form.get('product_model') or '',
            },
            "ai_caption": description,
            "status": "indexed",
            "metadata": {
                "library_type": library_type,
                "allowed_for_bid": allowed_for_bid,
                "upload_source": "enterprise_library_page",
                "thumbnail_storage_bucket": storage_info.get("thumbnail_bucket"),
                "thumbnail_storage_path": storage_info.get("thumbnail_path"),
                "thumbnail_mime_type": storage_info.get("thumbnail_mime_type"),
                "thumbnail_size": storage_info.get("thumbnail_size"),
            },
        }
        payload["searchable_text"] = _build_asset_searchable_text(payload)

        try:
            from backend.rag.vector_store import init_ali_client, get_embeddings
            embeddings = get_embeddings(init_ali_client(), [payload["searchable_text"]])
            if embeddings:
                payload["embedding"] = embeddings[0]
        except Exception:
            logging.exception("知识资产 embedding 生成失败，将仅保存结构化资产")

        asset = create_knowledge_asset(payload)
        return jsonify(asset), 201
    except Exception as e:
        logging.exception("上传知识资产失败")
        return jsonify({'error': f'上传失败: {str(e)}'}), 500
