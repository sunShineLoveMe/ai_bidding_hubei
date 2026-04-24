import { AlertTriangle, FileSearch, FileText, ListChecks } from 'lucide-react';

const tools = [
  {
    title: '招标文件解读',
    description: '提取项目基础信息、技术要求、商务要求、评分标准',
    icon: FileSearch,
    color: 'bg-blue-500',
  },
  {
    title: '评分项检查',
    description: '识别评分标准，检查内容覆盖情况',
    icon: ListChecks,
    color: 'bg-emerald-500',
  },
  {
    title: '废标项检查',
    description: '提示强制项与潜在废标风险',
    icon: AlertTriangle,
    color: 'bg-orange-400',
  },
  {
    title: 'Word 导出',
    description: '按固定模板导出可编辑 Word 文档',
    icon: FileText,
    color: 'bg-blue-700',
  },
] as const;

export function BasicTools(): JSX.Element {
  return (
    <section className="panel-card">
      <h2 className="panel-title">基础工具</h2>
      <div className="grid grid-cols-4 gap-3 max-[1500px]:grid-cols-2">
        {tools.map(tool => {
          const Icon = tool.icon;
          return (
            <article key={tool.title} className="flex min-h-44 min-w-0 flex-col items-center justify-center rounded-xl border border-slate-100 bg-white px-4 py-4 text-center shadow-[0_6px_14px_rgba(23,42,88,0.04)]">
              <div className={`mb-3 grid h-11 w-11 place-items-center rounded-xl text-white ${tool.color}`}>
                <Icon size={22} />
              </div>
              <strong className="mb-2 text-sm text-slate-900">{tool.title}</strong>
              <span className="text-xs font-semibold leading-5 text-slate-500">{tool.description}</span>
            </article>
          );
        })}
      </div>
    </section>
  );
}
