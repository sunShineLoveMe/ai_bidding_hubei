from flask import Blueprint, request, jsonify, current_app
import os
import sqlite3
import requests
from datetime import datetime
from unidecode import unidecode
from werkzeug.utils import secure_filename
import logging
import json
from backend.core.config import build_enterprise_context, get_setting
from backend.db.supabase_repo import record_ai_usage_log
import time

# 通义千问API配置
DASHSCOPE_API_KEY = os.getenv('DASHSCOPE_API_KEY')
AI_PROVIDER = os.getenv('AI_PROVIDER', 'dashscope')


def _messages_text(messages) -> str:
    return "\n".join(str(message.get("content") or "") for message in (messages or []) if isinstance(message, dict))


def _response_content(payload: dict) -> str:
    try:
        return payload.get("output", {}).get("choices", [{}])[0].get("message", {}).get("content") or ""
    except Exception:
        return ""


def call_dashscope_api(messages, model=None, json_mode=True, usage_context=None):
    if not DASHSCOPE_API_KEY:
        raise Exception("DASHSCOPE_API_KEY is not set")
    url = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation'
    resolved_model = model or get_setting("text_model", "qwen-turbo-latest")
    context = usage_context or {}
    started_at = time.time()
    headers = {
        'Authorization': f'Bearer {DASHSCOPE_API_KEY}',
        'Content-Type': 'application/json'
    }

    data = {
        'model': resolved_model,
        'input': {
            'messages': messages
        }
    }
    if json_mode:
        data['parameters'] = {'result_format': 'json_object'}
    else:
        data['parameters'] = {'result_format': 'message'}
    
    response = None
    try:
        response = requests.post(
            url,
            headers=headers,
            json=data,
            timeout=int(get_setting("request_timeout_seconds", 120)),
        )
        if response.status_code != 200:
            error_message = f"Dashscope API Error: Status Code: {response.status_code}, Response Body: {response.text}"
            logging.error(error_message)
            print(error_message)
        response.raise_for_status()
        payload = response.json()
        record_ai_usage_log(
            provider="dashscope",
            region="cn-beijing",
            api_protocol="dashscope",
            endpoint=url,
            model=payload.get("model") or resolved_model,
            operation_type=context.get("operation_type") or "text_generation",
            stage=context.get("stage") or ("json_generation" if json_mode else "text_generation"),
            project_id=context.get("project_id"),
            file_id=context.get("file_id"),
            section_id=context.get("section_id"),
            batch_id=context.get("batch_id"),
            request_id=payload.get("request_id"),
            status_code=response.status_code,
            latency_ms=int((time.time() - started_at) * 1000),
            raw_usage=payload.get("usage") or {},
            input_text=_messages_text(messages),
            output_text=_response_content(payload),
            metadata={"json_mode": json_mode, **(context.get("metadata") or {})},
        )
        return payload
    except Exception as exc:
        record_ai_usage_log(
            provider="dashscope",
            region="cn-beijing",
            api_protocol="dashscope",
            endpoint=url,
            model=resolved_model,
            operation_type=context.get("operation_type") or "text_generation",
            stage=context.get("stage") or ("json_generation" if json_mode else "text_generation"),
            project_id=context.get("project_id"),
            file_id=context.get("file_id"),
            section_id=context.get("section_id"),
            batch_id=context.get("batch_id"),
            status_code=response.status_code if response is not None else None,
            latency_ms=int((time.time() - started_at) * 1000),
            raw_usage={},
            input_text=_messages_text(messages),
            success=False,
            error_message=str(exc),
            metadata={"json_mode": json_mode, **(context.get("metadata") or {})},
        )
        raise


def stream_dashscope_api(messages, model=None, usage_context=None):
    """Stream DashScope text generation chunks.

    DashScope's SSE response usually emits lines prefixed with "data:".
    The parser is intentionally tolerant so local deployments can fall back
    cleanly if the provider response shape changes.
    """
    if not DASHSCOPE_API_KEY:
        raise Exception("DASHSCOPE_API_KEY is not set")

    url = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation'
    resolved_model = model or get_setting("text_model", "qwen-turbo-latest")
    context = usage_context or {}
    started_at = time.time()
    headers = {
        'Authorization': f'Bearer {DASHSCOPE_API_KEY}',
        'Content-Type': 'application/json',
        'X-DashScope-SSE': 'enable',
    }
    data = {
        'model': resolved_model,
        'input': {
            'messages': messages
        },
        'parameters': {
            'result_format': 'message',
            'incremental_output': True,
        },
    }

    timeout = (
        int(get_setting("stream_connect_timeout_seconds", 15)),
        int(get_setting("stream_read_timeout_seconds", 180)),
    )

    response = None
    output_parts = []
    last_usage = {}
    last_request_id = None
    try:
        with requests.post(url, headers=headers, json=data, stream=True, timeout=timeout) as response:
            if response.status_code != 200:
                error_message = f"Dashscope Stream API Error: Status Code: {response.status_code}, Response Body: {response.text}"
                logging.error(error_message)
            response.raise_for_status()
            for raw_line in response.iter_lines(decode_unicode=True):
                if not raw_line:
                    continue
                line = raw_line.strip()
                if line.startswith("data:"):
                    line = line[5:].strip()
                if not line or line == "[DONE]":
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if payload.get("usage"):
                    last_usage = payload.get("usage") or {}
                last_request_id = payload.get("request_id") or last_request_id
                message = (
                    payload.get("output", {})
                    .get("choices", [{}])[0]
                    .get("message", {})
                )
                content = message.get("content")
                if content:
                    output_parts.append(content)
                    yield content
        record_ai_usage_log(
            provider="dashscope",
            region="cn-beijing",
            api_protocol="dashscope",
            endpoint=url,
            model=resolved_model,
            operation_type=context.get("operation_type") or "text_generation",
            stage=context.get("stage") or "stream_text_generation",
            project_id=context.get("project_id"),
            file_id=context.get("file_id"),
            section_id=context.get("section_id"),
            batch_id=context.get("batch_id"),
            request_id=last_request_id,
            is_stream=True,
            include_usage=bool(last_usage),
            status_code=response.status_code if response is not None else None,
            latency_ms=int((time.time() - started_at) * 1000),
            raw_usage=last_usage,
            input_text=_messages_text(messages),
            output_text="".join(output_parts),
            metadata=context.get("metadata") or {},
        )
    except Exception as exc:
        record_ai_usage_log(
            provider="dashscope",
            region="cn-beijing",
            api_protocol="dashscope",
            endpoint=url,
            model=resolved_model,
            operation_type=context.get("operation_type") or "text_generation",
            stage=context.get("stage") or "stream_text_generation",
            project_id=context.get("project_id"),
            file_id=context.get("file_id"),
            section_id=context.get("section_id"),
            batch_id=context.get("batch_id"),
            is_stream=True,
            include_usage=bool(last_usage),
            status_code=response.status_code if response is not None else None,
            latency_ms=int((time.time() - started_at) * 1000),
            raw_usage=last_usage,
            input_text=_messages_text(messages),
            output_text="".join(output_parts),
            success=False,
            error_message=str(exc),
            metadata=context.get("metadata") or {},
        )
        raise

def generate_bid_section(section_title, section_content, tender_content):
    """按小节生成投标文件内容"""
    enterprise_context = build_enterprise_context()
    prompt = f'''
    你是专业投标书撰写专家，熟悉水利工程、设备配套、质量管理和供应链项目投标要求。
    企业画像：
    {enterprise_context}
    请结合企业能力、质量管理、内网资料库和招标文件要求，直接输出专业、严谨、可落地的正文内容。
    请根据以下小节标题、小节描述并参考招标书相关内容，生成投标书某一小节的完整内容。如果小节需要表格描述，请用Markdown格式生成表格。
    需要填写的表格内容请参考招标书原文中进行填写。
    仅输出小节正文内容，禁止包含任何自然语言解释或额外文。字数要求1000-1500字。
    小节标题: {section_title}
    小节描述: {section_content}
    招标书相关内容: {tender_content}
'''
    response = call_dashscope_api([
                {'role': 'user','content': prompt}
            ], json_mode=False)
    content = response['output']['choices'][0]['message']['content']
    return content
