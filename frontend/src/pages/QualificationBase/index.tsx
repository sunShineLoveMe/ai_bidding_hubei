import { Button, Descriptions, Empty, Form, Image, Input, Modal, Select, Space, Switch, Table, Tag, Upload, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AlertTriangle, BadgeCheck, CalendarClock, FileBadge, UploadCloud } from 'lucide-react';
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
  anonymized?: boolean;
  created_at?: string;
}

const categoryMap: Record<string, string> = {
  企业资信: '企业资信',
  基础证照: '基础证照',
  资质证书: '资质证书',
  人员证书: '人员证书',
  财务资料: '财务资料',
  项目业绩: '项目业绩',
  授权模板: '授权模板',
};

function inferQualificationCategory(asset: KnowledgeAsset): string {
  const text = `${asset.title || ''} ${(asset.tags || []).join('、')} ${asset.description || ''}`;
  if (text.includes('营业执照')) return '基础证照';
  if (text.includes('资质')) return '资质证书';
  if (text.includes('安全生产许可证')) return '资质证书';
  return categoryMap[asset.category || ''] || '企业资信';
}

function statusLabel(asset: KnowledgeAsset): string {
  if (asset.status === 'indexed') return '有效';
  if (asset.status === 'processing') return '待核验';
  return '待核验';
}

const statusColor: Record<string, string> = {
  有效: 'green',
  临期: 'orange',
  待核验: 'blue',
};

export function QualificationBasePage(): JSX.Element {
  const [form] = Form.useForm();
  const [activeCategory, setActiveCategory] = useState('全部资信');
  const [assets, setAssets] = useState<KnowledgeAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const [detail, setDetail] = useState<KnowledgeAsset | null>(null);

  const fetchAssets = async () => {
    try {
      setLoading(true);
      const { data } = await apiClient.get<KnowledgeAsset[]>('/api/knowledge/assets?asset_type=qualification_image', {
        skipGlobalLoading: true,
      });
      setAssets(data);
    } catch (error: any) {
      message.error(error.message || '获取资信资产失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssets();
  }, []);

  const enrichedAssets = useMemo(
    () => assets.map(asset => ({ ...asset, qualificationCategory: inferQualificationCategory(asset) })),
    [assets],
  );

  const categories = useMemo(() => {
    const counts = enrichedAssets.reduce<Record<string, number>>((acc, asset) => {
      acc[asset.qualificationCategory] = (acc[asset.qualificationCategory] || 0) + 1;
      return acc;
    }, {});
    const names = ['基础证照', '资质证书', '人员证书', '财务资料', '项目业绩', '授权模板'];
    return [
      { name: '全部资信', count: enrichedAssets.length },
      ...names.map(name => ({ name, count: counts[name] || 0 })),
    ];
  }, [enrichedAssets]);

  const dataSource = activeCategory === '全部资信'
    ? enrichedAssets
    : enrichedAssets.filter(asset => asset.qualificationCategory === activeCategory);

  const columns: ColumnsType<KnowledgeAsset & { qualificationCategory?: string }> = [
    { title: '资信文件', dataIndex: 'title', ellipsis: true },
    { title: '分类', dataIndex: 'qualificationCategory', width: 110, render: value => <Tag color="purple">{value}</Tag> },
    { title: '发证/出具机构', dataIndex: 'attribution', width: 150, ellipsis: true, render: value => value || '脱敏样张' },
    { title: '编号', width: 130, render: (_, record) => (record.is_synthetic ? '脱敏样例' : '-') },
    { title: '有效期', width: 110, render: () => '待维护' },
    { title: '状态', width: 90, render: (_, record) => <Tag color={statusColor[statusLabel(record)]}>{statusLabel(record)}</Tag> },
    {
      title: '操作',
      width: 130,
      render: (_, record) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => setDetail(record)}>查看</Button>
          <Button type="link" size="small" onClick={() => message.info('证照更新流程待接入真实上传')}>更新</Button>
        </Space>
      ),
    },
  ];

  const saveQualificationAsset = async () => {
    try {
      const values = await form.validateFields();
      if (!assetFile) {
        message.warning('请先上传证照图片或附件');
        return;
      }
      setSaving(true);
      const formData = new FormData();
      formData.append('file', assetFile);
      formData.append('library_type', 'qualification');
      formData.append('asset_type', 'qualification_image');
      formData.append('title', values.title);
      formData.append('category', values.category);
      formData.append('description', values.description || '');
      formData.append('certificate_no', values.certificate_no || '');
      formData.append('issuer', values.issuer || '');
      formData.append('tags', JSON.stringify(values.tags || []));
      formData.append('applicable_sections', JSON.stringify(values.applicable_sections || []));
      formData.append('allowed_for_bid', String(values.allowed_for_bid ?? true));
      formData.append('is_sensitive', String(values.is_sensitive ?? false));
      formData.append('anonymized', 'true');
      formData.append('usage_note', values.usage_note || '');
      await apiClient.post('/api/knowledge/assets/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      message.success('资信资料已保存并接入检索');
      form.resetFields();
      setAssetFile(null);
      await fetchAssets();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error.message || '保存资信资料失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="module-shell">
      <ModuleHeader
        title="企业资信库"
        description="维护营业执照、资质证书、人员证书、财务资料、项目业绩和授权模板，避免投标材料过期或缺失。"
        actions={
          <Upload showUploadList={false} beforeUpload={(file) => {
            setAssetFile(file);
            message.success('已选择文件，请在右侧补充证照信息后保存');
            return false;
          }}>
            <Button type="primary" icon={<UploadCloud size={16} />}>上传资信文件</Button>
          </Upload>
        }
      />
      <MetricCards
        items={[
          { title: '资信文件数', value: assets.length, desc: '已接入资信资产', icon: FileBadge, colorClass: 'bg-blue-50 text-blue-600' },
          { title: '有效证照', value: assets.filter(asset => asset.status === 'indexed').length, desc: '可用于检索', icon: BadgeCheck, colorClass: 'bg-emerald-50 text-emerald-600' },
          { title: '临期提醒', value: 0, desc: '待接入到期字段', icon: CalendarClock, colorClass: 'bg-orange-50 text-orange-500' },
          { title: '待核验资料', value: assets.filter(asset => asset.status !== 'indexed').length, desc: '需人工复核', icon: AlertTriangle, colorClass: 'bg-red-50 text-red-500' },
        ]}
      />
      <div className="grid min-h-0 grid-cols-[250px_1fr_340px] gap-4">
        <CategoryList title="资信分类" items={categories} activeName={activeCategory} onChange={setActiveCategory} />
        <section className="panel-card h-full">
          <h2 className="panel-title">资信文件列表</h2>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            columns={columns}
            dataSource={dataSource}
            loading={loading}
            className="compact-table"
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无资信文件，请上传真实证照材料" /> }}
          />
        </section>
        <section className="panel-card h-full overflow-auto">
          <h2 className="panel-title">证照信息维护</h2>
          <Form form={form} layout="vertical" size="small" className="compact-form">
            <Form.Item label="资信名称" name="title" rules={[{ required: true, message: '请输入资信名称' }]}>
              <Input placeholder="例如：水利水电施工总承包资质证书" />
            </Form.Item>
            <Form.Item label="资信分类" name="category" initialValue="资质证书" rules={[{ required: true, message: '请选择分类' }]}>
              <Select options={categories.slice(1).map(item => ({ label: item.name, value: item.name }))} />
            </Form.Item>
            <Form.Item label="证书编号" name="certificate_no">
              <Input placeholder="请输入证书编号，可填写脱敏编号" />
            </Form.Item>
            <Form.Item label="发证/出具机构" name="issuer">
              <Input placeholder="请输入机构名称，可填写脱敏机构" />
            </Form.Item>
            <Form.Item label="适用投标场景" name="applicable_sections">
              <Select mode="multiple" placeholder="选择场景" options={['资格审查资料', '商务响应文件', '企业概况', '发包人提供的资料', '项目业绩'].map(value => ({ label: value, value }))} />
            </Form.Item>
            <Form.Item label="检索标签" name="tags">
              <Select mode="tags" placeholder="例如：资质证书、安全生产许可证、资格审查" />
            </Form.Item>
            <Form.Item label="图片/附件说明" name="description" rules={[{ required: true, message: '请输入图片说明，便于AI检索和插图' }]}>
              <Input.TextArea rows={3} placeholder="说明该证照适合出现在哪类标书章节、是否为脱敏样张、使用注意事项等" />
            </Form.Item>
            <Form.Item label="图片/附件文件" required>
              <Upload
                maxCount={1}
                beforeUpload={(file) => {
                  setAssetFile(file);
                  return false;
                }}
                onRemove={() => setAssetFile(null)}
                accept="image/*,.pdf,.doc,.docx"
              >
                <Button icon={<UploadCloud size={16} />}>选择证照图片或附件</Button>
              </Upload>
            </Form.Item>
            <Form.Item label="允许自动插入标书" name="allowed_for_bid" valuePropName="checked" initialValue>
              <Switch checkedChildren="允许" unCheckedChildren="仅检索" />
            </Form.Item>
            <Form.Item label="敏感资料" name="is_sensitive" valuePropName="checked" initialValue={false}>
              <Switch checkedChildren="敏感" unCheckedChildren="普通" />
            </Form.Item>
            <Form.Item label="使用备注" name="usage_note">
              <Input placeholder="例如：正式投标前需替换为企业真实证照扫描件" />
            </Form.Item>
            <Button block type="primary" loading={saving} onClick={saveQualificationAsset}>保存资信信息</Button>
          </Form>
        </section>
      </div>

      <Modal title="资信文件详情" open={Boolean(detail)} onCancel={() => setDetail(null)} footer={<Button onClick={() => setDetail(null)}>关闭</Button>} width={860}>
        {detail ? (
          <div className="grid gap-4 md:grid-cols-[260px_1fr]">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              {detail.public_url ? <Image src={detail.public_url} alt={detail.title} className="rounded-lg object-contain" /> : <Empty description="无图片" />}
            </div>
            <Descriptions size="small" bordered column={1}>
              <Descriptions.Item label="文件名称">{detail.title}</Descriptions.Item>
              <Descriptions.Item label="分类">{inferQualificationCategory(detail)}</Descriptions.Item>
              <Descriptions.Item label="说明">{detail.description || '-'}</Descriptions.Item>
              <Descriptions.Item label="适用章节">{(detail.applicable_sections || []).join('、') || '-'}</Descriptions.Item>
              <Descriptions.Item label="标签">{(detail.tags || []).join('、') || '-'}</Descriptions.Item>
              <Descriptions.Item label="来源">{detail.source_url ? <a href={detail.source_url} target="_blank" rel="noreferrer">查看来源</a> : '脱敏样张'}</Descriptions.Item>
              <Descriptions.Item label="合规说明">{detail.is_synthetic ? '脱敏合成样张，仅用于测试和排版占位，不可替代正式法定资质文件。' : '公开来源素材，使用前需复核授权。'}</Descriptions.Item>
            </Descriptions>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
