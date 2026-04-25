import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from bid_interpreter import ingest_mineru_artifacts_to_supabase
from db_supabase import update_bid_file_parse_status
from file_to_chroma import EmptyDocumentContentError, file_to_chroma
from mineru_client import (
    MinerUDownloadError,
    MinerUConfigError,
    create_local_file_batch_task,
    download_and_extract_zip,
    extract_zip_artifacts,
    get_batch_result,
    has_mineru_token,
    wait_for_batch_file_result,
)

PARSED_OUTPUT_ROOT = Path("parsed_outputs")


def _status_file(file_id: str) -> Path:
    return PARSED_OUTPUT_ROOT / file_id / "mineru_status.json"


def write_parse_status(file_id: str, payload: dict[str, Any]) -> None:
    status_path = _status_file(file_id)
    status_path.parent.mkdir(parents=True, exist_ok=True)
    existing: dict[str, Any] = {}
    if status_path.exists():
        try:
            existing = json.loads(status_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing = {}
    existing.update(payload)
    existing["updated_at"] = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    status_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")


def read_parse_status(file_id: str) -> dict[str, Any] | None:
    status_path = _status_file(file_id)
    if not status_path.exists():
        return None
    return json.loads(status_path.read_text(encoding="utf-8"))


def _update_supabase_status(file_id: str | None, parse_status: str) -> None:
    if not file_id:
        return
    try:
        update_bid_file_parse_status(file_id, parse_status)
    except Exception:
        logging.exception("更新 Supabase parse_status=%s 失败: %s", parse_status, file_id)


def _vectorize_markdown(markdown_path: str | None, parse_id: str, supabase_file_id: str | None) -> None:
    if not markdown_path:
        raise RuntimeError("MinerU result does not include full.md")
    file_to_chroma(markdown_path)
    _update_supabase_status(supabase_file_id, "indexed")
    write_parse_status(parse_id, {"parse_status": "indexed", "indexed_source": markdown_path})


def ingest_artifacts(parse_id: str, artifacts: dict[str, Any]) -> None:
    status = read_parse_status(parse_id) or {}
    project_id = status.get("project_id")
    bid_file_id = status.get("supabase_file_id")
    if not project_id:
        write_parse_status(parse_id, {
            "supabase_ingest_status": "skipped",
            "supabase_ingest_reason": "project_id is missing",
        })
        return

    write_parse_status(parse_id, {"supabase_ingest_status": "running"})
    try:
        result = ingest_mineru_artifacts_to_supabase(
            parse_id=parse_id,
            project_id=project_id,
            bid_file_id=bid_file_id,
            artifacts=artifacts,
        )
        write_parse_status(parse_id, {
            "supabase_ingest_status": "done",
            "supabase_ingest_result": result,
        })
    except Exception as e:
        logging.exception("MinerU 解析产物写入 Supabase 失败: %s", parse_id)
        write_parse_status(parse_id, {
            "supabase_ingest_status": "failed",
            "supabase_ingest_error": str(e),
        })


def _extract_done_result(batch_data: dict[str, Any], parse_id: str) -> dict[str, Any] | None:
    extract_result = batch_data.get("extract_result") or []
    if isinstance(extract_result, dict):
        extract_result = [extract_result]
    for item in extract_result:
        if not isinstance(item, dict):
            continue
        if item.get("data_id") == parse_id or len(extract_result) == 1:
            return item
    return None


def _should_use_mineru_first(file_path: str) -> bool:
    if Path(file_path).suffix.lower() != ".pdf":
        return False
    return os.getenv("MINERU_PARSE_PDF_FIRST", "true").lower() not in {"false", "0", "no"}


def _run_mineru_parse_and_index(
    *,
    file_path: str,
    original_filename: str,
    parse_id: str,
    supabase_file_id: str | None,
) -> None:
    output_dir = PARSED_OUTPUT_ROOT / parse_id
    _update_supabase_status(supabase_file_id, "mineru_submitted")
    task = create_local_file_batch_task(
        local_file_path=file_path,
        file_name=original_filename,
        data_id=parse_id,
    )
    write_parse_status(
        parse_id,
        {
            "parse_status": "mineru_submitted",
            "parser": "mineru",
            "batch_id": task.batch_id,
            "data_id": task.data_id,
            "file_name": task.file_name,
            "supabase_file_id": supabase_file_id,
        },
    )

    def on_progress(result: dict[str, Any]) -> None:
        state = result.get("state") or "mineru_running"
        status = "mineru_running" if state in {"waiting-file", "pending", "running", "converting"} else state
        _update_supabase_status(supabase_file_id, status)
        write_parse_status(
            parse_id,
            {
                "parse_status": status,
                "mineru_state": state,
                "extract_progress": result.get("extract_progress"),
                "err_msg": result.get("err_msg"),
            },
        )

    result = wait_for_batch_file_result(batch_id=task.batch_id, data_id=parse_id, on_progress=on_progress)
    full_zip_url = result.get("full_zip_url")
    if not full_zip_url:
        raise RuntimeError(f"MinerU finished without full_zip_url: {result}")

    _update_supabase_status(supabase_file_id, "mineru_done")
    write_parse_status(
        parse_id,
        {
            "parse_status": "mineru_downloading",
            "mineru_state": "done",
            "full_zip_url": full_zip_url,
        },
    )
    artifacts = download_and_extract_zip(full_zip_url, output_dir)
    write_parse_status(parse_id, {"parse_status": "mineru_done", "artifacts": artifacts})
    ingest_artifacts(parse_id, artifacts)
    _vectorize_markdown(artifacts.get("markdown_path"), parse_id, supabase_file_id)


def retry_mineru_result_download(parse_id: str) -> None:
    status = read_parse_status(parse_id) or {}
    supabase_file_id = status.get("supabase_file_id")
    full_zip_url = status.get("full_zip_url")
    batch_id = status.get("batch_id")
    retry_count = int(status.get("download_retry_count") or 0) + 1

    try:
        write_parse_status(
            parse_id,
            {
                "parse_status": "mineru_download_retrying",
                "download_retry_count": retry_count,
                "download_retry_started_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            },
        )
        if not full_zip_url and batch_id:
            batch_data = get_batch_result(batch_id)
            result = _extract_done_result(batch_data, parse_id)
            if not result or result.get("state") != "done":
                raise RuntimeError(f"MinerU batch result is not done yet: {result}")
            full_zip_url = result.get("full_zip_url")
            if not full_zip_url:
                raise RuntimeError(f"MinerU done result has no full_zip_url: {result}")
            write_parse_status(parse_id, {"full_zip_url": full_zip_url, "mineru_state": "done"})
        if not full_zip_url:
            raise RuntimeError("No full_zip_url or batch_id found for MinerU retry")

        artifacts = download_and_extract_zip(full_zip_url, PARSED_OUTPUT_ROOT / parse_id)
        write_parse_status(parse_id, {"parse_status": "mineru_done", "artifacts": artifacts})
        ingest_artifacts(parse_id, artifacts)
        _vectorize_markdown(artifacts.get("markdown_path"), parse_id, supabase_file_id)
    except Exception as e:
        logging.exception("MinerU 结果下载重试失败: %s", parse_id)
        _update_supabase_status(supabase_file_id, "mineru_download_failed")
        write_parse_status(parse_id, {"parse_status": "mineru_download_failed", "error": str(e), "download_retry_count": retry_count})


def import_mineru_result_zip(parse_id: str, zip_file_path: str | Path) -> dict[str, str | None]:
    status = read_parse_status(parse_id) or {}
    supabase_file_id = status.get("supabase_file_id")
    output_dir = PARSED_OUTPUT_ROOT / parse_id
    write_parse_status(parse_id, {"parse_status": "mineru_importing_zip"})
    artifacts = extract_zip_artifacts(zip_file_path, output_dir)
    write_parse_status(parse_id, {"parse_status": "mineru_done", "artifacts": artifacts})
    ingest_artifacts(parse_id, artifacts)
    _vectorize_markdown(artifacts.get("markdown_path"), parse_id, supabase_file_id)
    return artifacts


def parse_and_index_tender_file(
    *,
    file_path: str,
    original_filename: str,
    parse_id: str,
    supabase_file_id: str | None = None,
) -> None:
    """Use MinerU first for PDFs when configured, otherwise index native text."""
    if has_mineru_token() and _should_use_mineru_first(file_path):
        try:
            _run_mineru_parse_and_index(
                file_path=file_path,
                original_filename=original_filename,
                parse_id=parse_id,
                supabase_file_id=supabase_file_id,
            )
            return
        except MinerUDownloadError as e:
            logging.exception("MinerU 结果 zip 下载失败，保留解析任务等待重试: %s", file_path)
            _update_supabase_status(supabase_file_id, "mineru_download_failed")
            write_parse_status(
                parse_id,
                {
                    "parse_status": "mineru_download_failed",
                    "parser": "mineru",
                    "error": str(e),
                    "retryable": True,
                },
            )
            return
        except Exception as e:
            logging.exception("MinerU 优先解析失败，回退原生文本抽取: %s", file_path)
            _update_supabase_status(supabase_file_id, "mineru_failed")
            write_parse_status(
                parse_id,
                {
                    "parse_status": "mineru_failed",
                    "parser": "mineru",
                    "error": str(e),
                    "fallback": "native_text",
                },
            )

    try:
        file_to_chroma(file_path)
        _update_supabase_status(supabase_file_id, "indexed")
        write_parse_status(
            parse_id,
            {
                "parse_status": "indexed",
                "parser": "native_text",
                "source_file": file_path,
                "file_name": original_filename,
                "supabase_file_id": supabase_file_id,
            },
        )
        return
    except EmptyDocumentContentError as e:
        logging.warning("文件需要 OCR/MinerU 解析: %s, reason=%s", file_path, e)
        _update_supabase_status(supabase_file_id, "ocr_required")
        write_parse_status(
            parse_id,
            {
                "parse_status": "ocr_required",
                "parser": "mineru",
                "source_file": file_path,
                "file_name": original_filename,
                "reason": str(e),
                "supabase_file_id": supabase_file_id,
            },
        )
    except Exception:
        logging.exception("原始文件向量化处理失败: %s", file_path)
        _update_supabase_status(supabase_file_id, "index_failed")
        write_parse_status(
            parse_id,
            {
                "parse_status": "index_failed",
                "parser": "native_text",
                "source_file": file_path,
                "file_name": original_filename,
                "supabase_file_id": supabase_file_id,
            },
        )
        return

    if not has_mineru_token():
        write_parse_status(
            parse_id,
            {
                "parse_status": "ocr_required",
                "parser": "mineru",
                "error": "MINERU_API_TOKEN is not configured",
                "supabase_file_id": supabase_file_id,
            },
        )
        return

    try:
        _run_mineru_parse_and_index(
            file_path=file_path,
            original_filename=original_filename,
            parse_id=parse_id,
            supabase_file_id=supabase_file_id,
        )
    except MinerUConfigError as e:
        _update_supabase_status(supabase_file_id, "ocr_required")
        write_parse_status(parse_id, {"parse_status": "ocr_required", "error": str(e), "supabase_file_id": supabase_file_id})
    except MinerUDownloadError as e:
        logging.exception("MinerU 结果 zip 下载失败，等待重试: %s", file_path)
        _update_supabase_status(supabase_file_id, "mineru_download_failed")
        write_parse_status(parse_id, {"parse_status": "mineru_download_failed", "error": str(e), "supabase_file_id": supabase_file_id, "retryable": True})
    except Exception as e:
        logging.exception("MinerU 解析或解析结果向量化失败: %s", file_path)
        _update_supabase_status(supabase_file_id, "mineru_failed")
        write_parse_status(parse_id, {"parse_status": "mineru_failed", "error": str(e), "supabase_file_id": supabase_file_id})
