import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Descriptions, Empty, List, Progress, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AlertTriangle, BrainCircuit, CheckCircle2, ClipboardCheck, FileSearch, Layers3, ListChecks, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import { generateAIInterpretation, getLatestInterpretation } from '../../api/bidProject';
import { MetricCards } from '../../components/common/MetricCards';
import { ModuleHeader } from '../../components/common/ModuleHeader';
import type {
  ChapterSuggestion,
  DocumentChunk,
  AIInterpretationReport,
  InterpretationResponse,
  InterpretationReport,
  MinerUQuality,
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

function asReport(meta: Record<string, unknown>): InterpretationReport {
  return (meta.interpretation_report || {}) as InterpretationReport;
}

function asQuality(meta: Record<string, unknown>): MinerUQuality {
  return (meta.mineru_quality || {}) as MinerUQuality;
}

function asAIReport(meta: Record<string, unknown>): AIInterpretationReport | null {
  return (meta.ai_report || null) as AIInterpretationReport | null;
}

function TextList({ title, items }: { title: string; items?: string[] }): JSX.Element {
  return (
    <section className="report-section">
      <h3>{title}</h3>
      {items?.length ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${title}-${index}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无内容" />
      )}
    </section>
  );
}

export function InterpretationPage(): JSX.Element {
  const [data, setData] = useState<InterpretationResponse | null>(null);
  const [generatingAI, setGeneratingAI] = useState(false);

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
  const report = asReport(projectMeta);
  const aiReport = asAIReport(projectMeta);
  const mineruQuality = asQuality(projectMeta);
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

  const suspiciousColumns: ColumnsType<NonNullable<MinerUQuality['suspicious_blocks']>[number]> = [
    { title: '页码', dataIndex: 'page', width: 76, render: pageText },
    { title: '类型', dataIndex: 'type', width: 90 },
    { title: '原因', dataIndex: 'reason', width: 120 },
    { title: '片段', dataIndex: 'text', ellipsis: true },
  ];

  async function generateAIReport(): Promise<void> {
    if (!data?.project?.id) {
      message.warning('当前没有可生成 AI 解读的项目');
      return;
    }
    setGeneratingAI(true);
    try {
      await generateAIInterpretation(data.project.id);
      message.success('AI 深度解读已生成');
      await load();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      message.error(reason);
    } finally {
      setGeneratingAI(false);
    }
  }

  return (
    <div className="interpretation-shell">
      <ModuleHeader
        title="招标文件解读"
        description="基于 MinerU 解析产物和 Supabase 结构化数据，展示项目概况、要求条款、评分项、风险项和建议章节。"
        actions={
          <>
            <Button icon={<BrainCircuit size={16} />} loading={generatingAI} disabled={!data?.analysis} onClick={() => void generateAIReport()}>
              生成AI深度解读
            </Button>
            <Button type="primary" icon={<RefreshCw size={16} />} onClick={() => void load()}>
              刷新解读
            </Button>
          </>
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
                  key: 'report',
                  label: aiReport ? 'AI深度解读' : 'AI解读报告',
                  children: (
                    <div className="report-grid">
                      <section className="report-hero">
                        <div>
                          <span>{aiReport ? '大模型深度解读' : '规则版解读报告'}</span>
                          <h2>{aiReport?.project_brief?.project_name || report.title || String(projectMeta.project_name || data.project?.project_name || '招标文件')}</h2>
                          <p>{aiReport ? aiReport.project_brief?.core_conclusion || 'AI 已基于结构化条款生成业务解读。' : '当前报告基于 MinerU 解析结果和规则抽取生成，点击“生成AI深度解读”可获得更连贯的业务报告。'}</p>
                        </div>
                      </section>
                      {aiReport ? (
                        <>
                          <TextList title="一页式摘要" items={aiReport.executive_summary} />
                          <TextList title="关键时间/节点" items={aiReport.project_brief?.key_deadlines} />
                          <TextList title="下一步动作" items={aiReport.next_actions} />
                          <section className="report-section">
                            <h3>资格符合性核查</h3>
                            <ul>
                              {(aiReport.qualification_review || []).map((item, index) => (
                                <li key={`qualification-${index}`}>
                                  {item.requirement}；判断：{item.judgement || '需复核'}；动作：{item.action || '-'}；来源：{pageText(item.source_page)}
                                </li>
                              ))}
                            </ul>
                          </section>
                          <section className="report-section">
                            <h3>评分高分策略</h3>
                            <ul>
                              {(aiReport.scoring_strategy || []).map((item, index) => (
                                <li key={`scoring-${index}`}>
                                  {item.scoring_point}；策略：{item.strategy || '-'}；材料：{(item.supporting_materials || []).join('、') || '需复核'}
                                </li>
                              ))}
                            </ul>
                          </section>
                          <section className="report-section">
                            <h3>废标/否决风险</h3>
                            <ul>
                              {(aiReport.risk_warnings || []).map((item, index) => (
                                <li key={`risk-${index}`}>
                                  [{item.risk_level || 'medium'}] {item.risk}；影响：{item.impact || '-'}；应对：{item.mitigation || '-'}
                                </li>
                              ))}
                            </ul>
                          </section>
                          <section className="report-section">
                            <h3>投标文件编制建议</h3>
                            <ul>
                              {(aiReport.document_plan || []).map((item, index) => (
                                <li key={`plan-${index}`}>
                                  {item.chapter}：{item.purpose || '-'}；重点：{(item.key_points || []).join('、') || '-'}
                                </li>
                              ))}
                            </ul>
                          </section>
                          <section className="report-section">
                            <h3>材料准备清单</h3>
                            <ul>
                              {(aiReport.material_checklist || []).map((item, index) => (
                                <li key={`material-${index}`}>
                                  {item.material}（{item.category || '其他'}）；负责人：{item.owner || '需确认'}；说明：{item.note || '-'}
                                </li>
                              ))}
                            </ul>
                          </section>
                        </>
                      ) : (
                        <>
                          <TextList title="一页式摘要" items={report.executive_summary} />
                          <TextList title="资格核查重点" items={report.qualification_focus} />
                          <TextList title="商务响应重点" items={report.business_focus} />
                          <TextList title="技术响应重点" items={report.technical_focus} />
                          <TextList title="评分响应策略" items={report.scoring_strategy} />
                          <TextList title="重点风险提示" items={report.risk_focus} />
                          <TextList title="建议投标章节" items={report.chapter_plan} />
                          <TextList title="下一步动作" items={report.next_actions} />
                        </>
                      )}
                    </div>
                  ),
                },
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
                {
                  key: 'mineru',
                  label: 'MinerU校验',
                  children: (
                    <div className="mineru-check-grid">
                      <section className="quality-card">
                        <div className="quality-score">
                          <Progress type="circle" percent={mineruQuality.quality_score ?? 0} size={92} />
                          <div>
                            <h3>解析质量分</h3>
                            <p>用于快速判断 OCR、分片、页码和结构识别是否需要人工复核。</p>
                          </div>
                        </div>
                        <Descriptions size="small" column={2} bordered>
                          <Descriptions.Item label="Markdown 字符">{mineruQuality.markdown_chars ?? 0}</Descriptions.Item>
                          <Descriptions.Item label="内容块">{mineruQuality.content_blocks ?? 0}</Descriptions.Item>
                          <Descriptions.Item label="页数">{mineruQuality.page_count ?? 0}</Descriptions.Item>
                          <Descriptions.Item label="平均块长">{mineruQuality.avg_text_block_length ?? 0}</Descriptions.Item>
                        </Descriptions>
                      </section>
                      <section className="quality-card">
                        <h3>校验清单</h3>
                        <List
                          size="small"
                          dataSource={mineruQuality.checklist || []}
                          renderItem={item => (
                            <List.Item>
                              <span className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
                                {item.ok ? <CheckCircle2 size={16} className="text-emerald-500" /> : <XCircle size={16} className="text-rose-500" />}
                                {item.label}
                              </span>
                            </List.Item>
                          )}
                        />
                      </section>
                      <section className="quality-card">
                        <h3>内容块类型</h3>
                        <div className="quality-tags">
                          {Object.entries(mineruQuality.block_type_counts || {}).map(([name, count]) => (
                            <Tag key={name} color="blue">{name}: {count}</Tag>
                          ))}
                        </div>
                      </section>
                      <section className="quality-card">
                        <h3>解析产物路径</h3>
                        <div className="artifact-list">
                          {Object.entries(mineruQuality.artifacts || {}).map(([name, value]) => (
                            <div key={name}>
                              <strong>{name}</strong>
                              <span>{value || '-'}</span>
                            </div>
                          ))}
                        </div>
                      </section>
                      <section className="quality-card quality-wide">
                        <h3>可疑解析片段</h3>
                        <Table
                          rowKey={(_, index) => String(index)}
                          size="small"
                          pagination={{ pageSize: 6 }}
                          columns={suspiciousColumns}
                          dataSource={mineruQuality.suspicious_blocks || []}
                          className="compact-table"
                          locale={{ emptyText: emptyText('未发现明显可疑片段') }}
                        />
                      </section>
                    </div>
                  ),
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
