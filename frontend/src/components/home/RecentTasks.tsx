import { Button, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useBidProjectStore } from '../../stores/bidProjectStore';
import type { RecentTask } from '../../types/bid';

const statusColor: Record<RecentTask['status'], string> = {
  待编辑: 'orange',
  生成中: 'blue',
  已导出: 'green',
  解析完成: 'purple',
  已上传: 'cyan',
};

export function RecentTasks(): JSX.Element {
  const recentTasks = useBidProjectStore(state => state.recentTasks);

  const columns: ColumnsType<RecentTask> = [
    { title: '项目名称', dataIndex: 'projectName', ellipsis: true },
    { title: '招标单位', dataIndex: 'tenderUnit', width: 120, ellipsis: true },
    { title: '创建时间', dataIndex: 'createdAt', width: 145 },
    {
      title: '当前状态',
      dataIndex: 'status',
      width: 90,
      render: status => <Tag color={statusColor[status as RecentTask['status']]}>{status}</Tag>,
    },
    {
      title: '操作',
      dataIndex: 'action',
      width: 70,
      render: action => <Button type="link">{action}</Button>,
    },
  ];

  return (
    <section className="panel-card">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="panel-title mb-0">最近任务</h2>
        <Button type="link">查看全部 &gt;</Button>
      </div>
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        columns={columns}
        dataSource={recentTasks}
        className="compact-table"
      />
    </section>
  );
}
