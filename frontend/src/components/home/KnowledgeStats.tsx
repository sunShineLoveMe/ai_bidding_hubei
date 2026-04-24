import { BookOpen, Box, Clock3, ShieldCheck } from 'lucide-react';

const stats = [
  { title: '企业知识库文件数', value: 128, desc: '文档、模板、制度等资料', icon: BookOpen, color: 'bg-blue-50 text-blue-600' },
  { title: '企业资信库文件数', value: 46, desc: '资质证书、荣誉、业绩等', icon: ShieldCheck, color: 'bg-emerald-50 text-emerald-600' },
  { title: '企业产品库资料数', value: 32, desc: '产品介绍、参数、案例等', icon: Box, color: 'bg-orange-50 text-orange-500' },
  { title: '历史任务数', value: 18, desc: '已完成的标书任务总数', icon: Clock3, color: 'bg-violet-50 text-violet-600' },
] as const;

export function KnowledgeStats(): JSX.Element {
  return (
    <section className="panel-card">
      <h2 className="panel-title">知识库状态</h2>
      <div className="grid grid-cols-4 gap-3 max-[1500px]:grid-cols-2">
        {stats.map(item => {
          const Icon = item.icon;
          return (
            <article key={item.title} className="flex min-h-28 items-center gap-4 rounded-xl border border-slate-100 bg-white px-4 py-4 shadow-[0_6px_14px_rgba(23,42,88,0.035)]">
              <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${item.color}`}>
                <Icon size={22} />
              </div>
              <div className="min-w-0">
                <small className="block truncate text-xs font-bold text-slate-500">{item.title}</small>
                <strong className="my-1 block text-2xl leading-none text-slate-950">{item.value}</strong>
                <small className="block truncate text-xs font-semibold text-slate-500">{item.desc}</small>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
