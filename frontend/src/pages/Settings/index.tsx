import { Button, Form, Input, InputNumber, Select, Switch, Tabs, Tag, message } from 'antd';
import { Bot, Database, FileText, HardDrive, KeyRound, RotateCcw, Save, ServerCog } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiClient } from '../../api/client';
import { MetricCards } from '../../components/common/MetricCards';
import { ModuleHeader } from '../../components/common/ModuleHeader';

interface RuntimeSettings {
  ai_provider: string;
  text_model: string;
  knowledge_model: string;
  embedding_model: string;
  request_timeout_seconds: number;
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
        description="配置模型服务、文件存储、向量库、Word 模板、OnlyOffice 地址和本地数据备份策略。"
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
                    <Form.Item label="Embedding 模型" name="embedding_model" rules={[{ required: true, message: '请输入 Embedding 模型' }]}>
                      <Input placeholder="text-embedding-v3" />
                    </Form.Item>
                    <Form.Item label="请求超时时间" name="request_timeout_seconds">
                      <InputNumber className="w-full" min={10} max={600} addonAfter="秒" />
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
