import hashlib
import mimetypes
import uuid
from pathlib import Path
from typing import Any

from supabase_client import get_bucket_name, get_supabase_client, upload_file_to_storage


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

    return {
        "project": project,
        "analysis": analysis,
        "requirements": select_many("bid_requirements"),
        "risks": select_many("bid_risks"),
        "scoringItems": select_many("bid_scoring_items"),
        "chapterSuggestions": select_many("bid_chapter_suggestions"),
        "documentChunks": select_many("document_chunks", "chunk_index", 80),
    }
