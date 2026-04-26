import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Dropdown, Empty, Input, Modal, Segmented, Space, Tag, Tooltip, message } from 'antd';
import type { MenuProps } from 'antd';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  MoreVertical,
  PanelLeft,
  Plus,
  Printer,
  Redo2,
  Save,
  Search,
  Sparkles,
  Table2,
  Underline,
  Undo2,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { deleteBidSection, getInterpretation, getLatestInterpretation, saveBidSection } from '../../api/bidProject';
import type { BidOutline, BidOutlineChapter, BidSection, InterpretationResponse } from '../../types/interpretation';

type EditorMode = '正文模式' | '目录模式';

type ChapterDraft = BidOutlineChapter & {
  id: string;
  content: string;
  expanded: boolean;
};

function asBidOutline(meta: Record<string, unknown> | undefined | null): BidOutline | null {
  return (meta?.bid_outline || null) as BidOutline | null;
}

function makeChapterId(chapter: BidOutlineChapter, index: number): string {
  return `${chapter.order_index || chapter.order || index + 1}-${chapter.title || 'chapter'}`;
}

function initialContent(chapter: BidOutlineChapter): string {
  const responsePoints = chapter.response_points?.map(item => `（${item}）`).join('\n') || '（待补充响应要点）';
  const materials = chapter.required_materials?.join('、') || '需人工补充企业资料、资信文件和证明材料';
  const risks = chapter.mapped_risks?.join('；') || '暂无明确风险，仍需结合招标文件复核。';

  return [
    `## ${chapter.title || '未命名章节'}`,
    '',
    chapter.purpose || '本章用于响应招标文件相关要求，待进一步生成正文。',
    '',
    '### 编写要点',
    responsePoints,
    '',
    '### 需准备资料',
    materials,
    '',
    '### 风险与复核',
    risks,
  ].join('\n');
}

function flattenChapters(outline: BidOutline | null): ChapterDraft[] {
  return (outline?.chapters || []).map((chapter, index) => ({
    ...chapter,
    id: makeChapterId(chapter, index),
    content: initialContent(chapter),
    expanded: true,
  }));
}

function sectionsToDrafts(sections?: BidSection[]): ChapterDraft[] {
  return (sections || []).map(section => ({
    ...section,
    order: section.order_index,
    level: section.level || 1,
    content: section.content || initialContent(section),
    expanded: true,
  }));
}

function toolButton(title: string, icon: JSX.Element): JSX.Element {
  return (
    <Tooltip title={title}>
      <Button type="text" size="small" icon={icon} aria-label={title} />
    </Tooltip>
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function BidEditorPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<InterpretationResponse | null>(null);
  const [outlineMeta, setOutlineMeta] = useState<BidOutline | null>(null);
  const [chapters, setChapters] = useState<ChapterDraft[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [mode, setMode] = useState<EditorMode>('正文模式');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [sectionStreaming, setSectionStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const streamStartedRef = useRef(false);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const projectId = searchParams.get('projectId');
      const result = projectId ? await getInterpretation(projectId) : await getLatestInterpretation();
      setData(result);
      if (searchParams.get('autoGenerate') === 'outline' && result.project?.id) {
        startOutlineStream(result.project.id);
      } else {
        const outline = asBidOutline(result.analysis?.project_meta);
        setOutlineMeta(outline);
        const sectionDrafts = sectionsToDrafts(result.sections);
        const drafts = sectionDrafts.length ? sectionDrafts : flattenChapters(outline);
        setChapters(drafts);
        setSelectedId(current => current || drafts[0]?.id || '');
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      message.error(reason);
    } finally {
      setLoading(false);
    }
  }

  async function reloadProject(projectId: string): Promise<void> {
    const result = await getInterpretation(projectId);
    const outline = asBidOutline(result.analysis?.project_meta);
    const sectionDrafts = sectionsToDrafts(result.sections);
    const drafts = sectionDrafts.length ? sectionDrafts : flattenChapters(outline);
    setData(result);
    setOutlineMeta(outline);
    setChapters(drafts);
    setSelectedId(current => current || drafts[0]?.id || '');
  }

  useEffect(() => {
    void load();
    // searchParams is stable enough for this route-level load; it changes only when projectId changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function startOutlineStream(projectId: string): void {
    if (streamStartedRef.current) {
      return;
    }
    streamStartedRef.current = true;
    setStreaming(true);
    setStreamText('AI 正在分析招标解读结果，准备生成标书章节大纲...');
    setChapters([]);
    setSelectedId('');

    const source = new EventSource(`/api/bidding/interpretations/${projectId}/bid-outline/stream`);
    source.addEventListener('start', event => {
      const payload = JSON.parse((event as MessageEvent).data) as { outline: BidOutline; total: number };
      setOutlineMeta({ ...payload.outline, chapters: [] });
      setStreamText(`AI 已开始生成章节大纲，预计 ${payload.total} 个章节。`);
    });
    source.addEventListener('chapter', event => {
      const payload = JSON.parse((event as MessageEvent).data) as { chapter: BidOutlineChapter; index: number; total: number };
      const chapterDraft: ChapterDraft = {
        ...payload.chapter,
        id: makeChapterId(payload.chapter, payload.index - 1),
        content: initialContent(payload.chapter),
        expanded: true,
      };
      setChapters(items => {
        if (items.some(item => item.id === chapterDraft.id)) {
          return items;
        }
        return [...items, chapterDraft];
      });
      setSelectedId(current => current || chapterDraft.id);
      setStreamText(`正在生成第 ${payload.index} / ${payload.total} 个章节：${payload.chapter.title || '未命名章节'}`);
    });
    source.addEventListener('done', event => {
      const payload = JSON.parse((event as MessageEvent).data) as { outline: BidOutline };
      setOutlineMeta(payload.outline);
      setData(current => current ? { ...current, sections: [] } : current);
      setStreamText('标书章节大纲生成完成，已进入可编辑状态。');
      setStreaming(false);
      source.close();
      window.history.replaceState(null, '', `/bid-editor?projectId=${projectId}`);
      void reloadProject(projectId);
    });
    source.addEventListener('error', event => {
      const raw = (event as MessageEvent).data;
      if (raw) {
        try {
          const payload = JSON.parse(raw) as { error?: string };
          message.error(payload.error || '章节大纲流式生成失败');
        } catch {
          message.error('章节大纲流式生成失败');
        }
      }
      setStreaming(false);
      source.close();
    });
  }

  const savedOutline = asBidOutline(data?.analysis?.project_meta);
  const outline = outlineMeta || savedOutline;
  const filteredChapters = useMemo(() => {
    const term = keyword.trim();
    if (!term) {
      return chapters;
    }
    return chapters.filter(chapter => (chapter.title || '').includes(term));
  }, [chapters, keyword]);
  const selectedChapter = chapters.find(chapter => chapter.id === selectedId) || chapters[0];
  const matchText = keyword ? `${filteredChapters.length} / ${chapters.length}` : `0 / ${chapters.length}`;
  const totalChars = chapters.reduce((sum, chapter) => sum + chapter.content.length, 0);
  const estimatedPages = Math.max(1, Math.ceil(totalChars / 700));

  function updateSelectedContent(value: string): void {
    setChapters(items => items.map(item => item.id === selectedChapter?.id ? { ...item, content: value } : item));
  }

  function createBlankChapter(order: number, title = '新增章节'): ChapterDraft {
    return {
      id: `${order}-${title}-${Date.now()}`,
      order,
      title,
      priority: 'medium',
      purpose: '请补充本章编写目标。',
      response_points: ['请补充响应要点。'],
      mapped_requirements: [],
      mapped_scoring_items: [],
      mapped_risks: [],
      source_pages: [],
      required_materials: [],
      writing_notes: ['新增章节后建议先关联招标要求，再生成正文。'],
      content: `## ${title}\n\n请在此编写章节内容。`,
      expanded: true,
    };
  }

  async function addChapter(afterId?: string): Promise<void> {
    const chapter = createBlankChapter(chapters.length + 1);
    const nextChapters = (() => {
      if (!afterId) {
        return [...chapters, chapter];
      }
      const index = chapters.findIndex(item => item.id === afterId);
      if (index < 0) {
        return [...chapters, chapter];
      }
      return [...chapters.slice(0, index + 1), chapter, ...chapters.slice(index + 1)]
        .map((item, itemIndex) => ({ ...item, order: itemIndex + 1 }));
    })();
    setChapters(nextChapters);
    setSelectedId(chapter.id);
    if (data?.project?.id) {
      try {
        const saved = await saveBidSection(data.project.id, { ...chapter, order_index: chapter.order || nextChapters.length });
        setChapters(items => items.map(item => item.id === chapter.id ? { ...item, ...saved, order: saved.order_index } : item));
        setSelectedId(saved.id);
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
      }
    }
  }

  function toggleChapter(id: string): void {
    setChapters(items => items.map(item => item.id === id ? { ...item, expanded: !item.expanded } : item));
  }

  async function saveDraft(): Promise<void> {
    if (!data?.project?.id || !selectedChapter) {
      message.warning('请先选择需要保存的章节');
      return;
    }
    try {
      const saved = await saveBidSection(data.project.id, {
        ...selectedChapter,
        order_index: selectedChapter.order || 1,
        status: selectedChapter.status || 'edited',
      });
      setChapters(items => items.map(item => item.id === selectedChapter.id ? { ...item, ...saved, order: saved.order_index } : item));
      setSelectedId(saved.id);
      message.success('章节已保存到 Supabase');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  function appendChapterContent(chapterId: string, value: string): void {
    setChapters(items => items.map(item => item.id === chapterId ? { ...item, content: `${item.content}${value}` } : item));
  }

  function renameChapter(chapter: ChapterDraft): void {
    let nextTitle = chapter.title || '';
    Modal.confirm({
      title: '修改章节标题',
      content: (
        <Input
          defaultValue={chapter.title}
          autoFocus
          onChange={event => {
            nextTitle = event.target.value;
          }}
        />
      ),
      okText: '保存',
      cancelText: '取消',
      onOk: async () => {
        const title = nextTitle.trim();
        if (!title) {
          message.warning('章节标题不能为空');
          return Promise.reject();
        }
        const renamed = {
          ...chapter,
          title,
          content: chapter.content.replace(/^## .*/m, `## ${title}`),
          order_index: chapter.order || chapter.order_index || 1,
          status: 'edited',
        };
        if (data?.project?.id) {
          await saveBidSection(data.project.id, renamed);
        }
        setChapters(items => items.map(item => item.id === chapter.id ? {
          ...item,
          title,
          content: item.content.replace(/^## .*/m, `## ${title}`),
        } : item));
      },
    });
  }

  function deleteChapter(chapter: ChapterDraft): void {
    Modal.confirm({
      title: '删除章节',
      content: `确认删除“${chapter.title || '未命名章节'}”？此操作只影响当前页面草稿。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        if (data?.project?.id && chapter.id && isUuid(chapter.id)) {
          await deleteBidSection(data.project.id, chapter.id);
        }
        setChapters(items => {
          const nextItems = items.filter(item => item.id !== chapter.id).map((item, index) => ({ ...item, order: index + 1 }));
          if (selectedId === chapter.id) {
            setSelectedId(nextItems[0]?.id || '');
          }
          return nextItems;
        });
      },
    });
  }

  function customWriteChapter(chapter: ChapterDraft): void {
    let instruction = '';
    Modal.confirm({
      title: `自定义编写：${chapter.title || '未命名章节'}`,
      content: (
        <Input.TextArea
          rows={5}
          placeholder="请输入本章补充要求，例如：重点突出质量保障和类似项目经验，语气更正式。"
          onChange={event => {
            instruction = event.target.value;
          }}
        />
      ),
      okText: '加入写作要求',
      cancelText: '取消',
      onOk: () => {
        setChapters(items => items.map(item => item.id === chapter.id ? {
          ...item,
          writing_notes: [...(item.writing_notes || []), instruction.trim() || '按用户自定义要求编写。'],
        } : item));
        setSelectedId(chapter.id);
        message.success('已加入自定义写作要求，可点击生成本章正文');
      },
    });
  }

  function chapterMenuItems(): MenuProps['items'] {
    return [
      { key: 'write', label: '编写章节' },
      { key: 'custom', label: '自定义编写' },
      { key: 'add', label: '添加章节' },
      { key: 'rename', label: '修改标题' },
      { type: 'divider' },
      { key: 'delete', label: '删除章节', danger: true },
    ];
  }

  function handleChapterMenu(key: string, chapter: ChapterDraft): void {
    setSelectedId(chapter.id);
    if (key === 'write') {
      void generateCurrentSection(chapter);
    }
    if (key === 'custom') {
      customWriteChapter(chapter);
    }
    if (key === 'add') {
      void addChapter(chapter.id);
    }
    if (key === 'rename') {
      renameChapter(chapter);
    }
    if (key === 'delete') {
      deleteChapter(chapter);
    }
  }

  async function generateCurrentSection(targetChapter = selectedChapter): Promise<void> {
    if (!data?.project?.id || !targetChapter) {
      message.warning('请先选择需要生成正文的章节');
      return;
    }
    setMode('正文模式');
    setSelectedId(targetChapter.id);
    setSectionStreaming(true);
    setStreamText(`正在生成章节正文：${targetChapter.title || '未命名章节'}`);
    setChapters(items => items.map(item => item.id === targetChapter.id ? { ...item, content: `## ${targetChapter.title || '未命名章节'}\n\n` } : item));

    try {
      const response = await fetch(`/api/bidding/interpretations/${data.project.id}/sections/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(targetChapter),
      });
      if (!response.ok || !response.body) {
        throw new Error(`章节正文生成失败：${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      function handleFrame(frame: string): void {
        const eventLine = frame.split('\n').find(line => line.startsWith('event:'));
        const dataLine = frame.split('\n').find(line => line.startsWith('data:'));
        const eventName = eventLine?.replace('event:', '').trim() || 'message';
        const dataText = dataLine?.replace('data:', '').trim();
        if (!dataText) {
          return;
        }
        const payload = JSON.parse(dataText) as { content?: string; error?: string; title?: string };
        if (eventName === 'start') {
          setStreamText(`AI 正在撰写：${payload.title || targetChapter.title || '当前章节'}`);
        }
        if (eventName === 'chunk' && payload.content) {
          appendChapterContent(targetChapter.id, payload.content);
        }
        if (eventName === 'done') {
          setStreamText('章节正文生成完成，可继续人工编辑。');
        }
        if (eventName === 'error') {
          throw new Error(payload.error || '章节正文生成失败');
        }
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        frames.forEach(handleFrame);
      }
      if (buffer.trim()) {
        handleFrame(buffer);
      }
      message.success('章节正文已生成');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      message.error(reason);
    } finally {
      setSectionStreaming(false);
    }
  }

  if (loading) {
    return (
      <div className="bid-editor-loading">
        <Alert type="info" showIcon message="正在加载标书编制工作台" description="正在读取当前项目的章节大纲。" />
      </div>
    );
  }

  if (!outline && !streaming) {
    return (
      <div className="bid-editor-empty">
        <Empty description="当前项目尚未生成章节大纲" />
        <Alert type="warning" showIcon message="请先回到招标解读页生成章节大纲，再进入标书编制。" />
      </div>
    );
  }

  return (
    <div className="bid-editor-shell">
      <header className="bid-editor-topbar">
        <div className="bid-editor-brand">
          <FileText size={26} />
          <strong>{outline?.project_name || data?.project?.project_name || '测试标书'}</strong>
        </div>
        <Space size={10} wrap>
          <Button onClick={() => navigate('/interpretation')}>返回解读</Button>
          <Button icon={<BookOpen size={16} />}>关联资料</Button>
          <Button type="primary" icon={<Download size={17} />}>标书下载</Button>
        </Space>
      </header>

      <aside className="bid-editor-sidebar">
        <div className="editor-mode-row">
          <Segmented<EditorMode>
            value={mode}
            onChange={value => setMode(value)}
            options={[
              { label: '正文模式', value: '正文模式' },
              { label: '目录模式', value: '目录模式' },
            ]}
          />
          <Button size="small" icon={<Plus size={15} />} onClick={() => void addChapter()}>新增章节</Button>
        </div>
        <Input
          allowClear
          size="small"
          prefix={<Search size={14} />}
          value={keyword}
          onChange={event => setKeyword(event.target.value)}
          suffix={<span className="match-count">{matchText}</span>}
          placeholder="输入章节名称搜索"
        />
        <div className="chapter-tree">
          {filteredChapters.map(chapter => {
            const active = chapter.id === selectedChapter?.id;
            return (
              <div
                key={chapter.id}
                className={`chapter-node level-${chapter.level || 1} ${active ? 'active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(chapter.id)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    setSelectedId(chapter.id);
                  }
                }}
              >
                <span className="chapter-toggle" onClick={event => { event.stopPropagation(); toggleChapter(chapter.id); }}>
                  {chapter.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
                <span className={`chapter-status ${chapter.priority || 'medium'}`} />
                <span className="chapter-title">{chapter.order ? `${chapter.order}. ` : ''}{chapter.title}</span>
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: chapterMenuItems(),
                    onClick: info => {
                      info.domEvent.stopPropagation();
                      handleChapterMenu(info.key, chapter);
                    },
                  }}
                >
                  <button
                    type="button"
                    className="chapter-more"
                    aria-label="章节操作"
                    onClick={event => event.stopPropagation()}
                  >
                    <MoreVertical size={15} />
                  </button>
                </Dropdown>
              </div>
            );
          })}
        </div>
        <footer className="chapter-stats">
          <span>总章节：{chapters.length}</span>
          <span>总字数：{totalChars}</span>
          <span>约{estimatedPages}页</span>
        </footer>
      </aside>

      <main className="bid-editor-main">
        <section className="editor-title-row">
          <div>
            <h1>{selectedChapter?.title || '未选择章节'}</h1>
            <p>{streaming ? streamText : selectedChapter?.purpose || '请选择左侧章节查看编写要求。'}</p>
          </div>
          <Space>
            {streaming ? <Tag color="processing">大纲生成中</Tag> : null}
            {sectionStreaming ? <Tag color="processing">正文生成中</Tag> : null}
            <Tag color="blue">{selectedChapter?.priority || 'medium'}</Tag>
            <Button icon={<Sparkles size={16} />} loading={sectionStreaming} disabled={!selectedChapter || streaming} onClick={() => void generateCurrentSection()}>生成本章正文</Button>
            <Button type="primary" icon={<Save size={16} />} onClick={() => void saveDraft()}>保存</Button>
          </Space>
        </section>

        <section className="office-toolbar">
          <div className="toolbar-group">
            {toolButton('展开/收起目录', <PanelLeft size={16} />)}
            <span>开始</span>
            {toolButton('撤销', <Undo2 size={16} />)}
            {toolButton('重做', <Redo2 size={16} />)}
          </div>
          <div className="toolbar-group">
            <select aria-label="段落样式" defaultValue="正文">
              <option>正文</option>
              <option>标题一</option>
              <option>标题二</option>
              <option>标题三</option>
            </select>
            {toolButton('加粗', <Bold size={16} />)}
            {toolButton('斜体', <Italic size={16} />)}
            {toolButton('下划线', <Underline size={16} />)}
            {toolButton('高亮', <Highlighter size={16} />)}
          </div>
          <div className="toolbar-group">
            {toolButton('有序列表', <ListOrdered size={16} />)}
            {toolButton('无序列表', <List size={16} />)}
            {toolButton('左对齐', <AlignLeft size={16} />)}
            {toolButton('居中', <AlignCenter size={16} />)}
            {toolButton('右对齐', <AlignRight size={16} />)}
          </div>
          <div className="toolbar-group">
            {toolButton('插入表格', <Table2 size={16} />)}
            {toolButton('打印', <Printer size={16} />)}
          </div>
        </section>

        <section className="editor-workspace">
          {mode === '目录模式' ? (
            <div className="outline-document">
              <h2>投标文件目录</h2>
              {chapters.length ? (
                <ol>
                  {chapters.map(chapter => (
                    <li key={`toc-${chapter.id}`}>
                      <strong>{chapter.title}</strong>
                      <span>{chapter.purpose}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="stream-placeholder">
                  <Sparkles size={28} />
                  <strong>{streamText || '等待章节生成...'}</strong>
                </div>
              )}
            </div>
          ) : (
            <div className="document-page">
              {selectedChapter ? (
                <textarea
                  aria-label="章节正文编辑器"
                  value={selectedChapter.content}
                  onChange={event => updateSelectedContent(event.target.value)}
                />
              ) : (
                <div className="stream-placeholder">
                  <Sparkles size={30} />
                  <strong>{streamText || 'AI 正在准备章节大纲...'}</strong>
                  <span>章节生成后会自动出现在左侧目录，并在这里展示草稿。</span>
                </div>
              )}
            </div>
          )}
        </section>

        <footer className="editor-statusbar">
          <span>当前章节：{selectedChapter?.title || '-'}</span>
          <span>来源页码：{selectedChapter?.source_pages?.join('、') || '需复核'}</span>
          <span>缩放 99%</span>
        </footer>
      </main>
    </div>
  );
}
