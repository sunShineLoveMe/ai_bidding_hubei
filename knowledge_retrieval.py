import os
import json
from typing import Any, Iterator, List, Dict
from openai import OpenAI

from supabase_client import get_supabase_client
from file_to_chroma import init_ali_client, get_embeddings
from qwen_client import stream_dashscope_api
from app_config import get_setting
from rerank_client import rerank_documents

def search_knowledge_base(query: str, match_threshold: float = 0.5, match_count: int = 5) -> List[Dict[str, Any]]:
    """
    通过 Supabase RPC 检索图文混排的知识库内容
    """
    ali_client = init_ali_client()
    client = get_supabase_client()
    
    # 1. 向量化查询
    query_embeddings = get_embeddings(ali_client, [query])
    if not query_embeddings:
        return []
    query_vector = query_embeddings[0]
    
    # 2. 调用 Supabase RPC
    response = client.rpc(
        "match_knowledge_chunks",
        {
            "query_embedding": query_vector,
            "match_threshold": match_threshold,
            "match_count": max(match_count * 3, match_count)
        }
    ).execute()
    
    rows = response.data or []
    return rerank_documents(query, rows, text_key="content", top_n=match_count)


def search_knowledge_assets(query: str, match_count: int = 8) -> List[Dict[str, Any]]:
    """
    检索企业知识库中的图片/资质资产。
    图片本身不直接参与语义检索，检索的是 OCR、AI 描述、规格参数和适用章节组成的 searchable_text。
    """
    ali_client = init_ali_client()
    client = get_supabase_client()

    query_embeddings = get_embeddings(ali_client, [query])
    if not query_embeddings:
        return []

    response = client.rpc(
        "match_knowledge_assets",
        {
            "query_embedding": query_embeddings[0],
            "match_count": max(match_count * 3, match_count),
            "filter_category": None,
            "filter_asset_type": None,
        },
    ).execute()

    assets = rerank_documents(query, response.data or [], text_key="searchable_text", top_n=match_count)
    # 过滤掉明显弱相关的资产，保留图片来源展示的准确性。
    return [asset for asset in assets if float(asset.get("similarity") or 0) >= 0.28]

def generate_knowledge_answer(
    query: str,
    contexts: List[Dict[str, Any]],
    assets: List[Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    """
    组装包含图片链接的 Prompt，让大模型基于知识库生成最终回答
    """
    ali_client = init_ali_client()
    
    prompt, images = build_knowledge_prompt(query, contexts, assets)

    response = ali_client.chat.completions.create(
        model=get_setting("knowledge_model", "qwen-long"),
        messages=[
            {"role": "system", "content": "你是一个严谨的 RAG 知识库问答助手。"},
            {"role": "user", "content": prompt}
        ],
        temperature=0.1
    )
    
    answer = response.choices[0].message.content
    
    return {
        "answer": answer,
        "images": images,
        "assets": assets or [],
        "raw_contexts": contexts
    }


def build_knowledge_prompt(
    query: str,
    contexts: List[Dict[str, Any]],
    assets: List[Dict[str, Any]] | None = None,
) -> tuple[str, list[dict[str, str]]]:
    text_contexts = []
    images = []

    for index, ctx in enumerate(contexts, 1):
        content = ctx.get("content", "")
        meta = ctx.get("metadata", {}) or {}
        similarity = ctx.get("similarity", 0)
        source = meta.get("source_org") or meta.get("source_file") or "企业知识库"
        doc_type = meta.get("doc_type") or "知识片段"

        text_contexts.append(
            f"【资料{index}｜相关度 {similarity:.2f}｜来源 {source}｜类型 {doc_type}】\n{content}"
        )

        if meta.get("type") == "image" and meta.get("image_url"):
            images.append({
                "url": meta.get("image_url"),
                "alt": meta.get("alt", "未命名图片")
            })

    asset_contexts = []
    for index, asset in enumerate(assets or [], 1):
        title = asset.get("title") or "未命名图片"
        category = asset.get("category") or "图片资产"
        asset_type = asset.get("asset_type") or "image"
        similarity = float(asset.get("similarity") or 0)
        searchable_text = asset.get("searchable_text") or asset.get("description") or ""
        sections = "、".join(asset.get("applicable_sections") or [])
        public_url = asset.get("public_url") or ""
        asset_contexts.append(
            f"【图片资产{index}｜相关度 {similarity:.2f}｜分类 {category}｜类型 {asset_type}】\n"
            f"名称：{title}\n适用章节：{sections}\n图片地址：{public_url}\n说明：{searchable_text}"
        )
        if asset.get("public_url"):
            images.append({
                "url": asset["public_url"],
                "alt": title,
            })

    context_str = "\n\n---\n\n".join(text_contexts)
    asset_context_str = "\n\n---\n\n".join(asset_contexts) or "无相关图片资产。"
    prompt = f"""你是一个专业的水利招投标 RAG 知识库问答助手。
请只依据下方企业知识库检索片段回答用户问题，不要编造未出现在资料中的证书编号、人员姓名、合同金额或具体日期。

【知识库检索片段】：
{context_str}

【相关图片/资质资产】：
{asset_context_str}

【用户问题】：
{query}

回答要求：
1. 先给出结论，再按要点展开。
2. 如果资料不足，请明确说明哪些信息需要继续补充。
3. 涉及投标材料、废标风险、施工组织设计等内容时，尽量给出可执行清单。
4. 如果相关图片/资质资产适合插入标书正文，请直接在对应说明段落后使用 Markdown 图片语法插入，不要在结尾集中罗列图片。格式必须是：![图片名称](图片地址)
5. 最多插入 3 张最相关图片。资质证书、营业执照、安全生产许可证类图片只能作为“脱敏示意图/排版占位图”，必须明确说明不能替代正式法定资质文件。
6. 不要输出 Markdown 表格，图片建议用自然段和项目符号描述，避免表格在聊天窗口中换行错乱。
7. 结尾列出“参考依据”，用“资料1、资料2...”说明依据来自哪些检索片段；图片资产只作为配图建议，不要把它当成法规依据。
8. 语言专业、客观、准确，适合非技术标书人员阅读。
"""
    return prompt, images


def stream_knowledge_answer(
    query: str,
    contexts: List[Dict[str, Any]],
    assets: List[Dict[str, Any]] | None = None,
) -> Iterator[Dict[str, Any]]:
    prompt, images = build_knowledge_prompt(query, contexts, assets)
    yield {
        "type": "retrieved",
        "contexts_count": len(contexts),
        "assets_count": len(assets or []),
        "images": images,
        "raw_contexts": contexts,
        "assets": assets or [],
    }

    emitted = False
    try:
        for chunk in stream_dashscope_api(
            [
                {"role": "system", "content": "你是一个严谨的 RAG 知识库问答助手。"},
                {"role": "user", "content": prompt},
            ],
            model=get_setting("knowledge_model", "qwen-long"),
        ):
            emitted = True
            yield {
                "type": "chunk",
                "content": chunk,
            }
    except Exception:
        result = generate_knowledge_answer(query, contexts)
        content = result.get("answer") or ""
        for start in range(0, len(content), 120):
            emitted = True
            yield {
                "type": "chunk",
                "content": content[start:start + 120],
            }

    if not emitted:
        yield {
            "type": "chunk",
            "content": "未能生成回答，请稍后重试或补充更多知识库资料。",
        }

    yield {
        "type": "done",
    }
