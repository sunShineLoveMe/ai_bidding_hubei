import { Drawer, Input, Button, List, Spin, Typography, Image, Tag, Space, message } from 'antd';
import { SearchOutlined, SendOutlined } from '@ant-design/icons';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

const { Text } = Typography;

interface ImageMeta {
  url: string;
  alt: string;
}

interface SearchResult {
  answer: string;
  images: ImageMeta[];
  raw_contexts: any[];
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  images?: ImageMeta[];
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

  const handleSearch = async () => {
    if (!query.trim()) return;

    const userMessage: Message = { role: 'user', content: query };
    setMessages((prev) => [...prev, userMessage]);
    setQuery('');
    setLoading(true);

    try {
      const res = await fetch('/api/knowledge/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userMessage.content }),
      });

      if (!res.ok) {
        throw new Error('检索请求失败');
      }

      const data: SearchResult = await res.json();
      
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.answer,
          images: data.images,
        },
      ]);
    } catch (err: any) {
      message.error(err.message || '检索知识库出错');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      title="企业知识库多模态检索"
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
            <Text type="secondary">试着问我关于企业介绍、产品规格、历史案例等问题</Text>
            <Text type="secondary" className="mt-2 text-xs">支持“以文搜图”，会召回相关的产品图片或资质扫描件</Text>
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
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
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
                </div>
              </div>
            )}
          />
        )}
        {loading && (
          <div className="flex justify-start mb-6">
            <div className="bg-white border border-slate-100 rounded-2xl p-4 rounded-tl-sm flex items-center space-x-2">
              <Spin size="small" />
              <span className="text-slate-500 text-sm">正在检索企业知识库...</span>
            </div>
          </div>
        )}
      </div>
      <div className="p-4 bg-white border-t border-slate-100">
        <Input
          size="large"
          placeholder="输入您想查询的知识..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onPressEnter={handleSearch}
          suffix={
            <Button
              type="primary"
              shape="circle"
              icon={<SendOutlined />}
              onClick={handleSearch}
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
