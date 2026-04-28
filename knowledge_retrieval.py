import os
import json
from typing import Any, Iterator, List, Dict
from openai import OpenAI

from supabase_client import get_supabase_client
from file_to_chroma import init_ali_client, get_embeddings
from qwen_client import stream_dashscope_api

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
            "match_count": match_count
        }
    ).execute()
    
    return response.data or []

def generate_knowledge_answer(query: str, contexts: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    组装包含图片链接的 Prompt，让大模型基于知识库生成最终回答
    """
    ali_client = init_ali_client()
    
    prompt, images = build_knowledge_prompt(query, contexts)

    response = ali_client.chat.completions.create(
        model="qwen-long", # 阿里云适合做长文本RAG的模型
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
        "raw_contexts": contexts
    }


def build_knowledge_prompt(query: str, contexts: List[Dict[str, Any]]) -> tuple[str, list[dict[str, str]]]:
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

    context_str = "\n\n---\n\n".join(text_contexts)
    prompt = f"""你是一个专业的水利招投标 RAG 知识库问答助手。
请只依据下方企业知识库检索片段回答用户问题，不要编造未出现在资料中的证书编号、人员姓名、合同金额或具体日期。

【知识库检索片段】：
{context_str}

【用户问题】：
{query}

回答要求：
1. 先给出结论，再按要点展开。
2. 如果资料不足，请明确说明哪些信息需要继续补充。
3. 涉及投标材料、废标风险、施工组织设计等内容时，尽量给出可执行清单。
4. 结尾列出“参考依据”，用“资料1、资料2...”说明依据来自哪些检索片段。
5. 语言专业、客观、准确，适合非技术标书人员阅读。
"""
    return prompt, images


def stream_knowledge_answer(query: str, contexts: List[Dict[str, Any]]) -> Iterator[Dict[str, Any]]:
    prompt, images = build_knowledge_prompt(query, contexts)
    yield {
        "type": "retrieved",
        "contexts_count": len(contexts),
        "images": images,
        "raw_contexts": contexts,
    }

    emitted = False
    try:
        for chunk in stream_dashscope_api(
            [
                {"role": "system", "content": "你是一个严谨的 RAG 知识库问答助手。"},
                {"role": "user", "content": prompt},
            ],
            model=os.getenv("DASHSCOPE_KNOWLEDGE_MODEL", "qwen-long"),
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
