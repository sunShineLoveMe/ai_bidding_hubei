import type { LucideIcon } from 'lucide-react';

export interface MetricItem {
  title: string;
  value: string | number;
  desc: string;
  icon: LucideIcon;
  colorClass: string;
}

interface MetricCardsProps {
  items: MetricItem[];
}

export function MetricCards({ items }: MetricCardsProps): JSX.Element {
  return (
    <div className="grid h-24 grid-cols-4 gap-3">
      {items.map(item => {
        const Icon = item.icon;
        return (
          <article key={item.title} className="flex min-w-0 items-center gap-4 rounded-2xl border border-slate-200 bg-white px-4 shadow-soft">
            <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${item.colorClass}`}>
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
  );
}
