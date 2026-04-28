import { Drawer, Input, Button, List, Spin, Typography, Image, Space, message } from 'antd';
import { SearchOutlined, SendOutlined } from '@ant-design/icons';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

const { Text } = Typography;

interface ImageMeta {
  url: string;
  alt: string;
}

interface SourceContext {
  content?: string;
  similarity?: number;
  metadata?: {
    doc_type?: string;
    source_org?: string;
    source_url?: string;
    source_file?: string;
    category_label?: string;
    category?: string;
    tags?: string;
  };
}

interface KnowledgeAsset {
  id?: string;
  title?: string;
  description?: string;
  category?: string;
  asset_type?: string;
  public_url?: string;
  source_url?: string;
  license?: string;
  attribution?: string;
  applicable_sections?: string[];
  tags?: string[];
  similarity?: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  images?: ImageMeta[];
  sources?: SourceContext[];
  assets?: KnowledgeAsset[];
  streaming?: boolean;
  status?: string;
}

function sourceTitle(source: SourceContext): string {
  const meta = source.metadata || {};
  return meta.source_org || meta.source_file || meta.category_label || meta.category || '企业知识库';
}

function sourceDescription(source: SourceContext): string {
  const meta = source.metadata || {};
  return [meta.doc_type, meta.tags].filter(Boolean).join(' · ') || '知识片段';
}

function previewText(content?: string): string {
  return (content || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function KnowledgeSearchDrawer({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);

  const guideQuestions = [
    '水库除险加固工程投标文件需要重点准备哪些资格材料？',
    '水利工程施工组织设计中安全度汛和质量安全措施应该怎么写？',
    '根据现有知识库，水利投标最容易出现哪些废标或否决风险？',
  ];

  const handleSearch = async (presetQuery?: string) => {
    const currentQuery = (presetQuery || query).trim();
    if (!currentQuery) return;

    const userMessage: Message = { role: 'user', content: currentQuery };
    const assistantMessage: Message = {
      role: 'assistant',
      content: '',
      status: '正在检索知识库资料...',
      streaming: true,
    };
    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setQuery('');
    setLoading(true);

    try {
      const res = await fetch('/api/knowledge/search/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userMessage.content }),
      });

      if (!res.ok || !res.body) {
        throw new Error('检索请求失败');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let hasContent = false;

      const updateAssistant = (updater: (message: Message) => Message) => {
        setMessages((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i -= 1) {
            if (next[i].role === 'assistant') {
              next[i] = updater(next[i]);
              break;
            }
          }
          return next;
        });
      };

      const handleEvent = (event: any) => {
        if (event.type === 'status') {
          updateAssistant((msg) => ({ ...msg, status: event.message || msg.status }));
          return;
        }
        if (event.type === 'retrieved') {
          updateAssistant((msg) => ({
            ...msg,
            status: `已召回 ${event.contexts_count || 0} 条资料、${event.assets_count || 0} 个图片资产，正在生成回答...`,
            images: event.images || [],
            sources: event.raw_contexts || [],
            assets: event.assets || [],
          }));
          return;
        }
        if (event.type === 'chunk') {
          hasContent = true;
          updateAssistant((msg) => ({
            ...msg,
            content: `${msg.content || ''}${event.content || ''}`,
            status: '',
          }));
          return;
        }
        if (event.type === 'done') {
          updateAssistant((msg) => ({ ...msg, streaming: false, status: '' }));
          return;
        }
        if (event.type === 'error') {
          throw new Error(event.error || '检索知识库出错');
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
          if (!dataLine) continue;
          const raw = dataLine.replace(/^data:\s*/, '');
          if (!raw) continue;
          handleEvent(JSON.parse(raw));
        }
      }

      if (!hasContent) {
        updateAssistant((msg) => ({
          ...msg,
          streaming: false,
          status: '',
          content: msg.content || '未生成有效回答，请换一个问题重试。',
        }));
      }
    } catch (err: any) {
      setMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i -= 1) {
          if (next[i].role === 'assistant') {
            next[i] = {
              ...next[i],
              streaming: false,
              status: '',
              content: next[i].content || '检索知识库出错，请稍后重试。',
            };
            break;
          }
        }
        return next;
      });
      message.error(err.message || '检索知识库出错');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      title="企业知识库 RAG 问答"
      placement="right"
      width={600}
      onClose={onClose}
      open={visible}
      bodyStyle={{ display: 'flex', flexDirection: 'column', padding: 0 }}
    >
      <div className="flex-1 overflow-y-auto p-4 bg-slate-50">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <SearchOutlined style={{ fontSize: 48, marginBottom: 16 }} />
            <Text type="secondary">试着问我关于水利招标文件、政策法规、标准话术和投标章节的问题</Text>
            <Text type="secondary" className="mt-2 text-xs">当前基于已入库文本分片回答，后续可扩展图文资料召回</Text>
            <div className="mt-6 w-full space-y-3">
              {guideQuestions.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => handleSearch(question)}
                  className="w-full rounded-xl border border-blue-100 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <List
            dataSource={messages}
            renderItem={(msg, index) => (
              <div key={index} className={`mb-6 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl p-4 shadow-sm ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-tr-sm'
                      : 'bg-white border border-slate-100 rounded-tl-sm'
                  }`}
                >
                  <div className={`prose prose-sm max-w-none ${msg.role === 'user' ? 'prose-invert' : ''}`}>
                    {msg.status && (
                      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-500">
                        <Spin size="small" />
                        <span>{msg.status}</span>
                      </div>
                    )}
                    {msg.content ? <ReactMarkdown>{msg.content}</ReactMarkdown> : null}
                    {msg.streaming && msg.content && <span className="ml-1 inline-block h-4 w-1 animate-pulse rounded bg-blue-500 align-middle" />}
                  </div>
                  
                  {/* 图片画廊渲染 */}
                  {msg.images && msg.images.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <div className="text-xs text-slate-500 mb-2 font-medium">相关参考图片：</div>
                      <Space wrap size={8}>
                        {msg.images.map((img, i) => (
                          <div key={i} className="relative group rounded-md overflow-hidden border border-slate-200">
                            <Image
                              src={img.url}
                              alt={img.alt}
                              width={120}
                              height={120}
                              className="object-cover"
                              preview={{
                                src: img.url,
                              }}
                            />
                            <div className="absolute bottom-0 left-0 right-0 bg-black/50 p-1 truncate text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity">
                              {img.alt}
                            </div>
                          </div>
                        ))}
                      </Space>
                    </div>
                  )}

                  {msg.role === 'assistant' && !msg.streaming && msg.assets && msg.assets.length > 0 && (
                    <div className="mt-4 border-t border-slate-100 pt-4">
                      <div className="mb-2 text-xs font-bold text-slate-500">相关图片 / 资质附件</div>
                      <div className="grid grid-cols-1 gap-3">
                        {msg.assets.slice(0, 6).map((asset, assetIndex) => (
                          <div key={asset.id || `${asset.title}-${assetIndex}`} className="flex gap-3 rounded-xl bg-slate-50 p-3">
                            {asset.public_url ? (
                              <Image
                                src={asset.public_url}
                                alt={asset.title}
                                width={88}
                                height={72}
                                className="rounded-lg object-cover"
                                preview={{ src: asset.public_url }}
                              />
                            ) : (
                              <div className="flex h-[72px] w-[88px] shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">
                                无图片
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <div className="truncate text-sm font-bold text-slate-700">
                                  {asset.title || '未命名图片'}
                                </div>
                                {typeof asset.similarity === 'number' && (
                                  <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-600">
                                    {(asset.similarity * 100).toFixed(0)}%
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 text-xs font-semibold text-slate-400">
                                {[asset.category, asset.asset_type].filter(Boolean).join(' · ')}
                              </div>
                              {asset.description && (
                                <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                                  {asset.description}
                                </div>
                              )}
                              {asset.applicable_sections && asset.applicable_sections.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {asset.applicable_sections.slice(0, 3).map((section) => (
                                    <span key={section} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                                      {section}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {asset.source_url && (
                                <a
                                  href={asset.source_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-2 inline-block text-xs font-bold text-blue-600 hover:text-blue-700"
                                >
                                  查看图片来源
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {msg.role === 'assistant' && !msg.streaming && msg.sources && msg.sources.length > 0 && (
                    <div className="mt-4 border-t border-slate-100 pt-4">
                      <div className="mb-2 text-xs font-bold text-slate-500">参考资料来源</div>
                      <div className="space-y-2">
                        {msg.sources.slice(0, 5).map((source, sourceIndex) => {
                          const meta = source.metadata || {};
                          return (
                            <div key={`${sourceTitle(source)}-${sourceIndex}`} className="rounded-xl bg-slate-50 p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-bold text-slate-700">
                                    资料{sourceIndex + 1}：{sourceTitle(source)}
                                  </div>
                                  <div className="mt-1 text-xs font-semibold text-slate-400">
                                    {sourceDescription(source)}
                                  </div>
                                </div>
                                {typeof source.similarity === 'number' && (
                                  <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-600">
                                    {(source.similarity * 100).toFixed(0)}%
                                  </span>
                                )}
                              </div>
                              {previewText(source.content) && (
                                <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
                                  {previewText(source.content)}
                                </div>
                              )}
                              {meta.source_url && (
                                <a
                                  href={meta.source_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-2 inline-block text-xs font-bold text-blue-600 hover:text-blue-700"
                                >
                                  查看原始来源
                                </a>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          />
        )}
      </div>
      <div className="p-4 bg-white border-t border-slate-100">
        <Input
          size="large"
          placeholder="输入您想查询的知识..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onPressEnter={() => handleSearch()}
          suffix={
            <Button
              type="primary"
              shape="circle"
              icon={<SendOutlined />}
              onClick={() => handleSearch()}
              loading={loading}
              className="flex items-center justify-center"
            />
          }
          className="rounded-full px-4"
        />
      </div>
    </Drawer>
  );
}
