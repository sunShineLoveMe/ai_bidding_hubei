import hashlib
import logging
import mimetypes
import os
import time
import uuid
from pathlib import Path
from typing import Any

from backend.core.bid_volumes import ensure_section_volume

from backend.db.supabase_client import get_bucket_name, get_supabase_client, reset_supabase_client, upload_file_to_storage


def _file_sha256(file_path: str | Path) -> str:
    digest = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _project_name_from_filename(filename: str) -> str:
    return Path(filename).stem or filename


def _storage_extension(filename: str, local_path: Path) -> str:
    suffix = Path(filename).suffix or local_path.suffix
    suffix = suffix.lower()
    if suffix and suffix.isascii() and all(ch.isalnum() or ch == "." for ch in suffix):
        return suffix
    return ""


def create_bid_project_for_upload(original_filename: str) -> dict[str, Any]:
    client = get_supabase_client()
    payload = {
        "project_name": _project_name_from_filename(original_filename),
        "status": "uploaded",
    }
    response = client.table("bid_projects").insert(payload).execute()
    if not response.data:
        raise RuntimeError("Supabase bid_projects insert returned no data")
    return response.data[0]


def upload_tender_file_and_create_record(
    *,
    project_id: str,
    local_file_path: str | Path,
    original_filename: str,
) -> dict[str, Any]:
    client = get_supabase_client()
    bucket = get_bucket_name("tender")
    local_path = Path(local_file_path)
    safe_suffix = _storage_extension(original_filename, local_path)
    object_path = f"{project_id}/{uuid.uuid4().hex}{safe_suffix}"
    content_type = mimetypes.guess_type(original_filename)[0] or "application/octet-stream"

    upload_file_to_storage(bucket, object_path, local_path, content_type)

    payload = {
        "project_id": project_id,
        "file_name": original_filename,
        "file_type": safe_suffix.lstrip(".") or None,
        "bucket": bucket,
        "object_path": object_path,
        "file_hash": _file_sha256(local_path),
        "file_size": local_path.stat().st_size,
        "parse_status": "pending",
    }
    response = client.table("bid_files").insert(payload).execute()
    if not response.data:
        raise RuntimeError("Supabase bid_files insert returned no data")
    return response.data[0]


def sync_uploaded_tender_to_supabase(local_file_path: str | Path, original_filename: str) -> dict[str, Any]:
    project = create_bid_project_for_upload(original_filename)
    try:
        file_record = upload_tender_file_and_create_record(
            project_id=project["id"],
            local_file_path=local_file_path,
            original_filename=original_filename,
        )
    except Exception:
        get_supabase_client().table("bid_projects").delete().eq("id", project["id"]).execute()
        raise
    return {
        "project": project,
        "file": file_record,
    }


def update_bid_file_parse_status(file_id: str, parse_status: str) -> None:
    get_supabase_client().table("bid_files").update({"parse_status": parse_status}).eq("id", file_id).execute()


def get_bid_file(file_id: str) -> dict[str, Any] | None:
    response = get_supabase_client().table("bid_files").select("*").eq("id", file_id).limit(1).execute()
    return response.data[0] if response.data else None


def get_latest_bid_file_for_project(project_id: str) -> dict[str, Any] | None:
    response = (
        get_supabase_client()
        .table("bid_files")
        .select("*")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return response.data[0] if response.data else None


def download_bid_file_to_local(file_record: dict[str, Any], target_dir: str | Path) -> Path:
    bucket = file_record.get("bucket")
    object_path = file_record.get("object_path")
    if not bucket or not object_path:
        raise RuntimeError("招标文件缺少 Supabase Storage bucket/object_path，无法重试解析")

    client = get_supabase_client()
    content = client.storage.from_(bucket).download(object_path)
    if isinstance(content, bytes):
        data = content
    elif hasattr(content, "content"):
        data = content.content
    else:
        data = bytes(content)

    target = Path(target_dir)
    target.mkdir(parents=True, exist_ok=True)
    suffix = Path(file_record.get("file_name") or "").suffix or f".{file_record.get('file_type') or 'bin'}"
    local_path = target / f"retry-{uuid.uuid4()}{suffix}"
    local_path.write_bytes(data)
    return local_path


def delete_bid_project(project_id: str) -> None:
    client = get_supabase_client()
    for table in [
        "bid_sections",
        "bid_chapter_suggestions",
        "bid_scoring_items",
        "bid_risks",
        "bid_requirements",
        "bid_analysis",
        "document_chunks",
        "bid_files",
        "onlyoffice_documents",
    ]:
        try:
            client.table(table).delete().eq("project_id", project_id).execute()
        except Exception:
            logging.exception("删除项目关联表失败: table=%s project_id=%s", table, project_id)
    client.table("bid_projects").delete().eq("id", project_id).execute()


def identify_app_user(fingerprint_id: str) -> tuple[str, bool]:
    """Create or return a lightweight local-app user in Supabase."""
    client = get_supabase_client()
    response = (
        client.table("app_users")
        .select("*")
        .eq("fingerprint_id", fingerprint_id)
        .limit(1)
        .execute()
    )
    if response.data:
        return response.data[0]["id"], False

    created = client.table("app_users").insert({"fingerprint_id": fingerprint_id}).execute()
    if not created.data:
        raise RuntimeError("Supabase app_users insert returned no data")
    return created.data[0]["id"], True


def save_onlyoffice_document(
    *,
    document_key: str,
    project_id: str,
    title: str,
    file_path: str,
    download_url: str,
) -> dict[str, Any]:
    payload = {
        "document_key": document_key,
        "project_id": project_id,
        "title": title,
        "file_path": file_path,
        "download_url": download_url,
    }
    response = get_supabase_client().table("onlyoffice_documents").upsert(payload, on_conflict="document_key").execute()
    if not response.data:
        raise RuntimeError("Supabase onlyoffice_documents upsert returned no data")
    return response.data[0]


def get_onlyoffice_document(document_key: str) -> dict[str, Any] | None:
    response = (
        get_supabase_client()
        .table("onlyoffice_documents")
        .select("*")
        .eq("document_key", document_key)
        .limit(1)
        .execute()
    )
    return response.data[0] if response.data else None


def replace_project_rows(table: str, project_id: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    client = get_supabase_client()
    client.table(table).delete().eq("project_id", project_id).execute()
    if not rows:
        return []
    response = client.table(table).insert(rows).execute()
    return response.data or []


def replace_bid_analysis(project_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    rows = replace_project_rows("bid_analysis", project_id, [payload])
    return rows[0] if rows else None


def _is_valid_uuid(value: Any) -> bool:
    if not value or not isinstance(value, str):
        return False
    try:
        uuid.UUID(value)
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def _section_payload(project_id: str, section: dict[str, Any], index: int) -> dict[str, Any]:
    section = ensure_section_volume(section)
    return {
        "project_id": project_id,
        "parent_id": section.get("parent_id") if _is_valid_uuid(section.get("parent_id")) else None,
        "order_index": section.get("order_index") or section.get("order") or index + 1,
        "level": section.get("level") or 1,
        "title": section.get("title") or "未命名章节",
        "status": section.get("status") or "draft",
        "purpose": section.get("purpose"),
        "response_points": section.get("response_points") or [],
        "mapped_requirements": section.get("mapped_requirements") or [],
        "mapped_scoring_items": section.get("mapped_scoring_items") or [],
        "mapped_risks": section.get("mapped_risks") or [],
        "required_materials": section.get("required_materials") or [],
        "source_pages": section.get("source_pages") or [],
        "writing_notes": section.get("writing_notes") or [],
        "content": section.get("content") or "",
        "metadata": section.get("metadata") or {},
    }


def _outline_flat_sections(outline: dict[str, Any]) -> list[dict[str, Any]]:
    chapters = outline.get("chapters")
    if isinstance(chapters, list) and chapters:
        return chapters

    flat_sections: list[dict[str, Any]] = []
    root_offset = 0
    volumes = outline.get("volumes") if isinstance(outline.get("volumes"), list) else []
    for volume in volumes:
        if not isinstance(volume, dict):
            continue
        volume_chapters = volume.get("chapters") if isinstance(volume.get("chapters"), list) else []
        root_orders = [
            str(chapter.get("order") or index + 1)
            for index, chapter in enumerate(volume_chapters)
            if "." not in str(chapter.get("order") or index + 1)
        ]
        root_map = {
            old_order: str(root_offset + index)
            for index, old_order in enumerate(root_orders, start=1)
        }
        volume_type = volume.get("type")
        volume_title = volume.get("name")
        for chapter in volume_chapters:
            metadata = chapter.get("metadata") if isinstance(chapter.get("metadata"), dict) else {}
            section = {
                **chapter,
                "metadata": {
                    **metadata,
                    "volume_type": metadata.get("volume_type") or volume_type,
                    "volume_name": metadata.get("volume_name") or volume_title,
                },
            }
            old_order = str(section.get("order") or "")
            old_root, _, suffix = old_order.partition(".")
            new_root = root_map.get(old_root, str(root_offset + len(root_map) + 1))
            section["order"] = f"{new_root}.{suffix}" if suffix else new_root
            flat_sections.append(section)
        root_offset += len(root_orders)
    return flat_sections


def replace_bid_sections_from_outline(project_id: str, outline: dict[str, Any]) -> list[dict[str, Any]]:
    client = get_supabase_client()
    client.table("bid_sections").delete().eq("project_id", project_id).execute()

    inserted_rows: list[dict[str, Any]] = []
    order_to_id: dict[str, str] = {}
    for index, section in enumerate(_outline_flat_sections(outline)):
        section_order = str(section.get("order") or index + 1)
        parent_id = section.get("parent_id")
        if not parent_id and "." in section_order:
            parent_order = section_order.rsplit(".", 1)[0]
            parent_id = order_to_id.get(parent_order)

        payload = _section_payload(project_id, {**section, "parent_id": parent_id}, index)
        response = client.table("bid_sections").insert(payload).execute()
        if not response.data:
            raise RuntimeError("Supabase bid_sections insert returned no data")
        row = response.data[0]
        inserted_rows.append(row)
        order_to_id[section_order] = row["id"]

    return inserted_rows


def list_bid_sections(project_id: str) -> list[dict[str, Any]]:
    response = (
        get_supabase_client()
        .table("bid_sections")
        .select("*")
        .eq("project_id", project_id)
        .order("order_index")
        .execute()
    )
    return response.data or []


def upsert_bid_section(project_id: str, section: dict[str, Any]) -> dict[str, Any]:
    payload = _section_payload(project_id, section, int(section.get("order_index") or section.get("order") or 1) - 1)
    section_id = section.get("id")
    client = get_supabase_client()
    if _is_valid_uuid(section_id):
        response = client.table("bid_sections").update(payload).eq("id", section_id).eq("project_id", project_id).execute()
    else:
        response = client.table("bid_sections").insert(payload).execute()
    if not response.data:
        raise RuntimeError("Supabase bid_sections upsert returned no data")
    return response.data[0]


def reorder_bid_sections(project_id: str, sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    existing_rows = {row["id"]: row for row in list_bid_sections(project_id)}
    payloads: list[dict[str, Any]] = []
    for index, section in enumerate(sections, start=1):
        section_id = section.get("id")
        if not section_id:
            continue
        existing = existing_rows.get(section_id)
        if not existing:
            raise RuntimeError(f"章节不存在，无法排序: {section_id}")
        payload = {
            key: value
            for key, value in existing.items()
            if key not in {"created_at", "updated_at"}
        }
        payload.update({
            "project_id": project_id,
            "parent_id": section.get("parent_id"),
            "order_index": int(section.get("order_index") or index),
            "level": int(section.get("level") or existing.get("level") or 1),
        })
        payloads.append(payload)

    if not payloads:
        return []

    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            client = get_supabase_client()
            response = client.table("bid_sections").upsert(payloads).execute()
            return response.data or []
        except Exception as exc:
            last_error = exc
            logging.warning("批量排序 bid_sections 第 %s 次失败，准备重试: %s", attempt, exc)
            reset_supabase_client()
            if attempt < 3:
                time.sleep(0.4 * attempt)

    raise RuntimeError(f"批量排序章节失败，已重试 3 次: {last_error}") from last_error


def _section_match_score(row: dict[str, Any], section: dict[str, Any]) -> int:
    score = 0
    if row.get("title") and row.get("title") == section.get("title"):
        score += 10
    if int(row.get("level") or 0) == int(section.get("level") or 0):
        score += 3
    if int(row.get("order_index") or 0) == int(section.get("order_index") or section.get("order") or 0):
        score += 2
    return score


def _find_existing_section_for_generated_content(project_id: str, section: dict[str, Any]) -> dict[str, Any] | None:
    title = section.get("title")
    if not title:
        return None
    rows = (
        get_supabase_client()
        .table("bid_sections")
        .select("*")
        .eq("project_id", project_id)
        .eq("title", title)
        .execute()
        .data
        or []
    )
    if not rows:
        return None
    return sorted(rows, key=lambda row: _section_match_score(row, section), reverse=True)[0]


def update_bid_section_content(
    project_id: str,
    section_id: str,
    content: str,
    status: str = "edited",
    section: dict[str, Any] | None = None,
) -> dict[str, Any]:
    client = get_supabase_client()
    payload = {"content": content, "status": status}
    response = (
        client
        .table("bid_sections")
        .update(payload)
        .eq("id", section_id)
        .eq("project_id", project_id)
        .execute()
    )
    if response.data:
        return response.data[0]

    if section:
        existing = _find_existing_section_for_generated_content(project_id, section)
        if existing:
            retry = (
                client.table("bid_sections")
                .update(payload)
                .eq("id", existing["id"])
                .eq("project_id", project_id)
                .execute()
            )
            if retry.data:
                return retry.data[0]

        fallback = _section_payload(project_id, {**section, "id": None, "content": content, "status": status, "parent_id": None}, int(section.get("order_index") or section.get("order") or 1) - 1)
        created = client.table("bid_sections").insert(fallback).execute()
        if created.data:
            logging.warning(
                "章节 ID 失效，已按标题重建章节: project_id=%s old_section_id=%s title=%s",
                project_id,
                section_id,
                section.get("title"),
            )
            return created.data[0]

    raise RuntimeError("章节不存在或保存失败")


def reset_bid_sections_generation(project_id: str, clear_content: bool = False) -> list[dict[str, Any]]:
    rows = list_bid_sections(project_id)
    if not rows:
        return []

    payloads: list[dict[str, Any]] = []
    generation_meta_keys = {
        "actual_words",
        "error",
        "generated_at",
        "generation_status",
        "progress",
        "word_count",
        "writing_error",
        "writing_progress",
        "writing_status",
    }
    for row in rows:
        metadata = dict(row.get("metadata") or {})
        for key in generation_meta_keys:
            metadata.pop(key, None)
        payload = {
            key: value
            for key, value in row.items()
            if key not in {"created_at", "updated_at"}
        }
        payload.update({
            "project_id": project_id,
            "status": "draft",
            "content": "" if clear_content else row.get("content", ""),
            "metadata": metadata,
        })
        payloads.append(payload)

    response = get_supabase_client().table("bid_sections").upsert(payloads).execute()
    return response.data or []


def delete_bid_section(project_id: str, section_id: str) -> None:
    get_supabase_client().table("bid_sections").delete().eq("id", section_id).eq("project_id", project_id).execute()


def list_recent_bid_projects(limit: int = 20) -> list[dict[str, Any]]:
    response = (
        get_supabase_client()
        .table("bid_projects")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return response.data or []


def list_bid_history(limit: int = 100) -> list[dict[str, Any]]:
    client = get_supabase_client()
    projects = (
        client.table("bid_projects")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
        or []
    )
    if not projects:
        return []

    project_ids = [project["id"] for project in projects]

    def count_by_project(table: str) -> dict[str, int]:
        rows = (
            client.table(table)
            .select("project_id")
            .in_("project_id", project_ids)
            .execute()
            .data
            or []
        )
        counts: dict[str, int] = {}
        for row in rows:
            project_id = row.get("project_id")
            if project_id:
                counts[project_id] = counts.get(project_id, 0) + 1
        return counts

    analysis_counts = count_by_project("bid_analysis")
    requirement_counts = count_by_project("bid_requirements")
    risk_counts = count_by_project("bid_risks")
    section_counts = count_by_project("bid_sections")
    chunk_counts = count_by_project("document_chunks")

    file_rows = (
        client.table("bid_files")
        .select("id,project_id,parse_status,created_at,file_name")
        .in_("project_id", project_ids)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    files_by_project: dict[str, list[dict[str, Any]]] = {}
    for row in file_rows:
        project_id = row.get("project_id")
        if project_id:
            files_by_project.setdefault(project_id, []).append(row)

    history = []
    for project in projects:
        project_id = project["id"]
        has_analysis = analysis_counts.get(project_id, 0) > 0
        section_count = section_counts.get(project_id, 0)
        files = files_by_project.get(project_id, [])
        latest_file = files[0] if files else {}
        parse_status = latest_file.get("parse_status")
        if section_count > 0:
            stage = "标书编制"
            action = "继续编制"
        elif has_analysis:
            stage = "解读完成"
            action = "查看解读"
        elif chunk_counts.get(project_id, 0) > 0 or parse_status in {"indexed", "mineru_done"}:
            stage = "解析完成"
            action = "查看解读"
        elif parse_status in {"pending", "mineru_submitted", "mineru_running", "mineru_split_submitted", "mineru_split_running", "mineru_downloading", "syncing_supabase", "supabase_synced"}:
            stage = "解析中"
            action = "查看状态"
        elif parse_status in {"mineru_failed", "index_failed", "ocr_required", "mineru_download_failed"}:
            stage = "解析失败"
            action = "查看"
        else:
            stage = project.get("status") or "已上传"
            action = "查看"

        history.append({
            **project,
            "stage": stage,
            "action": action,
            "analysis_count": analysis_counts.get(project_id, 0),
            "requirement_count": requirement_counts.get(project_id, 0),
            "risk_count": risk_counts.get(project_id, 0),
            "section_count": section_count,
            "chunk_count": chunk_counts.get(project_id, 0),
            "file_count": len(files),
            "parse_status": parse_status,
            "latest_file_id": latest_file.get("id"),
            "latest_file_name": latest_file.get("file_name"),
        })

    return history


def get_project_interpretation(project_id: str) -> dict[str, Any]:
    client = get_supabase_client()

    project_response = client.table("bid_projects").select("*").eq("id", project_id).limit(1).execute()
    project = project_response.data[0] if project_response.data else None

    analysis_response = client.table("bid_analysis").select("*").eq("project_id", project_id).limit(1).execute()
    analysis = analysis_response.data[0] if analysis_response.data else None

    def select_many(table: str, order_column: str = "created_at", limit: int = 200) -> list[dict[str, Any]]:
        return (
            client.table(table)
            .select("*")
            .eq("project_id", project_id)
            .order(order_column)
            .limit(limit)
            .execute()
            .data
            or []
        )

    try:
        sections = list_bid_sections(project_id)
    except Exception as exc:
        logging.warning("bid_sections 查询失败，可能尚未执行建表 SQL: %s", exc)
        sections = []

    return {
        "project": project,
        "analysis": analysis,
        "requirements": select_many("bid_requirements"),
        "risks": select_many("bid_risks"),
        "scoringItems": select_many("bid_scoring_items"),
        "chapterSuggestions": select_many("bid_chapter_suggestions"),
        "documentChunks": select_many("document_chunks", "chunk_index", 80),
        "sections": sections,
    }

def list_knowledge_documents() -> list[dict[str, Any]]:
    client = get_supabase_client()
    response = client.table("knowledge_documents").select("*").order("created_at", desc=True).execute()
    return response.data or []


def get_knowledge_document_detail(document_id: str) -> dict[str, Any] | None:
    client = get_supabase_client()
    document_response = (
        client.table("knowledge_documents")
        .select("*")
        .eq("id", document_id)
        .limit(1)
        .execute()
    )
    documents = document_response.data or []
    if not documents:
        return None

    chunks_response = (
        client.table("document_chunks")
        .select("id,chunk_index,content,metadata")
        .eq("document_id", document_id)
        .order("chunk_index")
        .limit(20)
        .execute()
    )

    return {
        "document": documents[0],
        "chunks": chunks_response.data or [],
    }


def list_knowledge_assets(asset_type: str | None = None, category: str | None = None) -> list[dict[str, Any]]:
    client = get_supabase_client()
    query = (
        client.table("knowledge_assets")
        .select("*")
        .order("created_at", desc=True)
    )
    if asset_type:
        query = query.eq("asset_type", asset_type)
    if category:
        query = query.eq("category", category)
    response = query.execute()
    return response.data or []


def get_knowledge_asset_detail(asset_id: str) -> dict[str, Any] | None:
    client = get_supabase_client()
    response = (
        client.table("knowledge_assets")
        .select("*")
        .eq("id", asset_id)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return rows[0] if rows else None


def download_knowledge_asset_file(asset_id: str) -> tuple[dict[str, Any], bytes] | None:
    return download_knowledge_asset_file_variant(asset_id, variant="original")


def download_knowledge_asset_file_variant(asset_id: str, variant: str = "original") -> tuple[dict[str, Any], bytes] | None:
    asset = get_knowledge_asset_detail(asset_id)
    if not asset:
        return None

    bucket = asset.get("storage_bucket")
    object_path = asset.get("storage_path")
    mime_type = asset.get("mime_type")
    file_name = asset.get("file_name")
    metadata = asset.get("metadata") or {}
    if variant == "thumb" and isinstance(metadata, dict) and metadata.get("thumbnail_storage_path"):
        bucket = metadata.get("thumbnail_storage_bucket") or bucket
        object_path = metadata.get("thumbnail_storage_path")
        mime_type = metadata.get("thumbnail_mime_type") or "image/webp"
        stem = Path(file_name or asset.get("title") or asset_id).stem
        file_name = f"{stem}-thumbnail.webp"

    if not bucket or not object_path:
        return None

    client = get_supabase_client()
    content = client.storage.from_(bucket).download(object_path)
    if isinstance(content, bytes):
        data = content
    elif hasattr(content, "content"):
        data = content.content
    else:
        data = bytes(content)
    asset = {**asset, "mime_type": mime_type, "file_name": file_name}
    return asset, data


def _knowledge_asset_bucket() -> str:
    return os.getenv("SUPABASE_STORAGE_KNOWLEDGE_ASSET_BUCKET") or os.getenv("SUPABASE_STORAGE_KNOWLEDGE_BUCKET") or "knowledge-assets"


def _create_image_thumbnail(local_path: Path, max_size: int = 960) -> tuple[Path, str] | None:
    try:
        from PIL import Image, ImageOps
    except Exception:
        logging.exception("Pillow 不可用，跳过知识资产缩略图生成")
        return None

    try:
        with Image.open(local_path) as image:
            image = ImageOps.exif_transpose(image)
            image.thumbnail((max_size, max_size))
            if image.mode not in {"RGB", "RGBA"}:
                image = image.convert("RGB")
            thumb_path = local_path.with_name(f"{local_path.stem}-thumb.webp")
            image.save(thumb_path, "WEBP", quality=78, method=6)
        return thumb_path, "image/webp"
    except Exception:
        logging.exception("知识资产缩略图生成失败: %s", local_path)
        return None


def upload_knowledge_asset_file(
    *,
    local_file_path: str | Path,
    original_filename: str,
    library_type: str,
) -> dict[str, Any]:
    client = get_supabase_client()
    local_path = Path(local_file_path)
    bucket = _knowledge_asset_bucket()
    safe_suffix = _storage_extension(original_filename, local_path)
    object_path = f"{library_type}/{uuid.uuid4().hex}{safe_suffix}"
    content_type = mimetypes.guess_type(original_filename)[0] or "application/octet-stream"

    upload_file_to_storage(bucket, object_path, local_path, content_type)
    public_url = client.storage.from_(bucket).get_public_url(object_path)
    thumbnail_info: dict[str, Any] = {}

    if content_type.startswith("image/"):
        thumbnail = _create_image_thumbnail(local_path)
        if thumbnail:
            thumb_path, thumb_mime_type = thumbnail
            thumb_object_path = f"{library_type}/thumbnails/{uuid.uuid4().hex}.webp"
            try:
                upload_file_to_storage(bucket, thumb_object_path, thumb_path, thumb_mime_type)
                thumbnail_info = {
                    "thumbnail_bucket": bucket,
                    "thumbnail_path": thumb_object_path,
                    "thumbnail_mime_type": thumb_mime_type,
                    "thumbnail_size": thumb_path.stat().st_size,
                }
            except Exception:
                logging.exception("知识资产缩略图上传失败，已降级为仅保存原图: %s", original_filename)
            finally:
                try:
                    thumb_path.unlink()
                except OSError:
                    pass

    return {
        "bucket": bucket,
        "object_path": object_path,
        "public_url": public_url,
        "file_ext": safe_suffix.lstrip(".") or None,
        "mime_type": content_type,
        "file_size": local_path.stat().st_size,
        **thumbnail_info,
    }


def create_knowledge_asset(payload: dict[str, Any]) -> dict[str, Any]:
    client = get_supabase_client()
    response = client.table("knowledge_assets").insert(payload).execute()
    if not response.data:
        raise RuntimeError("Supabase knowledge_assets insert returned no data")
    return response.data[0]
