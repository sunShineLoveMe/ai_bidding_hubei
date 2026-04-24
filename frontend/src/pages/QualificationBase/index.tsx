import { Button, DatePicker, Form, Input, Select, Space, Table, Tag, Upload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AlertTriangle, BadgeCheck, CalendarClock, FileBadge, UploadCloud } from 'lucide-react';
import { useState } from 'react';
import { CategoryList } from '../../components/common/CategoryList';
import { MetricCards } from '../../components/common/MetricCards';
import { ModuleHeader } from '../../components/common/ModuleHeader';

interface QualificationFile {
  id: string;
  name: string;
  category: string;
  issuer: string;
  certNo: string;
  expireAt: string;
  status: '有效' | '临期' | '待核验';
}

const categories = [
  { name: '全部资信', count: 46 },
  { name: '基础证照', count: 8 },
  { name: '资质证书', count: 12 },
  { name: '人员证书', count: 9 },
  { name: '财务资料', count: 6 },
  { name: '项目业绩', count: 7 },
  { name: '授权模板', count: 4 },
];

const files: QualificationFile[] = [
  { id: 'q1', name: '营业执照副本扫描件.pdf', category: '基础证照', issuer: '市场监督管理局', certNo: '91422800MA****', expireAt: '长期', status: '有效' },
  { id: 'q2', name: 'ISO9001质量管理体系证书.pdf', category: '资质证书', issuer: '认证机构', certNo: 'QMS-2026-018', expireAt: '2027-08-18', status: '有效' },
  { id: 'q3', name: '安全生产责任人员证书.pdf', category: '人员证书', issuer: '主管部门', certNo: 'AQ-2025-329', expireAt: '2026-06-30', status: '临期' },
  { id: 'q4', name: '近三年财务审计报告.pdf', category: '财务资料', issuer: '会计师事务所', certNo: 'FIN-2025-03', expireAt: '2026-12-31', status: '有效' },
  { id: 'q5', name: '水电装备供货业绩证明.pdf', category: '项目业绩', issuer: '项目业主', certNo: 'PERF-2024-11', expireAt: '待核验', status: '待核验' },
];

const statusColor: Record<QualificationFile['status'], string> = {
  有效: 'green',
  临期: 'orange',
  待核验: 'blue',
};

export function QualificationBasePage(): JSX.Element {
  const [activeCategory, setActiveCategory] = useState('全部资信');
  const dataSource = activeCategory === '全部资信' ? files : files.filter(file => file.category === activeCategory);

  const columns: ColumnsType<QualificationFile> = [
    { title: '资信文件', dataIndex: 'name', ellipsis: true },
    { title: '分类', dataIndex: 'category', width: 100, render: value => <Tag color="purple">{value}</Tag> },
    { title: '发证/出具机构', dataIndex: 'issuer', width: 140, ellipsis: true },
    { title: '编号', dataIndex: 'certNo', width: 130, ellipsis: true },
    { title: '有效期', dataIndex: 'expireAt', width: 110 },
    { title: '状态', dataIndex: 'status', width: 90, render: status => <Tag color={statusColor[status as QualificationFile['status']]}>{status}</Tag> },
    {
      title: '操作',
      width: 130,
      render: () => (
        <Space size={4}>
          <Button type="link" size="small">查看</Button>
          <Button type="link" size="small">更新</Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="module-shell">
      <ModuleHeader
        title="企业资信库"
        description="维护营业执照、资质证书、人员证书、财务资料、项目业绩和授权模板，避免投标材料过期或缺失。"
        actions={
          <Upload showUploadList={false} beforeUpload={() => false}>
            <Button type="primary" icon={<UploadCloud size={16} />}>上传资信文件</Button>
          </Upload>
        }
      />
      <MetricCards
        items={[
          { title: '资信文件数', value: 46, desc: '已归档材料', icon: FileBadge, colorClass: 'bg-blue-50 text-blue-600' },
          { title: '有效证照', value: 38, desc: '可直接用于投标', icon: BadgeCheck, colorClass: 'bg-emerald-50 text-emerald-600' },
          { title: '临期提醒', value: 5, desc: '90 天内到期', icon: CalendarClock, colorClass: 'bg-orange-50 text-orange-500' },
          { title: '待核验资料', value: 3, desc: '需人工确认', icon: AlertTriangle, colorClass: 'bg-red-50 text-red-500' },
        ]}
      />
      <div className="grid min-h-0 grid-cols-[250px_1fr_340px] gap-4">
        <CategoryList title="资信分类" items={categories} activeName={activeCategory} onChange={setActiveCategory} />
        <section className="panel-card h-full">
          <h2 className="panel-title">资信文件列表</h2>
          <Table rowKey="id" size="small" pagination={false} columns={columns} dataSource={dataSource} className="compact-table" />
        </section>
        <section className="panel-card h-full">
          <h2 className="panel-title">证照信息维护</h2>
          <Form layout="vertical" size="small" className="compact-form">
            <Form.Item label="资信分类">
              <Select defaultValue="资质证书" options={categories.slice(1).map(item => ({ label: item.name, value: item.name }))} />
            </Form.Item>
            <Form.Item label="证书编号">
              <Input placeholder="请输入证书编号" />
            </Form.Item>
            <Form.Item label="发证/出具机构">
              <Input placeholder="请输入机构名称" />
            </Form.Item>
            <Form.Item label="有效期">
              <DatePicker className="w-full" />
            </Form.Item>
            <Form.Item label="适用投标场景">
              <Select mode="multiple" placeholder="选择场景" options={['设备采购', 'PC/EPC', '施工总承包', '维保服务'].map(value => ({ label: value, value }))} />
            </Form.Item>
            <Button block type="primary">保存资信信息</Button>
          </Form>
        </section>
      </div>
    </div>
  );
}
