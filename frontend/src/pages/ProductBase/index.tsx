import { Button, Form, Input, Select, Space, Table, Tag, Upload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Box, Cpu, FileStack, Tags, UploadCloud } from 'lucide-react';
import { useState } from 'react';
import { CategoryList } from '../../components/common/CategoryList';
import { MetricCards } from '../../components/common/MetricCards';
import { ModuleHeader } from '../../components/common/ModuleHeader';

interface ProductRecord {
  id: string;
  name: string;
  type: string;
  version: string;
  scenario: string;
  tags: string[];
  docs: number;
}

const categories = [
  { name: '全部产品', count: 32 },
  { name: '水轮机叶片', count: 6 },
  { name: '专用螺母', count: 8 },
  { name: '紧固件', count: 7 },
  { name: '金属结构件', count: 5 },
  { name: '设备配套加工', count: 4 },
  { name: '现场服务', count: 2 },
];

const products: ProductRecord[] = [
  { id: 'p1', name: '水轮机叶片精密加工件', type: '水轮机叶片', version: 'V2.1', scenario: '水电站检修与复建', tags: ['精密制造', '动平衡', '耐磨'], docs: 8 },
  { id: 'p2', name: '高强度专用螺母组件', type: '专用螺母', version: 'V1.8', scenario: '水利机电设备安装', tags: ['高强度', '防松', '可追溯'], docs: 6 },
  { id: 'p3', name: '水电装备紧固件套件', type: '紧固件', version: 'V3.0', scenario: '设备供货与维保', tags: ['标准化', '备品备件'], docs: 5 },
  { id: 'p4', name: '金属结构件加工服务', type: '金属结构件', version: '定制', scenario: 'PC/EPC 项目', tags: ['焊接', '检测', '交付'], docs: 7 },
  { id: 'p5', name: '现场安装配合与维保服务', type: '现场服务', version: 'S1', scenario: '售后与驻场服务', tags: ['响应时效', '驻场', '闭环'], docs: 4 },
];

export function ProductBasePage(): JSX.Element {
  const [activeCategory, setActiveCategory] = useState('全部产品');
  const dataSource = activeCategory === '全部产品' ? products : products.filter(product => product.type === activeCategory);

  const columns: ColumnsType<ProductRecord> = [
    { title: '产品/服务名称', dataIndex: 'name', ellipsis: true },
    { title: '类型', dataIndex: 'type', width: 120, render: value => <Tag color="blue">{value}</Tag> },
    { title: '版本', dataIndex: 'version', width: 80 },
    { title: '适用场景', dataIndex: 'scenario', width: 160, ellipsis: true },
    {
      title: '能力标签',
      dataIndex: 'tags',
      width: 210,
      render: tags => (
        <Space size={4} wrap>
          {(tags as string[]).map(tag => <Tag key={tag}>{tag}</Tag>)}
        </Space>
      ),
    },
    { title: '资料数', dataIndex: 'docs', width: 80 },
    {
      title: '操作',
      width: 130,
      render: () => (
        <Space size={4}>
          <Button type="link" size="small">详情</Button>
          <Button type="link" size="small">编辑</Button>
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
            <Button>新增产品</Button>
            <Upload showUploadList={false} beforeUpload={() => false}>
              <Button type="primary" icon={<UploadCloud size={16} />}>上传产品资料</Button>
            </Upload>
          </>
        }
      />
      <MetricCards
        items={[
          { title: '产品资料数', value: 32, desc: '产品与服务条目', icon: Box, colorClass: 'bg-blue-50 text-blue-600' },
          { title: '能力标签', value: 86, desc: '用于章节匹配', icon: Tags, colorClass: 'bg-emerald-50 text-emerald-600' },
          { title: '技术参数表', value: 18, desc: '可引用参数', icon: Cpu, colorClass: 'bg-violet-50 text-violet-600' },
          { title: '案例附件', value: 52, desc: '图纸/手册/业绩', icon: FileStack, colorClass: 'bg-orange-50 text-orange-500' },
        ]}
      />
      <div className="grid min-h-0 grid-cols-[250px_1fr_350px] gap-4">
        <CategoryList title="产品分类" items={categories} activeName={activeCategory} onChange={setActiveCategory} />
        <section className="panel-card h-full">
          <h2 className="panel-title">产品与服务列表</h2>
          <Table rowKey="id" size="small" pagination={false} columns={columns} dataSource={dataSource} className="compact-table" />
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
            <Button block type="primary">保存产品信息</Button>
          </Form>
        </section>
      </div>
    </div>
  );
}
