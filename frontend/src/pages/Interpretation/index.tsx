import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Descriptions, Empty, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AlertTriangle, ClipboardCheck, FileSearch, Layers3, ListChecks, RefreshCw, ShieldAlert } from 'lucide-react';
import { getLatestInterpretation } from '../../api/bidProject';
import { MetricCards } from '../../components/common/MetricCards';
import { ModuleHeader } from '../../components/common/ModuleHeader';
import type {
  ChapterSuggestion,
  DocumentChunk,
  InterpretationResponse,
  RequirementItem,
  RiskItem,
  ScoringItem,
} from '../../types/interpretation';

const priorityColor: Record<string, string> = {
  high: 'red',
  medium: 'orange',
  low: 'blue',
};

const riskColor: Record<string, string> = {
  high: 'red',
  medium: 'orange',
  low: 'blue',
};

function pageText(page?: number | null): string {
  return page ? `第 ${page} 页` : '-';
}

function emptyText(description: string): JSX.Element {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} />;
}

export function InterpretationPage(): JSX.Element {
  const [data, setData] = useState<InterpretationResponse | null>(null);

  async function load(): Promise<void> {
    try {
      const result = await getLatestInterpretation();
      setData(result);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      message.error(reason);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const projectMeta = data?.analysis?.project_meta || {};
  const metrics = useMemo(
    () => [
      { title: '要求条款', value: data?.requirements.length ?? 0, desc: '资格/商务/技术/文件', icon: ListChecks, colorClass: 'bg-blue-50 text-blue-600' },
      { title: '风险条款', value: data?.risks.length ?? 0, desc: '否决/无效/合规风险', icon: ShieldAlert, colorClass: 'bg-rose-50 text-rose-600' },
      { title: '评分项', value: data?.scoringItems.length ?? 0, desc: '评分办法初步拆解', icon: ClipboardCheck, colorClass: 'bg-emerald-50 text-emerald-600' },
      { title: '文档分片', value: data?.documentChunks.length ?? 0, desc: 'MinerU 内容块落库', icon: Layers3, colorClass: 'bg-violet-50 text-violet-600' },
    ],
    [data],
  );

  const requirementColumns: ColumnsType<RequirementItem> = [
    { title: '类型', dataIndex: 'requirement_type', width: 98, render: value => <Tag color="blue">{value || '要求'}</Tag> },
    { title: '优先级', dataIndex: 'priority', width: 82, render: value => <Tag color={priorityColor[String(value)] || 'default'}>{value || '-'}</Tag> },
    { title: '内容', dataIndex: 'content', ellipsis: true },
    { title: '章节', dataIndex: 'source_section', width: 160, ellipsis: true },
    { title: '页码', dataIndex: 'source_page', width: 78, render: pageText },
  ];

  const riskColumns: ColumnsType<RiskItem> = [
    { title: '等级', dataIndex: 'risk_level', width: 82, render: value => <Tag color={riskColor[String(value)] || 'default'}>{value || '-'}</Tag> },
    { title: '类型', dataIndex: 'risk_type', width: 120, ellipsis: true },
    { title: '风险内容', dataIndex: 'content', ellipsis: true },
    { title: '处理建议', dataIndex: 'action', width: 220, ellipsis: true },
    { title: '页码', dataIndex: 'source_page', width: 78, render: pageText },
  ];

  const scoringColumns: ColumnsType<ScoringItem> = [
    { title: '分类', dataIndex: 'category', width: 100 },
    { title: '评分项', dataIndex: 'item', ellipsis: true },
    { title: '分值', dataIndex: 'score', width: 76, render: value => (value ? `${value} 分` : '-') },
    { title: '响应建议', dataIndex: 'response_suggestion', width: 260, ellipsis: true },
    { title: '页码', dataIndex: 'source_page', width: 78, render: pageText },
  ];

  const chapterColumns: ColumnsType<ChapterSuggestion> = [
    { title: '建议章节', dataIndex: 'chapter_title', ellipsis: true },
    { title: '优先级', dataIndex: 'priority', width: 88, render: value => <Tag color={priorityColor[String(value)] || 'default'}>{value || '-'}</Tag> },
    { title: '建议原因', dataIndex: 'reason', width: 360, ellipsis: true },
  ];

  const chunkColumns: ColumnsType<DocumentChunk> = [
    { title: '序号', dataIndex: 'chunk_index', width: 76 },
    { title: '章节', dataIndex: 'source_section', width: 180, ellipsis: true },
    { title: '页码', dataIndex: 'source_page', width: 78, render: pageText },
    { title: '内容片段', dataIndex: 'content', ellipsis: true },
  ];

  return (
    <div className="interpretation-shell">
      <ModuleHeader
        title="招标文件解读"
        description="基于 MinerU 解析产物和 Supabase 结构化数据，展示项目概况、要求条款、评分项、风险项和建议章节。"
        actions={
          <Button type="primary" icon={<RefreshCw size={16} />} onClick={() => void load()}>
            刷新解读
          </Button>
        }
      />
      <MetricCards items={metrics} />

      {!data?.analysis ? (
        <section className="panel-card">
          <Alert
            type="info"
            showIcon
            icon={<FileSearch size={18} />}
            message="暂无可展示的招标解读"
            description="请先上传招标文件并等待 MinerU 解析、结构化落库完成。"
          />
        </section>
      ) : (
        <>
          <section className="panel-card">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="panel-title mb-0">项目概况</h2>
              <Space size={6}>
                <Tag color="blue">{data.project?.status || '已解析'}</Tag>
                <Tag color="purple">{String(projectMeta.tender_no || data.project?.project_no || '暂无编号')}</Tag>
              </Space>
            </div>
            <Descriptions size="small" column={4} bordered>
              <Descriptions.Item label="项目名称" span={2}>
                {String(projectMeta.project_name || data.project?.project_name || '-')}
              </Descriptions.Item>
              <Descriptions.Item label="招标编号">{String(projectMeta.tender_no || data.project?.project_no || '-')}</Descriptions.Item>
              <Descriptions.Item label="项目类型">{String(data.project?.project_type || projectMeta.document_type || '-')}</Descriptions.Item>
              <Descriptions.Item label="招标人">{data.project?.tender_unit || '-'}</Descriptions.Item>
              <Descriptions.Item label="代理机构">{data.project?.agency || '-'}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{data.project?.created_at || '-'}</Descriptions.Item>
              <Descriptions.Item label="解读摘要" span={4}>
                {data.analysis.summary || '-'}
              </Descriptions.Item>
            </Descriptions>
          </section>

          <section className="panel-card interpretation-main">
            <Tabs
              size="small"
              items={[
                {
                  key: 'requirements',
                  label: '要求条款',
                  children: (
                    <Table rowKey="id" size="small" pagination={{ pageSize: 10 }} columns={requirementColumns} dataSource={data.requirements} className="compact-table" locale={{ emptyText: emptyText('暂无要求条款') }} />
                  ),
                },
                {
                  key: 'risks',
                  label: (
                    <span className="inline-flex items-center gap-1">
                      <AlertTriangle size={14} />
                      风险项
                    </span>
                  ),
                  children: <Table rowKey="id" size="small" pagination={{ pageSize: 10 }} columns={riskColumns} dataSource={data.risks} className="compact-table" locale={{ emptyText: emptyText('暂无风险项') }} />,
                },
                {
                  key: 'scoring',
                  label: '评分项',
                  children: <Table rowKey="id" size="small" pagination={{ pageSize: 10 }} columns={scoringColumns} dataSource={data.scoringItems} className="compact-table" locale={{ emptyText: emptyText('暂无评分项') }} />,
                },
                {
                  key: 'chapters',
                  label: '建议章节',
                  children: <Table rowKey="id" size="small" pagination={{ pageSize: 10 }} columns={chapterColumns} dataSource={data.chapterSuggestions} className="compact-table" locale={{ emptyText: emptyText('暂无建议章节') }} />,
                },
                {
                  key: 'chunks',
                  label: '原文分片',
                  children: <Table rowKey="id" size="small" pagination={{ pageSize: 8 }} columns={chunkColumns} dataSource={data.documentChunks} className="compact-table" locale={{ emptyText: emptyText('暂无原文分片') }} />,
                },
              ]}
            />
          </section>

          <section className="panel-card interpretation-note">
            <Typography.Text strong>当前说明</Typography.Text>
            <Typography.Text type="secondary">
              这一版先用规则抽取建立业务数据链路，适合做解读展示和后续生成输入。下一步可接入大模型，对资格条件、评分点和否决条款做更精细的分类与原文引用。
            </Typography.Text>
          </section>
        </>
      )}
    </div>
  );
}
