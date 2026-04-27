import type { PropsWithChildren } from 'react';
import { BookOpen, Box, FileClock, FileSearch, Home, Settings, ShieldCheck } from 'lucide-react';
import { Button, Tag } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { GlobalLoading } from '../common/GlobalLoading';
import { BrandMark } from '../common/BrandMark';

const navItems = [
  { path: '/', label: '主页', icon: Home },
  { path: '/interpretation', label: '招标解读', icon: FileSearch },
  { path: '/knowledge', label: '企业知识库', icon: BookOpen },
  { path: '/qualification', label: '企业资信库', icon: ShieldCheck },
  { path: '/products', label: '企业产品库', icon: Box },
  { path: '/history', label: '历史记录', icon: FileClock },
] as const;

export function AppLayout({ children }: PropsWithChildren): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="h-screen overflow-hidden bg-slate-50 text-slate-950">
      <header className="fixed left-0 right-0 top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-7 shadow-[0_2px_12px_rgba(22,35,72,0.04)]">
        <div className="flex items-center gap-3 text-[26px] font-black tracking-normal">
          <BrandMark size={40} />
          <span>AI标书系统</span>
        </div>
        <div className="flex items-center gap-5">
          <Button type="text" icon={<Settings size={18} />} onClick={() => navigate('/settings')}>
            系统设置
          </Button>
          <Tag className="m-0 rounded-lg border-blue-300 px-4 py-1.5 text-base font-bold text-blue-600">v0.1 单机版</Tag>
        </div>
      </header>

      <aside className="fixed bottom-12 left-0 top-16 z-20 w-60 border-r border-slate-200 bg-white px-5 py-7">
        <nav className="grid gap-3" aria-label="主导航">
          {navItems.map(item => {
            const Icon = item.icon;
            const active = location.pathname === item.path || (item.path === '/' && location.pathname === '/bidding');
            return (
              <button
                key={item.path}
                type="button"
                className={`flex h-14 items-center gap-4 rounded-xl px-4 text-left text-base font-bold transition ${
                  active ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'
                }`}
                onClick={() => navigate(item.path)}
              >
                <Icon size={22} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="fixed bottom-12 left-60 right-0 top-16 overflow-y-auto overflow-x-hidden p-5">
        {children}
        <GlobalLoading />
      </main>

      <footer className="fixed bottom-0 left-0 right-0 z-30 flex h-12 items-center justify-between border-t border-slate-200 bg-white px-7 text-sm font-semibold text-slate-500">
        <span>企业单机部署版 · 本地知识库驱动 · Word 导出</span>
        <span>Flask API / Vite React / ChromaDB / Qwen</span>
      </footer>
    </div>
  );
}
