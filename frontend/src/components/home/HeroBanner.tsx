export function HeroBanner(): JSX.Element {
  return (
    <section className="grid min-h-52 grid-cols-[1fr_420px] overflow-hidden rounded-2xl border border-blue-100 bg-[radial-gradient(circle_at_88%_20%,rgba(50,103,255,0.10),transparent_26%),linear-gradient(110deg,#f6fbff_0%,#eaf3ff_72%,#e4efff_100%)] px-10 py-8 shadow-soft max-[1500px]:grid-cols-[1fr_320px]">
      <div className="min-w-0">
        <h1 className="mb-4 text-4xl font-black leading-none tracking-normal text-slate-950">AI 标书工作台</h1>
        <div className="mb-4 flex flex-wrap items-center gap-4 text-xl font-black text-blue-600">
          <span>企业单机部署版</span>
          <span>·</span>
          <span>本地知识库驱动</span>
          <span>·</span>
          <span>分章节生成</span>
          <span>·</span>
          <span>Word 导出</span>
        </div>
        <p className="max-w-3xl text-base font-semibold leading-7 text-slate-500">
          帮助企业快速完成资料入库、招标解析、标书生成与导出，适合非技术人员直接使用。
        </p>
      </div>
      <img
        className="h-40 w-full self-center object-contain drop-shadow-xl max-[1500px]:h-32"
        src="/assets/bid-workbench-hero.png"
        alt="标书工作台插图"
      />
    </section>
  );
}
