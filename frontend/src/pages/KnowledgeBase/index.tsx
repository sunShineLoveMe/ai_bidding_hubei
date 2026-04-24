import { Button, Empty, Progress, Space, Table, Tag, Upload } from 'antd';
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
  { name: '全部资料', count: 0 },
  { name: '企业介绍', count: 0 },
  { name: '历史标书', count: 0 },
  { name: '项目案例', count: 0 },
  { name: '标准话术', count: 0 },
  { name: '行业资料', count: 0 },
  { name: '其他资料', count: 0 },
];

const files: KnowledgeFile[] = [];

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
          { title: '资料总数', value: 0, desc: '等待上传资料', icon: BookOpen, colorClass: 'bg-blue-50 text-blue-600' },
          { title: '已索引文件', value: 0, desc: '暂无可检索文件', icon: Database, colorClass: 'bg-emerald-50 text-emerald-600' },
          { title: '文本分片', value: 0, desc: '等待解析入库', icon: FileText, colorClass: 'bg-violet-50 text-violet-600' },
          { title: '索引完成度', value: '0%', desc: '暂无解析任务', icon: RefreshCw, colorClass: 'bg-orange-50 text-orange-500' },
        ]}
      />
      <div className="grid min-h-0 grid-cols-[260px_1fr_310px] gap-4">
        <CategoryList title="资料分类" items={categories} activeName={activeCategory} onChange={setActiveCategory} />
        <section className="panel-card h-full">
          <h2 className="panel-title">文件列表</h2>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            columns={columns}
            dataSource={dataSource}
            className="compact-table"
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无知识库资料，请上传真实企业资料" /> }}
          />
        </section>
        <section className="panel-card h-full">
          <h2 className="panel-title">索引策略</h2>
          <div className="space-y-4 text-sm font-semibold text-slate-600">
            <div>
              <div className="mb-2 flex justify-between"><span>知识库索引完成度</span><span>0%</span></div>
              <Progress percent={0} showInfo={false} />
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
