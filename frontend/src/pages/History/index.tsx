import { Button, Empty, Input, Popconfirm, Select, Space, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AlertTriangle, ClipboardList, FileClock, Search, SquarePen, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../api/client';
import { CategoryList } from '../../components/common/CategoryList';
import { MetricCards } from '../../components/common/MetricCards';
import { ModuleHeader } from '../../components/common/ModuleHeader';

interface HistoryItem {
  id: string;
  project_name?: string | null;
  project_no?: string | null;
  tender_unit?: string | null;
  agency?: string | null;
  project_type?: string | null;
  status?: string | null;
  stage?: string;
  action?: string;
  analysis_count?: number;
  requirement_count?: number;
  risk_count?: number;
  section_count?: number;
  chunk_count?: number;
  file_count?: number;
  parse_status?: string | null;
  latest_file_name?: string | null;
  created_at?: string | null;
}

const stageColor: Record<string, string> = {
  已上传: 'cyan',
  解析完成: 'purple',
  解析中: 'processing',
  解析失败: 'red',
  解读完成: 'blue',
  标书编制: 'green',
  failed: 'red',
};

function formatDate(value?: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function HistoryPage(): JSX.Element {
  const navigate = useNavigate();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeStage, setActiveStage] = useState('全部记录');
  const [keyword, setKeyword] = useState('');

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const { data } = await apiClient.get<{ items: HistoryItem[] }>('/api/bidding/history', {
        skipGlobalLoading: true,
      });
      setItems(data.items || []);
    } catch (error: any) {
      message.error(error.message || '获取历史记录失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const stageCategories = useMemo(() => {
    const counts = items.reduce<Record<string, number>>((acc, item) => {
      const stage = item.stage || '已上传';
      acc[stage] = (acc[stage] || 0) + 1;
      return acc;
    }, {});
    const order = ['已上传', '解析完成', '解读完成', '标书编制'];
    return [
      { name: '全部记录', count: items.length },
      ...order.filter(stage => counts[stage]).map(stage => ({ name: stage, count: counts[stage] })),
      ...Object.keys(counts).filter(stage => !order.includes(stage)).map(stage => ({ name: stage, count: counts[stage] })),
    ];
  }, [items]);

  const filteredItems = useMemo(() => {
    const lowered = keyword.trim().toLowerCase();
    return items.filter(item => {
      const stageMatched = activeStage === '全部记录' || item.stage === activeStage;
      const keywordMatched = !lowered || [
        item.project_name,
        item.project_no,
        item.tender_unit,
        item.agency,
        item.project_type,
      ].some(value => (value || '').toLowerCase().includes(lowered));
      return stageMatched && keywordMatched;
    });
  }, [activeStage, items, keyword]);

  const openRecord = (record: HistoryItem) => {
    if (!record.id) return;
    if ((record.section_count || 0) > 0 || record.stage === '标书编制') {
      window.location.href = `/bid-editor?projectId=${record.id}`;
      return;
    }
    navigate(`/interpretation?projectId=${record.id}`);
  };

  const deleteRecord = async (record: HistoryItem) => {
    try {
      await apiClient.delete(`/api/bidding/history/${record.id}`, { skipGlobalLoading: true });
      message.success('历史任务已删除');
      await fetchHistory();
    } catch (error: any) {
      message.error(error.message || '删除历史任务失败');
    }
  };

  const columns: ColumnsType<HistoryItem> = [
    {
      title: '项目名称',
      dataIndex: 'project_name',
      width: 230,
      ellipsis: true,
      render: (value, record) => (
        <div className="min-w-0">
          <div className="truncate font-semibold text-slate-900">{value || '未命名招标项目'}</div>
          {record.latest_file_name ? <div className="truncate text-xs text-slate-500">{record.latest_file_name}</div> : null}
        </div>
      ),
    },
    { title: '项目编号', dataIndex: 'project_no', width: 130, ellipsis: true, render: value => value || '-' },
    { title: '招标单位', dataIndex: 'tender_unit', width: 140, ellipsis: true, render: value => value || '-' },
    { title: '项目类型', dataIndex: 'project_type', width: 100, ellipsis: true, render: value => value || '-' },
    {
      title: '当前阶段',
      dataIndex: 'stage',
      width: 115,
      render: stage => <Tag color={stageColor[stage as string] || 'default'}>{stage || '已上传'}</Tag>,
    },
    {
      title: '解析状态',
      dataIndex: 'parse_status',
      width: 135,
      render: value => <Tag>{value || '-'}</Tag>,
    },
    {
      title: '解析数据',
      width: 150,
      render: (_, record) => (
        <Space size={4} wrap>
          <Tag>需求 {record.requirement_count || 0}</Tag>
          <Tag>风险 {record.risk_count || 0}</Tag>
          <Tag>章节 {record.section_count || 0}</Tag>
        </Space>
      ),
    },
    { title: '创建时间', dataIndex: 'created_at', width: 150, render: formatDate },
    {
      title: '操作',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <Space size={2}>
          <Button type="link" size="small" onClick={() => openRecord(record)}>
            {record.action || '查看'}
          </Button>
          <Popconfirm title="确认删除该历史任务？" description="会删除项目记录和已解析的结构化数据。" okText="删除" cancelText="取消" onConfirm={() => deleteRecord(record)}>
            <Button type="link" danger size="small" icon={<Trash2 size={14} />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="module-shell">
      <ModuleHeader
        title="历史记录"
        description="集中查看上传过的招标文件、解析结果、招标解读和标书编制进度，便于继续处理和追溯。"
        actions={
          <Space>
            <Input
              allowClear
              prefix={<Search size={16} />}
              placeholder="搜索项目名称、编号、招标单位"
              value={keyword}
              onChange={event => setKeyword(event.target.value)}
              className="w-80"
            />
            <Button onClick={fetchHistory}>刷新记录</Button>
          </Space>
        }
      />

      <MetricCards
        items={[
          { title: '历史项目', value: items.length, desc: '已入库招标项目', icon: FileClock, colorClass: 'bg-blue-50 text-blue-600' },
          { title: '已解读', value: items.filter(item => (item.analysis_count || 0) > 0).length, desc: '存在结构化解读', icon: ClipboardList, colorClass: 'bg-emerald-50 text-emerald-600' },
          { title: '编制中', value: items.filter(item => (item.section_count || 0) > 0).length, desc: '已生成章节大纲', icon: SquarePen, colorClass: 'bg-violet-50 text-violet-600' },
          { title: '风险项', value: items.reduce((sum, item) => sum + (item.risk_count || 0), 0), desc: '累计识别风险', icon: AlertTriangle, colorClass: 'bg-orange-50 text-orange-500' },
        ]}
      />

      <div className="grid min-h-0 grid-cols-[250px_1fr] gap-4">
        <CategoryList title="记录阶段" items={stageCategories} activeName={activeStage} onChange={setActiveStage} />
        <section className="panel-card h-full">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="panel-title mb-0">历史任务列表</h2>
            <Select
              value={activeStage}
              onChange={setActiveStage}
              className="w-40"
              options={stageCategories.map(item => ({ label: item.name, value: item.name }))}
            />
          </div>
          <Table
            rowKey="id"
            size="small"
            pagination={{ pageSize: 12 }}
            columns={columns}
            dataSource={filteredItems}
            loading={loading}
            className="compact-table"
            scroll={{ x: 1180 }}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无历史记录，上传招标文件后会显示在这里" /> }}
          />
        </section>
      </div>
    </div>
  );
}
