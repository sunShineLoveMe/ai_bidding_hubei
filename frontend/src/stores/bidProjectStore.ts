import { create } from 'zustand';
import type { RecentTask } from '../types/bid';
import { formatNow } from '../utils/format';

interface BidProjectState {
  recentTasks: RecentTask[];
  addTask: (task: Omit<RecentTask, 'id' | 'createdAt'>) => void;
}

export const useBidProjectStore = create<BidProjectState>(set => ({
  recentTasks: [
    {
      id: 'sample-1',
      projectName: '智慧园区管理平台建设项目',
      tenderUnit: '某某科技园',
      createdAt: '2026-04-21 14:32',
      status: '待编辑',
      action: '查看',
    },
    {
      id: 'sample-2',
      projectName: '医疗信息化系统升级项目',
      tenderUnit: '某某医院',
      createdAt: '2026-04-20 09:18',
      status: '生成中',
      action: '继续',
    },
    {
      id: 'sample-3',
      projectName: '智慧停车平台项目',
      tenderUnit: '某某城投公司',
      createdAt: '2026-04-19 16:45',
      status: '已导出',
      action: '查看',
    },
    {
      id: 'sample-4',
      projectName: '能源管理系统采购项目',
      tenderUnit: '某某能源集团',
      createdAt: '2026-04-18 11:02',
      status: '解析完成',
      action: '生成',
    },
  ],
  addTask: task =>
    set(state => ({
      recentTasks: [
        {
          ...task,
          id: `${Date.now()}`,
          createdAt: formatNow(),
        },
        ...state.recentTasks,
      ].slice(0, 5),
    })),
}));
