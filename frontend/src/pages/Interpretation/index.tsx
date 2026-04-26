import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Empty, List, Progress, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AlertTriangle, BrainCircuit, CheckCircle2, ClipboardCheck, Eye, FileSearch, FileText, ListChecks, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { generateAIInterpretation, getLatestInterpretation } from '../../api/bidProject';
import { MetricCards } from '../../components/common/MetricCards';
import { ModuleHeader } from '../../components/common/ModuleHeader';
import type {
  ChapterSuggestion,
  BidOutline,
  BidOutlineChapter,
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

type SourceTrace = {
  title: string;
  category: string;
  sourcePage?: number | null;
  sourceSection?: string | null;
  sourceText?: string | null;
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

function asBidOutline(meta: Record<string, unknown>): BidOutline | null {
  return (meta.bid_outline || null) as BidOutline | null;
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

function SourceButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <Button type="link" size="small" icon={<Eye size={14} />} onClick={onClick}>
      依据
    </Button>
  );
}

export function InterpretationPage(): JSX.Element {
  const navigate = useNavigate();
  const [data, setData] = useState<InterpretationResponse | null>(null);
  const [generatingAI, setGeneratingAI] = useState(false);
  const [generatingOutline, setGeneratingOutline] = useState(false);
  const [sourceTrace, setSourceTrace] = useState<SourceTrace | null>(null);

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
  const bidOutline = asBidOutline(projectMeta);
  const mineruQuality = asQuality(projectMeta);
  const relatedChunks = useMemo(() => {
    if (!sourceTrace?.sourcePage || !data?.documentChunks.length) {
      return [];
    }
    return data.documentChunks.filter(chunk => chunk.source_page === sourceTrace.sourcePage).slice(0, 8);
  }, [data?.documentChunks, sourceTrace?.sourcePage]);
  const metrics = useMemo(
    () => [
      { title: '要求条款', value: data?.requirements.length ?? 0, desc: '资格/商务/技术/文件', icon: ListChecks, colorClass: 'bg-blue-50 text-blue-600' },
      { title: '风险条款', value: data?.risks.length ?? 0, desc: '否决/无效/合规风险', icon: ShieldAlert, colorClass: 'bg-rose-50 text-rose-600' },
      { title: '评分项', value: data?.scoringItems.length ?? 0, desc: '评分办法初步拆解', icon: ClipboardCheck, colorClass: 'bg-emerald-50 text-emerald-600' },
      { title: '标书章节', value: bidOutline?.chapters?.length ?? 0, desc: '目录与章节大纲', icon: FileText, colorClass: 'bg-violet-50 text-violet-600' },
    ],
    [bidOutline?.chapters?.length, data],
  );

  function openSourceTrace(trace: SourceTrace): void {
    setSourceTrace(trace);
  }

  const requirementColumns: ColumnsType<RequirementItem> = [
    { title: '类型', dataIndex: 'requirement_type', width: 98, render: value => <Tag color="blue">{value || '要求'}</Tag> },
    { title: '优先级', dataIndex: 'priority', width: 82, render: value => <Tag color={priorityColor[String(value)] || 'default'}>{value || '-'}</Tag> },
    { title: '内容', dataIndex: 'content', ellipsis: true },
    { title: '章节', dataIndex: 'source_section', width: 160, ellipsis: true },
    { title: '页码', dataIndex: 'source_page', width: 78, render: pageText },
    {
      title: '原文',
      width: 78,
      render: (_, record) => (
        <SourceButton
          onClick={() => openSourceTrace({
            title: record.content || record.title || '要求条款',
            category: '要求条款',
            sourcePage: record.source_page,
            sourceSection: record.source_section,
            sourceText: record.source_text || record.content,
          })}
        />
      ),
    },
  ];

  const riskColumns: ColumnsType<RiskItem> = [
    { title: '等级', dataIndex: 'risk_level', width: 82, render: value => <Tag color={riskColor[String(value)] || 'default'}>{value || '-'}</Tag> },
    { title: '类型', dataIndex: 'risk_type', width: 120, ellipsis: true },
    { title: '风险内容', dataIndex: 'content', ellipsis: true },
    { title: '处理建议', dataIndex: 'action', width: 220, ellipsis: true },
    { title: '页码', dataIndex: 'source_page', width: 78, render: pageText },
    {
      title: '原文',
      width: 78,
      render: (_, record) => (
        <SourceButton
          onClick={() => openSourceTrace({
            title: record.content || '风险项',
            category: '风险项',
            sourcePage: record.source_page,
            sourceSection: record.source_section,
            sourceText: record.source_text || record.content,
          })}
        />
      ),
    },
  ];

  const scoringColumns: ColumnsType<ScoringItem> = [
    { title: '分类', dataIndex: 'category', width: 100 },
    { title: '评分项', dataIndex: 'item', ellipsis: true },
    { title: '分值', dataIndex: 'score', width: 76, render: value => (value ? `${value} 分` : '-') },
    { title: '响应建议', dataIndex: 'response_suggestion', width: 260, ellipsis: true },
    { title: '页码', dataIndex: 'source_page', width: 78, render: pageText },
    {
      title: '原文',
      width: 78,
      render: (_, record) => (
        <SourceButton
          onClick={() => openSourceTrace({
            title: record.item || record.requirement || '评分项',
            category: '评分项',
            sourcePage: record.source_page,
            sourceSection: record.source_section,
            sourceText: record.source_text || record.requirement || record.item,
          })}
        />
      ),
    },
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
    {
      title: '查看',
      width: 78,
      render: (_, record) => (
        <SourceButton
          onClick={() => openSourceTrace({
            title: `原文分片 #${record.chunk_index}`,
            category: '原文分片',
            sourcePage: record.source_page,
            sourceSection: record.source_section,
            sourceText: record.content,
          })}
        />
      ),
    },
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

  async function generateOutline(): Promise<void> {
    if (!data?.project?.id) {
      message.warning('当前没有可生成章节大纲的项目');
      return;
    }
    setGeneratingOutline(true);
    try {
      navigate(`/bid-editor?projectId=${data.project.id}&autoGenerate=outline`);
    } finally {
      setGeneratingOutline(false);
    }
  }

  function renderOutlineList(items?: string[]): JSX.Element {
    if (!items?.length) {
      return <span className="muted-text">暂无</span>;
    }
    return (
      <ul>
        {items.slice(0, 6).map((item, index) => (
          <li key={`${item}-${index}`}>{item}</li>
        ))}
      </ul>
    );
  }

  function renderBidOutline(outline: BidOutline | null): JSX.Element {
    if (!outline?.chapters?.length) {
      return (
        <div className="outline-empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无标书章节大纲" />
          <Button type="primary" icon={<FileText size={16} />} loading={generatingOutline} onClick={() => void generateOutline()}>
            生成章节大纲
          </Button>
        </div>
      );
    }

    return (
      <div className="outline-panel">
        <section className="outline-summary">
          <div>
            <span>标书章节大纲</span>
            <h3>{outline.project_name || String(projectMeta.project_name || data?.project?.project_name || '投标文件')}</h3>
            <p>{outline.summary || '基于招标解读结果生成的投标文件章节目录和章节编写要点。'}</p>
          </div>
          <Space size={8} wrap>
            <Tag color="blue">{outline.version || 'v1'}</Tag>
            <Tag>{outline.generated_at || '未记录时间'}</Tag>
          </Space>
        </section>
        <div className="outline-chapters">
          {outline.chapters.map((chapter: BidOutlineChapter, index) => (
            <article className="outline-chapter-card" key={`${chapter.order || index}-${chapter.title}`}>
              <header>
                <div>
                  <span>{String(chapter.order || index + 1).padStart(2, '0')}</span>
                  <h3>{chapter.title || '未命名章节'}</h3>
                </div>
                <Tag color={priorityColor[String(chapter.priority)] || 'default'}>{chapter.priority || 'medium'}</Tag>
              </header>
              <p>{chapter.purpose || '需人工补充章节目标。'}</p>
              <div className="outline-detail-grid">
                <section>
                  <h4>响应要点</h4>
                  {renderOutlineList(chapter.response_points)}
                </section>
                <section>
                  <h4>关联要求</h4>
                  {renderOutlineList(chapter.mapped_requirements)}
                </section>
                <section>
                  <h4>评分/风险</h4>
                  {renderOutlineList([...(chapter.mapped_scoring_items || []), ...(chapter.mapped_risks || [])])}
                </section>
                <section>
                  <h4>准备资料</h4>
                  {renderOutlineList(chapter.required_materials)}
                </section>
              </div>
              <footer>
                <Space size={6} wrap>
                  {(chapter.source_pages || []).slice(0, 8).map(page => <Tag key={page}>{pageText(page)}</Tag>)}
                  {!chapter.source_pages?.length ? <Tag>来源需复核</Tag> : null}
                </Space>
                <Button
                  size="small"
                  icon={<Eye size={14} />}
                  onClick={() => openSourceTrace({
                    title: chapter.title || '标书章节大纲',
                    category: '标书章节',
                    sourcePage: chapter.source_pages?.[0],
                    sourceSection: '章节大纲引用',
                    sourceText: [
                      chapter.purpose,
                      ...(chapter.response_points || []),
                      ...(chapter.mapped_requirements || []),
                      ...(chapter.writing_notes || []),
                    ].filter(Boolean).join('\n'),
                  })}
                >
                  查看依据
                </Button>
              </footer>
            </article>
          ))}
        </div>
        <section className="report-section report-wide">
          <h3>后续动作</h3>
          {renderOutlineList(outline.next_steps)}
        </section>
      </div>
    );
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
            <Button icon={<FileText size={16} />} loading={generatingOutline} disabled={!data?.analysis} onClick={() => void generateOutline()}>
              生成章节大纲
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
                          <section className="report-section report-wide">
                            <h3>一页式业务摘要</h3>
                            <ul>
                              {(aiReport.executive_summary || []).map((item, index) => <li key={`summary-${index}`}>{item}</li>)}
                            </ul>
                          </section>
                          <section className="report-section">
                            <h3>项目关键信息</h3>
                            <div className="brief-list">
                              <div><strong>项目名称</strong><span>{aiReport.project_brief?.project_name || '-'}</span></div>
                              <div><strong>招标编号</strong><span>{aiReport.project_brief?.tender_no || '-'}</span></div>
                              <div><strong>采购范围</strong><span>{aiReport.project_brief?.procurement_scope || '需人工复核'}</span></div>
                            </div>
                          </section>
                          <section className="report-section">
                            <h3>关键时间/节点</h3>
                            <ul>
                              {(aiReport.project_brief?.key_deadlines || []).map((item, index) => <li key={`deadline-${index}`}>{item}</li>)}
                            </ul>
                          </section>
                          <section className="report-section report-wide">
                            <h3>资格符合性核查</h3>
                            <div className="ai-card-list">
                              {(aiReport.qualification_review || []).map((item, index) => (
                                <article key={`qualification-${index}`} className="ai-evidence-card">
                                  <div>
                                    <Tag color={item.judgement === '风险较高' ? 'red' : 'blue'}>{item.judgement || '需复核'}</Tag>
                                    <strong>{item.requirement || '资格要求'}</strong>
                                  </div>
                                  <p>{item.evidence || '暂无原文依据摘要'}</p>
                                  <footer>
                                    <span>{pageText(item.source_page)}</span>
                                    <Button
                                      size="small"
                                      icon={<Eye size={14} />}
                                      onClick={() => openSourceTrace({
                                        title: item.requirement || '资格符合性核查',
                                        category: 'AI资格核查',
                                        sourcePage: item.source_page,
                                        sourceSection: 'AI 解读引用',
                                        sourceText: item.evidence || item.action || item.requirement,
                                      })}
                                    >
                                      查看依据
                                    </Button>
                                  </footer>
                                  <small>动作：{item.action || '需人工确认'}</small>
                                </article>
                              ))}
                            </div>
                          </section>
                          <section className="report-section report-wide">
                            <h3>评分高分策略</h3>
                            <div className="ai-card-list">
                              {(aiReport.scoring_strategy || []).map((item, index) => (
                                <article key={`scoring-${index}`} className="ai-evidence-card">
                                  <div>
                                    <Tag color="green">{item.score ? `${item.score} 分` : '分值待复核'}</Tag>
                                    <strong>{item.scoring_point || '评分项'}</strong>
                                  </div>
                                  <p>{item.strategy || '-'}</p>
                                  <p className="muted-text">材料：{(item.supporting_materials || []).join('、') || '需人工复核'}</p>
                                  <footer>
                                    <span>{pageText(item.source_page)}</span>
                                    <Button
                                      size="small"
                                      icon={<Eye size={14} />}
                                      onClick={() => openSourceTrace({
                                        title: item.scoring_point || '评分高分策略',
                                        category: 'AI评分策略',
                                        sourcePage: item.source_page,
                                        sourceSection: 'AI 解读引用',
                                        sourceText: item.evidence || item.strategy || item.scoring_point,
                                      })}
                                    >
                                      查看依据
                                    </Button>
                                  </footer>
                                </article>
                              ))}
                            </div>
                          </section>
                          <section className="report-section report-wide">
                            <h3>废标/否决风险</h3>
                            <div className="ai-card-list">
                              {(aiReport.risk_warnings || []).map((item, index) => (
                                <article key={`risk-${index}`} className="ai-evidence-card">
                                  <div>
                                    <Tag color={riskColor[item.risk_level || 'medium'] || 'orange'}>{item.risk_level || 'medium'}</Tag>
                                    <strong>{item.risk || '风险项'}</strong>
                                  </div>
                                  <p>影响：{item.impact || '-'}</p>
                                  <p>应对：{item.mitigation || '-'}</p>
                                  <footer>
                                    <span>{pageText(item.source_page)}</span>
                                    <Button
                                      size="small"
                                      icon={<Eye size={14} />}
                                      onClick={() => openSourceTrace({
                                        title: item.risk || '废标/否决风险',
                                        category: 'AI风险提示',
                                        sourcePage: item.source_page,
                                        sourceSection: 'AI 解读引用',
                                        sourceText: item.evidence || item.impact || item.mitigation || item.risk,
                                      })}
                                    >
                                      查看依据
                                    </Button>
                                  </footer>
                                </article>
                              ))}
                            </div>
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
                          <TextList title="下一步动作" items={aiReport.next_actions} />
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
                  key: 'bid-outline',
                  label: (
                    <span className="inline-flex items-center gap-1">
                      <FileText size={14} />
                      标书章节
                    </span>
                  ),
                  children: renderBidOutline(bidOutline),
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
              当前解读已支持原文溯源。业务人员可从要求、风险、评分项和 AI 报告中打开依据，核对页码、章节和 MinerU 原文分片。
            </Typography.Text>
          </section>
        </>
      )}
      <Drawer
        title="原文依据"
        width={640}
        open={Boolean(sourceTrace)}
        onClose={() => setSourceTrace(null)}
      >
        {sourceTrace ? (
          <div className="source-drawer">
            <Space size={8} wrap>
              <Tag color="blue">{sourceTrace.category}</Tag>
              <Tag>{pageText(sourceTrace.sourcePage)}</Tag>
              <Tag>{sourceTrace.sourceSection || '暂无章节'}</Tag>
            </Space>
            <h3>{sourceTrace.title}</h3>
            <section>
              <h4>直接依据</h4>
              <p>{sourceTrace.sourceText || '当前条目没有保存独立原文片段，请结合下方同页分片复核。'}</p>
            </section>
            <section>
              <h4>同页 MinerU 分片</h4>
              {relatedChunks.length ? (
                <List
                  size="small"
                  dataSource={relatedChunks}
                  renderItem={chunk => (
                    <List.Item>
                      <article className="chunk-preview">
                        <div>
                          <strong>#{chunk.chunk_index}</strong>
                          <span>{chunk.source_section || '未识别章节'}</span>
                        </div>
                        <p>{chunk.content}</p>
                      </article>
                    </List.Item>
                  )}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无同页分片" />
              )}
            </section>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
