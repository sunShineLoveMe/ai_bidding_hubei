import { Button, Descriptions, Empty, Form, Image, Input, Modal, Select, Space, Table, Tag, Upload, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Box, Cpu, FileStack, Tags, UploadCloud } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CategoryList } from '../../components/common/CategoryList';
import { MetricCards } from '../../components/common/MetricCards';
import { ModuleHeader } from '../../components/common/ModuleHeader';
import { apiClient } from '../../api/client';

interface KnowledgeAsset {
  id: string;
  title: string;
  description?: string;
  category?: string;
  asset_type: string;
  public_url?: string;
  source_url?: string;
  license?: string;
  attribution?: string;
  applicable_sections?: string[];
  tags?: string[];
  specs?: Record<string, unknown>;
  status?: string;
  is_synthetic?: boolean;
  created_at?: string;
}

const preferredCategories = [
  '水轮机与水电设备',
  '紧固件与标准件',
  '泵站设备',
  '金属结构与闸门',
  '阀门与管件',
  '水利信息化产品',
  '电气与自动化',
  '检测与试验设备',
  '泵站水闸工程',
  '灌区与渠道工程',
  '水库除险加固',
];

function scenario(asset: KnowledgeAsset): string {
  return (asset.applicable_sections || []).slice(0, 2).join('、') || '技术响应文件';
}

function versionLabel(asset: KnowledgeAsset): string {
  return asset.is_synthetic ? '脱敏样例' : '公开素材';
}

export function ProductBasePage(): JSX.Element {
  const [activeCategory, setActiveCategory] = useState('全部产品');
  const [assets, setAssets] = useState<KnowledgeAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<KnowledgeAsset | null>(null);

  const fetchAssets = async () => {
    try {
      setLoading(true);
      const { data } = await apiClient.get<KnowledgeAsset[]>('/api/knowledge/assets?asset_type=product_image', {
        skipGlobalLoading: true,
      });
      setAssets(data);
    } catch (error: any) {
      message.error(error.message || '获取产品资产失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssets();
  }, []);

  const categories = useMemo(() => {
    const counts = assets.reduce<Record<string, number>>((acc, asset) => {
      const category = asset.category || '其他产品资料';
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {});
    const ordered = [
      ...preferredCategories.filter(category => counts[category]),
      ...Object.keys(counts).filter(category => !preferredCategories.includes(category)).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    ];
    return [
      { name: '全部产品', count: assets.length },
      ...ordered.map(name => ({ name, count: counts[name] || 0 })),
    ];
  }, [assets]);

  const dataSource = activeCategory === '全部产品' ? assets : assets.filter(asset => asset.category === activeCategory);
  const tagCount = new Set(assets.flatMap(asset => asset.tags || [])).size;
  const specCount = assets.filter(asset => asset.is_synthetic || Object.keys(asset.specs || {}).length > 0).length;
  const publicCaseCount = assets.filter(asset => !asset.is_synthetic && asset.source_url).length;

  const columns: ColumnsType<KnowledgeAsset> = [
    { title: '产品/服务名称', dataIndex: 'title', ellipsis: true },
    { title: '类型', dataIndex: 'category', width: 150, render: value => <Tag color="blue">{value || '产品资料'}</Tag> },
    { title: '版本', width: 90, render: (_, record) => versionLabel(record) },
    { title: '适用场景', width: 180, ellipsis: true, render: (_, record) => scenario(record) },
    {
      title: '能力标签',
      dataIndex: 'tags',
      width: 230,
      render: tags => (
        <Space size={4} wrap>
          {((tags as string[]) || []).slice(0, 3).map(tag => <Tag key={tag}>{tag}</Tag>)}
        </Space>
      ),
    },
    { title: '资料数', width: 80, render: () => 1 },
    {
      title: '操作',
      width: 130,
      render: (_, record) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => setDetail(record)}>详情</Button>
          <Button type="link" size="small" onClick={() => message.info('产品编辑待接入资产更新接口')}>编辑</Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="module-shell">
      <ModuleHeader
        title="企业产品库"
        description="沉淀产品参数、制造能力、适用场景、案例资料和服务能力，为技术响应和商务材料生成提供标准素材。"
        actions={
          <>
            <Button onClick={() => message.info('新增产品将接入 knowledge_assets 结构化写入')}>新增产品</Button>
            <Upload showUploadList={false} beforeUpload={() => {
              message.info('产品资料上传将接入 knowledge_assets 入库流程');
              return false;
            }}>
              <Button type="primary" icon={<UploadCloud size={16} />}>上传产品资料</Button>
            </Upload>
          </>
        }
      />
      <MetricCards
        items={[
          { title: '产品资料数', value: assets.length, desc: '已接入产品资产', icon: Box, colorClass: 'bg-blue-50 text-blue-600' },
          { title: '能力标签', value: tagCount, desc: '来自图片资产标签', icon: Tags, colorClass: 'bg-emerald-50 text-emerald-600' },
          { title: '技术参数表', value: specCount, desc: '规格图与参数素材', icon: Cpu, colorClass: 'bg-violet-50 text-violet-600' },
          { title: '案例附件', value: publicCaseCount, desc: '公开来源图片', icon: FileStack, colorClass: 'bg-orange-50 text-orange-500' },
        ]}
      />
      <div className="grid min-h-0 grid-cols-[250px_1fr_350px] gap-4">
        <CategoryList title="产品分类" items={categories} activeName={activeCategory} onChange={setActiveCategory} />
        <section className="panel-card h-full">
          <h2 className="panel-title">产品与服务列表</h2>
          <Table
            rowKey="id"
            size="small"
            pagination={{ pageSize: 12 }}
            columns={columns}
            dataSource={dataSource}
            loading={loading}
            className="compact-table"
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无产品资料，请维护真实产品信息" /> }}
          />
        </section>
        <section className="panel-card h-full">
          <h2 className="panel-title">产品能力维护</h2>
          <Form layout="vertical" size="small" className="compact-form">
            <Form.Item label="产品名称">
              <Input placeholder="例如：水轮机叶片精密加工件" />
            </Form.Item>
            <Form.Item label="产品类型">
              <Select options={categories.slice(1).map(item => ({ label: item.name, value: item.name }))} placeholder="选择类型" />
            </Form.Item>
            <Form.Item label="适用行业">
              <Select mode="multiple" options={['水利工程', '水电站', '机电设备', '金属结构'].map(value => ({ label: value, value }))} />
            </Form.Item>
            <Form.Item label="核心能力标签">
              <Select mode="tags" placeholder="输入能力标签" />
            </Form.Item>
            <Form.Item label="产品简介">
              <Input.TextArea rows={3} placeholder="用于标书技术响应的标准描述" />
            </Form.Item>
            <Button block type="primary" onClick={() => message.info('产品元数据保存待接入资产更新接口')}>保存产品信息</Button>
          </Form>
        </section>
      </div>

      <Modal title="产品资料详情" open={Boolean(detail)} onCancel={() => setDetail(null)} footer={<Button onClick={() => setDetail(null)}>关闭</Button>} width={900}>
        {detail ? (
          <div className="grid gap-4 md:grid-cols-[300px_1fr]">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              {detail.public_url ? <Image src={detail.public_url} alt={detail.title} className="rounded-lg object-contain" /> : <Empty description="无图片" />}
            </div>
            <Descriptions size="small" bordered column={1}>
              <Descriptions.Item label="产品名称">{detail.title}</Descriptions.Item>
              <Descriptions.Item label="产品分类">{detail.category || '-'}</Descriptions.Item>
              <Descriptions.Item label="适用场景">{scenario(detail)}</Descriptions.Item>
              <Descriptions.Item label="能力标签">{(detail.tags || []).join('、') || '-'}</Descriptions.Item>
              <Descriptions.Item label="产品说明">{detail.description || '-'}</Descriptions.Item>
              <Descriptions.Item label="适用章节">{(detail.applicable_sections || []).join('、') || '-'}</Descriptions.Item>
              <Descriptions.Item label="来源">{detail.source_url ? <a href={detail.source_url} target="_blank" rel="noreferrer">查看来源</a> : '脱敏合成规格图'}</Descriptions.Item>
              <Descriptions.Item label="合规说明">{detail.is_synthetic ? '脱敏合成样张，可用于产品库/RAG/自动插图测试。' : '公开来源素材，正式商用前需复核许可和署名要求。'}</Descriptions.Item>
            </Descriptions>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
