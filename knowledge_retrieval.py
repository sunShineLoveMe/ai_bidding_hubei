import os
import json
from typing import Any, List, Dict
from openai import OpenAI

from supabase_client import get_supabase_client
from file_to_chroma import init_ali_client, get_embeddings

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
    
    # 提取纯文本上下文和包含的图片
    text_contexts = []
    images = []
    
    for ctx in contexts:
        content = ctx.get("content", "")
        meta = ctx.get("metadata", {})
        similarity = ctx.get("similarity", 0)
        
        # 将所有的内容拼接进 Prompt，让大模型能看到图文的关联
        text_contexts.append(f"【相关度 {similarity:.2f}】\n{content}")
        
        # 收集图片用于前端独立展示
        if meta.get("type") == "image" and meta.get("image_url"):
            images.append({
                "url": meta.get("image_url"),
                "alt": meta.get("alt", "未命名图片")
            })
            
    context_str = "\n\n---\n\n".join(text_contexts)
    
    prompt = f"""你是一个专业的企业招投标与知识库 AI 助手。
请仔细阅读以下从企业知识库中检索到的上下文片段（可能包含关于图片的描述信息）。

【上下文资料】：
{context_str}

【用户问题】：
{query}

请根据上面的资料回答用户的问题。
要求：
1. 如果上下文不足以回答问题，请如实告知，不要编造。
2. 如果回答中涉及某张图片或资质（可以通过【图片元数据】判断），请在回答中明确提到该图片，让用户参考附带的图片。
3. 语言专业、客观、准确。
"""

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
