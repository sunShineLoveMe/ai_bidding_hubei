import { Button, Progress, Space, Table, Tag, Upload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { BookOpen, Database, FileText, RefreshCw, UploadCloud } from 'lucide-react';
import { useState } from 'react';
import { CategoryList } from '../../components/common/CategoryList';
import { MetricCards } from '../../components/common/MetricCards';
import { ModuleHeader } from '../../components/common/ModuleHeader';

interface KnowledgeFile {
  id: string;
  name: string;
  category: string;
  type: string;
  chunks: number;
  status: '已索引' | '解析中' | '待解析';
  updatedAt: string;
}

const categories = [
  { name: '全部资料', count: 128 },
  { name: '企业介绍', count: 12 },
  { name: '历史标书', count: 38 },
  { name: '项目案例', count: 24 },
  { name: '标准话术', count: 18 },
  { name: '行业资料', count: 28 },
  { name: '其他资料', count: 8 },
];

const files: KnowledgeFile[] = [
  { id: 'k1', name: '清江峡能企业能力介绍.docx', category: '企业介绍', type: 'Word', chunks: 18, status: '已索引', updatedAt: '2026-04-22 10:30' },
  { id: 'k2', name: '三峡供应链历史投标技术响应.md', category: '历史标书', type: 'Markdown', chunks: 42, status: '已索引', updatedAt: '2026-04-21 16:18' },
  { id: 'k3', name: '水电装备交付保障案例.pdf', category: '项目案例', type: 'PDF', chunks: 31, status: '解析中', updatedAt: '2026-04-20 09:42' },
  { id: 'k4', name: '质量管理体系标准话术.txt', category: '标准话术', type: 'TXT', chunks: 12, status: '已索引', updatedAt: '2026-04-19 14:05' },
  { id: 'k5', name: '水利水电设备采购规范摘录.pdf', category: '行业资料', type: 'PDF', chunks: 35, status: '待解析', updatedAt: '2026-04-18 11:20' },
];

const statusColor: Record<KnowledgeFile['status'], string> = {
  已索引: 'green',
  解析中: 'blue',
  待解析: 'orange',
};

export function KnowledgeBasePage(): JSX.Element {
  const [activeCategory, setActiveCategory] = useState('全部资料');
  const dataSource = activeCategory === '全部资料' ? files : files.filter(file => file.category === activeCategory);

  const columns: ColumnsType<KnowledgeFile> = [
    { title: '文件名称', dataIndex: 'name', ellipsis: true },
    { title: '分类', dataIndex: 'category', width: 110, render: value => <Tag color="blue">{value}</Tag> },
    { title: '类型', dataIndex: 'type', width: 88 },
    { title: '分片数', dataIndex: 'chunks', width: 88 },
    { title: '索引状态', dataIndex: 'status', width: 100, render: status => <Tag color={statusColor[status as KnowledgeFile['status']]}>{status}</Tag> },
    { title: '更新时间', dataIndex: 'updatedAt', width: 145 },
    {
      title: '操作',
      width: 130,
      render: () => (
        <Space size={4}>
          <Button type="link" size="small">查看</Button>
          <Button type="link" size="small">重解析</Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="module-shell">
      <ModuleHeader
        title="企业知识库"
        description="管理企业介绍、历史标书、项目案例、标准话术和行业资料，为 RAG 标书生成提供可检索知识来源。"
        actions={
          <>
            <Button icon={<RefreshCw size={16} />}>重建索引</Button>
            <Upload showUploadList={false} beforeUpload={() => false}>
              <Button type="primary" icon={<UploadCloud size={16} />}>上传资料</Button>
            </Upload>
          </>
        }
      />
      <MetricCards
        items={[
          { title: '资料总数', value: 128, desc: '已纳入知识库', icon: BookOpen, colorClass: 'bg-blue-50 text-blue-600' },
          { title: '已索引文件', value: 112, desc: '可用于检索生成', icon: Database, colorClass: 'bg-emerald-50 text-emerald-600' },
          { title: '文本分片', value: 2840, desc: 'ChromaDB chunks', icon: FileText, colorClass: 'bg-violet-50 text-violet-600' },
          { title: '索引完成度', value: '87%', desc: '待解析 16 份', icon: RefreshCw, colorClass: 'bg-orange-50 text-orange-500' },
        ]}
      />
      <div className="grid min-h-0 grid-cols-[260px_1fr_310px] gap-4">
        <CategoryList title="资料分类" items={categories} activeName={activeCategory} onChange={setActiveCategory} />
        <section className="panel-card h-full">
          <h2 className="panel-title">文件列表</h2>
          <Table rowKey="id" size="small" pagination={false} columns={columns} dataSource={dataSource} className="compact-table" />
        </section>
        <section className="panel-card h-full">
          <h2 className="panel-title">索引策略</h2>
          <div className="space-y-4 text-sm font-semibold text-slate-600">
            <div>
              <div className="mb-2 flex justify-between"><span>知识库索引完成度</span><span>87%</span></div>
              <Progress percent={87} showInfo={false} />
            </div>
            <div className="rounded-xl bg-slate-50 p-3 leading-6">
              当前采用本地 ChromaDB 持久化存储，上传文件会抽取文本、自动分片、生成 embedding，并写入 `document_embeddings` 集合。
            </div>
            <div className="rounded-xl bg-blue-50 p-3 leading-6 text-blue-700">
              推荐优先入库：企业介绍、历史标书、项目案例、质量体系、售后服务、行业规范。
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
