import { Button, Form, Input, InputNumber, Select, Switch, Tabs, Tag, message } from 'antd';
import { Bot, Building2, Database, FileText, HardDrive, KeyRound, RotateCcw, Save, ServerCog } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiClient } from '../../api/client';
import { MetricCards } from '../../components/common/MetricCards';
import { ModuleHeader } from '../../components/common/ModuleHeader';

interface RuntimeSettings {
  ai_provider: string;
  text_model: string;
  knowledge_model: string;
  embedding_model: string;
  embedding_dimensions: number;
  rerank_enabled: boolean;
  rerank_model: string;
  rerank_top_n: number;
  request_timeout_seconds: number;
  stream_connect_timeout_seconds: number;
  stream_read_timeout_seconds: number;
  upload_dir: string;
  output_dir: string;
  vector_store: string;
  chroma_dir: string;
  sqlite_db: string;
  onlyoffice_url: string;
  backend_public_url: string;
  word_template: string;
  online_editing_enabled: boolean;
  auto_backup_enabled: boolean;
  backup_frequency: string;
  backup_dir: string;
  enterprise_name: string;
  enterprise_region: string;
  enterprise_industry: string;
  enterprise_business_scope: string;
  enterprise_advantages: string;
  enterprise_target_customers: string;
  enterprise_response_style: string;
}

export function SettingsPage(): JSX.Element {
  const [form] = Form.useForm<RuntimeSettings>();
  const [defaults, setDefaults] = useState<RuntimeSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const { data } = await apiClient.get('/api/bidding/settings', { skipGlobalLoading: true });
      form.setFieldsValue(data.settings);
      setDefaults(data.defaults);
    } catch (error: any) {
      message.error(error.message || '读取系统设置失败');
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const { data } = await apiClient.post('/api/bidding/settings', { settings: values });
      form.setFieldsValue(data.settings);
      message.success(data.message || '系统设置已保存');
    } catch (error: any) {
      message.error(error.message || '保存系统设置失败');
    } finally {
      setSaving(false);
    }
  };

  const restoreDefaults = () => {
    if (defaults) {
      form.setFieldsValue(defaults);
      message.info('已恢复为默认值，点击“保存设置”后生效');
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  return (
    <div className="module-shell">
      <ModuleHeader
        title="系统设置"
        description="配置模型服务、企业画像、文件存储、向量库、Word 模板、OnlyOffice 地址和本地数据备份策略。"
        actions={
          <>
            <Button icon={<RotateCcw size={16} />} onClick={restoreDefaults} disabled={loading}>恢复默认</Button>
            <Button type="primary" icon={<Save size={16} />} loading={saving} onClick={saveSettings}>保存设置</Button>
          </>
        }
      />
      <MetricCards
        items={[
          { title: '模型服务', value: 'Qwen', desc: 'DashScope API', icon: Bot, colorClass: 'bg-blue-50 text-blue-600' },
          { title: '向量库', value: 'PGVector', desc: 'Supabase 持久化', icon: Database, colorClass: 'bg-emerald-50 text-emerald-600' },
          { title: '文档服务', value: 'Office', desc: 'OnlyOffice 预留', icon: FileText, colorClass: 'bg-violet-50 text-violet-600' },
          { title: '部署模式', value: '单机', desc: '内网部署', icon: HardDrive, colorClass: 'bg-orange-50 text-orange-500' },
        ]}
      />
      <section className="panel-card min-h-0">
        <Tabs
          className="settings-tabs"
          defaultActiveKey="model"
          items={[
            {
              key: 'model',
              label: '模型配置',
              children: (
                <div className="settings-grid">
                  <Form form={form} layout="vertical" size="middle" className="compact-form" disabled={loading}>
                    <Form.Item label="AI 提供方" name="ai_provider">
                      <Select options={[{ label: '阿里云百炼 DashScope', value: 'dashscope' }, { label: '内网私有化模型', value: 'private' }]} />
                    </Form.Item>
                    <Form.Item label="文本生成模型" name="text_model" rules={[{ required: true, message: '请输入文本生成模型' }]}>
                      <Input placeholder="qwen-turbo-latest" />
                    </Form.Item>
                    <Form.Item label="知识库问答模型" name="knowledge_model" rules={[{ required: true, message: '请输入知识库问答模型' }]}>
                      <Input placeholder="qwen-long" />
                    </Form.Item>
                    <Form.Item label="Embedding 模型" name="embedding_model" rules={[{ required: true, message: '请选择 Embedding 模型' }]}>
                      <Select
                        options={[
                          { label: 'text-embedding-v4（推荐，百炼新版通用向量）', value: 'text-embedding-v4' },
                          { label: 'text-embedding-v3（兼容旧索引）', value: 'text-embedding-v3' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item label="Embedding 维度" name="embedding_dimensions">
                      <InputNumber className="w-full" min={128} max={2048} addonAfter="维" />
                    </Form.Item>
                    <Form.Item label="启用 Rerank 重排" name="rerank_enabled" valuePropName="checked">
                      <Switch checkedChildren="启用" unCheckedChildren="关闭" />
                    </Form.Item>
                    <Form.Item label="Rerank 模型" name="rerank_model" rules={[{ required: true, message: '请选择 Rerank 模型' }]}>
                      <Select
                        options={[
                          { label: 'qwen3-rerank（推荐，文本知识库重排）', value: 'qwen3-rerank' },
                          { label: 'gte-rerank-v2（备选，传统文本重排）', value: 'gte-rerank-v2' },
                          { label: 'qwen3-vl-rerank（多模态重排预留）', value: 'qwen3-vl-rerank' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item label="Rerank TopN" name="rerank_top_n">
                      <InputNumber className="w-full" min={1} max={20} addonAfter="条" />
                    </Form.Item>
                    <Form.Item label="请求超时时间" name="request_timeout_seconds">
                      <InputNumber className="w-full" min={10} max={600} addonAfter="秒" />
                    </Form.Item>
                    <Form.Item label="流式连接超时" name="stream_connect_timeout_seconds">
                      <InputNumber className="w-full" min={5} max={120} addonAfter="秒" />
                    </Form.Item>
                    <Form.Item label="流式读取超时" name="stream_read_timeout_seconds">
                      <InputNumber className="w-full" min={30} max={900} addonAfter="秒" />
                    </Form.Item>
                  </Form>
                  <div className="settings-note">
                    <KeyRound size={22} />
                    <strong>敏感配置说明</strong>
                    <p>API Key 不在前端保存。生产环境请继续通过 `.env` 配置 `DASHSCOPE_API_KEY`，由 Flask 后端统一读取。</p>
                    <Tag color="blue">DASHSCOPE_API_KEY</Tag>
                    <Tag color="purple">DASHSCOPE_MODEL</Tag>
                    <Tag color="cyan">DASHSCOPE_KNOWLEDGE_MODEL</Tag>
                    <Tag color="green">DASHSCOPE_EMBEDDING_MODEL</Tag>
                    <Tag color="lime">DASHSCOPE_EMBEDDING_DIMENSIONS</Tag>
                    <Tag color="gold">DASHSCOPE_RERANK_MODEL</Tag>
                  </div>
                </div>
              ),
            },
            {
              key: 'enterprise',
              label: '企业画像',
              children: (
                <div className="settings-grid">
                  <Form form={form} layout="vertical" size="middle" className="compact-form" disabled={loading}>
                    <Form.Item label="企业名称" name="enterprise_name" rules={[{ required: true, message: '请输入企业名称或脱敏名称' }]}>
                      <Input placeholder="例如：某水利工程建设企业" />
                    </Form.Item>
                    <Form.Item label="所在区域" name="enterprise_region">
                      <Input placeholder="例如：华中地区" />
                    </Form.Item>
                    <Form.Item label="行业定位" name="enterprise_industry">
                      <Input placeholder="例如：水利水电工程建设与工程配套服务" />
                    </Form.Item>
                    <Form.Item label="业务范围" name="enterprise_business_scope">
                      <Input.TextArea rows={3} placeholder="例如：水利工程施工、机电设备配套、金属结构件、质量检验、现场服务" />
                    </Form.Item>
                    <Form.Item label="核心能力" name="enterprise_advantages">
                      <Input.TextArea rows={3} placeholder="例如：项目响应、质量安全管理、资料编制、供应链协同和现场履约能力" />
                    </Form.Item>
                    <Form.Item label="目标客户" name="enterprise_target_customers">
                      <Input.TextArea rows={2} placeholder="例如：建设单位、总承包单位、监理单位和设备供应链配套单位" />
                    </Form.Item>
                    <Form.Item label="AI 写作约束" name="enterprise_response_style">
                      <Input.TextArea rows={3} placeholder="例如：专业、严谨、合规；不得编造证书编号、人员姓名、合同金额和未提供的企业业绩" />
                    </Form.Item>
                  </Form>
                  <div className="settings-note">
                    <Building2 size={22} />
                    <strong>企业画像会参与 AI 生成</strong>
                    <p>招标解读、章节大纲、章节正文和旧版标书流程都会读取这里的企业画像，避免代码里写死某一家企业信息。</p>
                    <Tag color="blue">招标解读</Tag>
                    <Tag color="green">章节大纲</Tag>
                    <Tag color="purple">正文生成</Tag>
                    <Tag color="orange">开源脱敏</Tag>
                  </div>
                </div>
              ),
            },
            {
              key: 'storage',
              label: '存储路径',
              children: (
                <div className="settings-grid">
                  <Form form={form} layout="vertical" size="middle" className="compact-form" disabled={loading}>
                    <Form.Item label="上传文件目录" name="upload_dir">
                      <Input />
                    </Form.Item>
                    <Form.Item label="生成文件目录" name="output_dir">
                      <Input />
                    </Form.Item>
                    <Form.Item label="兼容 ChromaDB 目录" name="chroma_dir">
                      <Input />
                    </Form.Item>
                    <Form.Item label="SQLite 数据库" name="sqlite_db">
                      <Input />
                    </Form.Item>
                  </Form>
                  <div className="settings-note">
                    <Database size={22} />
                    <strong>单机版存储策略</strong>
                    <p>上传文件、生成文件、向量库和关系数据库均存放在本机目录，便于内网部署、备份和迁移。</p>
                  </div>
                </div>
              ),
            },
            {
              key: 'document',
              label: '文档与模板',
              children: (
                <div className="settings-grid">
                  <Form form={form} layout="vertical" size="middle" className="compact-form" disabled={loading}>
                    <Form.Item label="Word 模板" name="word_template">
                      <Input placeholder="templates/default_bid_template.docx" />
                    </Form.Item>
                    <Form.Item label="OnlyOffice 服务地址" name="onlyoffice_url">
                      <Input />
                    </Form.Item>
                    <Form.Item label="后端公开访问地址" name="backend_public_url">
                      <Input />
                    </Form.Item>
                    <Form.Item label="启用在线编辑" name="online_editing_enabled" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </Form>
                  <div className="settings-note">
                    <FileText size={22} />
                    <strong>导出策略</strong>
                    <p>第一版以生成可编辑 Word 为核心目标。OnlyOffice 在线编辑由后端生成 `editorConfig`，后续可放入独立编辑器页面。</p>
                  </div>
                </div>
              ),
            },
            {
              key: 'backup',
              label: '备份恢复',
              children: (
                <div className="settings-grid">
                  <Form form={form} layout="vertical" size="middle" className="compact-form" disabled={loading}>
                    <Form.Item label="自动备份" name="auto_backup_enabled" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                    <Form.Item label="备份周期" name="backup_frequency">
                      <Select options={[{ label: '每日', value: 'daily' }, { label: '每周', value: 'weekly' }, { label: '手动', value: 'manual' }]} />
                    </Form.Item>
                    <Form.Item label="备份目录" name="backup_dir">
                      <Input />
                    </Form.Item>
                    <Button type="primary" icon={<ServerCog size={16} />}>立即生成备份</Button>
                  </Form>
                  <div className="settings-note">
                    <HardDrive size={22} />
                    <strong>建议备份范围</strong>
                    <p>建议同时备份 `bidding.db`、`uploads/`、`outputs/`、`chroma_db/` 和 `.env` 的脱敏配置说明。</p>
                  </div>
                </div>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}
