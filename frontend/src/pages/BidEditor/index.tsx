import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Dropdown, Empty, Input, Modal, Segmented, Space, Spin, Tag, message } from 'antd';
import type { MenuProps } from 'antd';
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  MoreVertical,
  Plus,
  Save,
  Search,
  Sparkles,
  ArrowUp,
  ArrowDown,
  Settings,
  Eye,
  Trash2,
  SlidersHorizontal,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { deleteBidSection, getInterpretation, getLatestInterpretation, reorderBidSections, saveBidSection } from '../../api/bidProject';
import { BrandMark } from '../../components/common/BrandMark';
import type { BidOutline, BidOutlineChapter, BidSection, InterpretationResponse } from '../../types/interpretation';

type EditorMode = '正文模式' | '目录模式';

type ChapterDraft = BidOutlineChapter & {
  id: string;
  content: string;
  expanded: boolean;
};

type AddChapterOptions = {
  parent?: ChapterDraft | null;
};

type StreamingChildPlaceholder = {
  id: string;
  parentOrder: string;
  title: string;
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

function normalizeChapterHierarchy(items: ChapterDraft[]): ChapterDraft[] {
  const childrenByParent = new Map<string, ChapterDraft[]>();
  const roots: ChapterDraft[] = [];

  items.forEach(item => {
    if (item.parent_id) {
      const siblings = childrenByParent.get(item.parent_id) || [];
      siblings.push(item);
      childrenByParent.set(item.parent_id, siblings);
      return;
    }
    roots.push(item);
  });

  const ordered: ChapterDraft[] = [];
  const visit = (nodes: ChapterDraft[], prefix = '', depth = 1): void => {
    nodes.forEach((node, index) => {
      const nextOrder = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
      ordered.push({
        ...node,
        order: nextOrder,
        level: depth,
      });
      const children = [...(childrenByParent.get(node.id) || [])];
      if (children.length) {
        visit(children, nextOrder, Math.min(depth + 1, 4));
      }
    });
  };

  visit(roots);
  return ordered.map((item, index) => ({ ...item, order_index: index + 1 }));
}

function flattenChapters(outline: BidOutline | null): ChapterDraft[] {
  return normalizeChapterHierarchy((outline?.chapters || []).map((chapter, index) => ({
    ...chapter,
    id: makeChapterId(chapter, index),
    content: initialContent(chapter),
    expanded: true,
  })));
}

function sectionsToDrafts(sections?: BidSection[]): ChapterDraft[] {
  return normalizeChapterHierarchy((sections || []).map(section => ({
    ...section,
    order: section.order_index,
    level: section.level || 1,
    content: section.content || initialContent(section),
    expanded: true,
  })));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function numericOrderIndex(value: string | number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return fallback;
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
  const [streamingChildPlaceholders, setStreamingChildPlaceholders] = useState<StreamingChildPlaceholder[]>([]);
  const [onlyOfficeLoading, setOnlyOfficeLoading] = useState(false);
  const [onlyOfficeError, setOnlyOfficeError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [onlyOfficeFrameUrl, setOnlyOfficeFrameUrl] = useState('');
  const streamStartedRef = useRef(false);
  const onlyOfficeDocumentRef = useRef('');

  async function load(): Promise<void> {
    setLoading(true);
    setDownloadUrl('');
    setOnlyOfficeError('');
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

  function openOnlyOfficeInPanel(sectionId?: string): void {
    const projectId = data?.project?.id || searchParams.get('projectId') || '';
    if (!projectId) {
      message.warning('缺少项目编号，无法打开 ONLYOFFICE。');
      return;
    }
    const params = new URLSearchParams({
      projectId,
      embed: '1',
      t: String(Date.now()),
    });
    if (sectionId && isUuid(sectionId)) {
      params.set('sectionId', sectionId);
    }
    setOnlyOfficeLoading(true);
    setOnlyOfficeError('');
    setDownloadUrl('');
    setOnlyOfficeFrameUrl(`/onlyoffice-editor?${params.toString()}`);
  }

  useEffect(() => {
    void load();
    // searchParams is stable enough for this route-level load; it changes only when projectId changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const projectId = data?.project?.id || searchParams.get('projectId') || '';
    if (mode !== '正文模式' || loading || streaming || !projectId || !chapters.length) {
      return;
    }
    const documentKey = `${projectId}:${isUuid(selectedId) ? selectedId : 'full'}`;
    if (onlyOfficeDocumentRef.current === documentKey) {
      return;
    }
    const timer = window.setTimeout(() => {
      onlyOfficeDocumentRef.current = documentKey;
      openOnlyOfficeInPanel(isUuid(selectedId) ? selectedId : undefined);
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.project?.id, loading, streaming, chapters.length, selectedId, mode, searchParams]);

  useEffect(() => {
    if (mode === '目录模式') {
      setOnlyOfficeLoading(false);
      setOnlyOfficeError('');
      setOnlyOfficeFrameUrl('');
    }
  }, [mode]);

  function startOutlineStream(projectId: string): void {
    if (streamStartedRef.current) {
      return;
    }
    streamStartedRef.current = true;
    setStreaming(true);
    setStreamText('AI 正在分析招标解读结果，准备生成标书章节大纲...');
    setChapters([]);
    setSelectedId('');
    setStreamingChildPlaceholders([]);

    const source = new EventSource(`/api/bidding/interpretations/${projectId}/bid-outline/stream`);
    source.addEventListener('start', event => {
      const payload = JSON.parse((event as MessageEvent).data) as { message?: string };
      setStreamText(payload.message || 'AI 已开始生成章节大纲。');
    });
    source.addEventListener('meta', event => {
      const payload = JSON.parse((event as MessageEvent).data) as { outline: BidOutline; total: number; rootTotal?: number; phase?: string };
      setOutlineMeta({ ...payload.outline, chapters: [] });
      setStreamText(payload.phase === 'quick'
        ? `已生成快速目录骨架，预计 ${payload.total} 个章节，正在逐步展开。`
        : `AI 已开始生成章节大纲，预计 ${payload.total} 个章节。`);
    });
    source.addEventListener('refined', event => {
      const payload = JSON.parse((event as MessageEvent).data) as { outline: BidOutline; total: number; rootTotal?: number };
      setOutlineMeta({ ...payload.outline, chapters: [] });
      setChapters([]);
      setSelectedId('');
      setStreamingChildPlaceholders([]);
      setStreamText(`AI 复核完成，正在刷新最终章节大纲，共 ${payload.total} 个章节。`);
    });
    source.addEventListener('stage', event => {
      const payload = JSON.parse((event as MessageEvent).data) as { message?: string; stage?: string; chapter?: { rootOrder?: string } };
      if (payload.message) {
        setStreamText(payload.message);
      }
      if (payload.stage === 'children' && payload.chapter?.rootOrder) {
        setStreamingChildPlaceholders(items => items.filter(item => item.parentOrder !== payload.chapter?.rootOrder));
      }
    });
    source.addEventListener('chapter', event => {
      const payload = JSON.parse((event as MessageEvent).data) as { chapter: BidOutlineChapter; index: number; total: number; phase?: string };
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
      setStreamText(`${payload.phase === 'refined' ? '正在刷新最终章节' : '正在生成章节'} ${payload.index} / ${payload.total}：${payload.chapter.title || '未命名章节'}`);
      if ((payload.chapter.level || 1) === 1) {
        const parentOrder = String(payload.chapter.order || '');
        if (parentOrder) {
          setStreamingChildPlaceholders(items => [
            ...items.filter(item => item.parentOrder !== parentOrder),
            {
              id: `streaming-child-${parentOrder}`,
              parentOrder,
              title: `正在补充「${payload.chapter.title || parentOrder}」下的子章节...`,
            },
          ]);
        }
      } else {
        const parentOrder = String(payload.chapter.order || '').split('.', 1)[0];
        if (parentOrder) {
          setStreamingChildPlaceholders(items => items.filter(item => item.parentOrder !== parentOrder));
        }
      }
    });
    source.addEventListener('done', event => {
      const payload = JSON.parse((event as MessageEvent).data) as { outline: BidOutline };
      setOutlineMeta(payload.outline);
      setData(current => current ? { ...current, sections: [] } : current);
      setStreamText('标书章节大纲生成完成，已进入可编辑状态。');
      setStreaming(false);
      setStreamingChildPlaceholders([]);
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
      setStreamingChildPlaceholders([]);
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
    const matchedIds = new Set(chapters.filter(chapter => (chapter.title || '').includes(term)).map(chapter => chapter.id));
    const byId = new Map(chapters.map(chapter => [chapter.id, chapter]));
    matchedIds.forEach(id => {
      let parentId = byId.get(id)?.parent_id || null;
      while (parentId) {
        matchedIds.add(parentId);
        parentId = byId.get(parentId)?.parent_id || null;
      }
    });
    return chapters.filter(chapter => matchedIds.has(chapter.id));
  }, [chapters, keyword]);
  const selectedChapter = chapters.find(chapter => chapter.id === selectedId) || chapters[0];
  const visibleChapters = useMemo(
    () => filteredChapters.filter(chapter => isVisibleChapter(chapter, filteredChapters)),
    [filteredChapters],
  );
  const matchText = keyword ? `${filteredChapters.length} / ${chapters.length}` : `0 / ${chapters.length}`;
  const totalChars = chapters.reduce((sum, chapter) => sum + chapter.content.length, 0);
  const estimatedPages = Math.max(1, Math.ceil(totalChars / 700));
  const generatedCount = chapters.filter(chapter => (chapter.content || '').trim() && !chapter.content.includes('请在此编写章节内容')).length;
  const generationProgress = chapters.length ? Math.round((generatedCount / chapters.length) * 10000) / 100 : 0;

  function chapterWordLabel(chapter: ChapterDraft): string {
    const content = (chapter.content || '').trim();
    if (!content || content.includes('请在此编写章节内容') || content.includes('待进一步生成正文')) {
      return `预计${Math.max(420, Math.min(1200, Math.round(((chapter.level || 1) <= 2 ? 680 : 520) / 10) * 10))}字`;
    }
    return `${content.length}字`;
  }

  function isChapterGenerated(chapter: ChapterDraft): boolean {
    const content = (chapter.content || '').trim();
    return !!content && !content.includes('请在此编写章节内容') && !content.includes('待进一步生成正文');
  }

  function chapterIndent(level?: number): number {
    return 12 + Math.max(0, Math.min((level || 1) - 1, 3)) * 20;
  }

  function collectDescendantIds(source: ChapterDraft[], rootId: string): Set<string> {
    const descendants = new Set<string>([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      source.forEach(item => {
        if (item.parent_id && descendants.has(item.parent_id) && !descendants.has(item.id)) {
          descendants.add(item.id);
          changed = true;
        }
      });
    }
    return descendants;
  }

  function syncChapterOrder(nextChapters: ChapterDraft[]): Promise<void> | void {
    if (!data?.project?.id) {
      return;
    }
    return reorderBidSections(
      data.project.id,
      nextChapters
        .filter(item => isUuid(item.id))
        .map((item, index) => ({
          id: item.id,
          parent_id: item.parent_id,
          level: item.level || 1,
          order_index: index + 1,
        })),
    ).then(() => {
      setChapters(normalizeChapterHierarchy(nextChapters));
    });
  }

  function isVisibleChapter(chapter: ChapterDraft, pool: ChapterDraft[]): boolean {
    const byId = new Map(pool.map(item => [item.id, item]));
    let parentId = chapter.parent_id || null;
    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent) {
        break;
      }
      if (!parent.expanded) {
        return false;
      }
      parentId = parent.parent_id || null;
    }
    return true;
  }

  function siblingChapters(chapter: ChapterDraft, source = chapters): ChapterDraft[] {
    return source.filter(item => (item.parent_id || null) === (chapter.parent_id || null));
  }

  function canMoveChapter(chapter: ChapterDraft, direction: 'up' | 'down'): boolean {
    const siblings = siblingChapters(chapter);
    const index = siblings.findIndex(item => item.id === chapter.id);
    if (index < 0) {
      return false;
    }
    return direction === 'up' ? index > 0 : index < siblings.length - 1;
  }

  async function moveChapter(chapter: ChapterDraft, direction: 'up' | 'down'): Promise<void> {
    const siblings = siblingChapters(chapter, chapters);
    const siblingIndex = siblings.findIndex(item => item.id === chapter.id);
    if (siblingIndex < 0) {
      return;
    }
    const targetSibling = direction === 'up' ? siblings[siblingIndex - 1] : siblings[siblingIndex + 1];
    if (!targetSibling) {
      return;
    }

    const currentIds = collectDescendantIds(chapters, chapter.id);
    const targetIds = collectDescendantIds(chapters, targetSibling.id);
    const currentBlock = chapters.filter(item => currentIds.has(item.id));
    const targetBlock = chapters.filter(item => targetIds.has(item.id));
    const currentStart = chapters.findIndex(item => item.id === currentBlock[0]?.id);
    const targetStart = chapters.findIndex(item => item.id === targetBlock[0]?.id);
    if (currentStart < 0 || targetStart < 0) {
      return;
    }

    const withoutBlocks = chapters.filter(item => !currentIds.has(item.id) && !targetIds.has(item.id));
    const insertAt = Math.min(currentStart, targetStart);
    const reorderedBlocks = direction === 'up'
      ? [...currentBlock, ...targetBlock]
      : [...targetBlock, ...currentBlock];
    const nextChapters = normalizeChapterHierarchy([
      ...withoutBlocks.slice(0, insertAt),
      ...reorderedBlocks,
      ...withoutBlocks.slice(insertAt),
    ]);

    setChapters(nextChapters);
    try {
      await syncChapterOrder(nextChapters);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      void reloadProject(data?.project?.id || '');
    }
  }

  function createBlankChapter(order: number, title = '新增章节', parent?: ChapterDraft | null): ChapterDraft {
    return {
      id: `${order}-${title}-${Date.now()}`,
      order,
      order_index: order,
      parent_id: parent?.id || null,
      level: Math.min((parent?.level || 0) + 1 || 1, 4),
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

  function lastDescendantIndex(items: ChapterDraft[], parentId: string): number {
    const idSet = new Set<string>([parentId]);
    let lastIndex = items.findIndex(item => item.id === parentId);
    for (let index = lastIndex + 1; index < items.length; index += 1) {
      const item = items[index];
      if (item.parent_id && idSet.has(item.parent_id)) {
        idSet.add(item.id);
        lastIndex = index;
        continue;
      }
      if (item.level && (items[lastIndex]?.level || 1) < item.level && item.parent_id && idSet.has(item.parent_id)) {
        idSet.add(item.id);
        lastIndex = index;
        continue;
      }
      if ((item.level || 1) <= (items.find(node => node.id === parentId)?.level || 1)) {
        break;
      }
    }
    return Math.max(lastIndex, items.findIndex(item => item.id === parentId));
  }

  async function addChapter(options?: AddChapterOptions): Promise<void> {
    const parent = options?.parent || null;
    const chapter = createBlankChapter(chapters.length + 1, '新增章节', parent);
    const nextChapters = (() => {
      if (!parent) {
        return normalizeChapterHierarchy([...chapters, chapter]);
      }
      const insertAfter = lastDescendantIndex(chapters, parent.id);
      const nextItems = [...chapters];
      nextItems.splice(insertAfter + 1, 0, chapter);
      return normalizeChapterHierarchy(nextItems);
    })();
    setChapters(nextChapters);
    setSelectedId(chapter.id);
    if (data?.project?.id) {
      try {
        const saved = await saveBidSection(data.project.id, {
          ...chapter,
          parent_id: parent?.id || null,
          level: chapter.level || 1,
          order_index: nextChapters.findIndex(item => item.id === chapter.id) + 1,
        });
        setChapters(items => normalizeChapterHierarchy(items.map(item => item.id === chapter.id ? { ...item, ...saved } : item)));
        setSelectedId(saved.id);
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
      }
    }
  }

  function toggleChapter(id: string): void {
    setChapters(items => items.map(item => item.id === id ? { ...item, expanded: !item.expanded } : item));
  }

  function setAllExpanded(expanded: boolean): void {
    setChapters(items => items.map(item => ({ ...item, expanded })));
  }

  function previewChapter(chapter: ChapterDraft): void {
    setSelectedId(chapter.id);
    setMode('正文模式');
  }

  async function saveDraft(): Promise<void> {
    if (!data?.project?.id || !selectedChapter) {
      message.warning('请先选择需要保存的章节');
      return;
    }
    try {
      const saved = await saveBidSection(data.project.id, {
        ...selectedChapter,
        level: selectedChapter.level || 1,
        order_index: chapters.findIndex(item => item.id === selectedChapter.id) + 1,
        status: selectedChapter.status || 'edited',
      });
      setChapters(items => normalizeChapterHierarchy(items.map(item => item.id === selectedChapter.id ? { ...item, ...saved } : item)));
      setSelectedId(saved.id);
      message.success('章节已保存到 Supabase');
      onlyOfficeDocumentRef.current = '';
      setDownloadUrl('');
      openOnlyOfficeInPanel(selectedChapter.id);
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
          order_index: chapters.findIndex(item => item.id === chapter.id) + 1,
          status: 'edited',
        };
        if (data?.project?.id) {
          await saveBidSection(data.project.id, renamed);
        }
        setChapters(items => normalizeChapterHierarchy(items.map(item => item.id === chapter.id ? {
          ...item,
          title,
          content: item.content.replace(/^## .*/m, `## ${title}`),
        } : item)));
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
          const descendants = new Set<string>([chapter.id]);
          let changed = true;
          while (changed) {
            changed = false;
            items.forEach(item => {
              if (item.parent_id && descendants.has(item.parent_id) && !descendants.has(item.id)) {
                descendants.add(item.id);
                changed = true;
              }
            });
          }
          const nextItems = normalizeChapterHierarchy(items.filter(item => !descendants.has(item.id)));
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

  function chapterMenuItems(chapter: ChapterDraft): MenuProps['items'] {
    return [
      { key: 'write', label: '编写章节' },
      { key: 'custom', label: '自定义编写' },
      { key: 'add', label: '添加章节' },
      { key: 'move-up', label: '上移章节', icon: <ArrowUp size={14} />, disabled: !canMoveChapter(chapter, 'up') },
      { key: 'move-down', label: '下移章节', icon: <ArrowDown size={14} />, disabled: !canMoveChapter(chapter, 'down') },
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
      void addChapter({ parent: chapter });
    }
    if (key === 'rename') {
      renameChapter(chapter);
    }
    if (key === 'move-up') {
      void moveChapter(chapter, 'up');
    }
    if (key === 'move-down') {
      void moveChapter(chapter, 'down');
    }
    if (key === 'delete') {
      deleteChapter(chapter);
    }
  }

  async function generateCurrentSection(targetChapter = selectedChapter, options?: { preserveMode?: boolean }): Promise<void> {
    if (!data?.project?.id || !targetChapter) {
      message.warning('请先选择需要生成正文的章节');
      return;
    }
    if (!options?.preserveMode) {
      setMode('正文模式');
    }
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
        <div className="bid-editor-loading-panel">
          <BrandMark size={96} className="loading-brand" />
          <Alert type="info" showIcon message="正在加载标书编制工作台" description="正在读取当前项目的章节大纲。" />
        </div>
      </div>
    );
  }

  if (!outline && !streaming && !chapters.length) {
    return (
      <div className="bid-editor-empty">
        <Empty description="当前项目尚未生成章节大纲" />
        <Alert type="warning" showIcon message="请先回到招标解读页生成章节大纲，再进入标书编制。" />
      </div>
    );
  }

  if (mode === '目录模式') {
    return (
      <div className="bid-editor-shell outline-mode-shell">
        <header className="bid-editor-topbar">
          <div className="bid-editor-brand">
            <FileText size={26} />
            <strong>{outline?.project_name || data?.project?.project_name || '测试标书'}</strong>
          </div>
          <Space size={10} wrap>
            <Button onClick={() => navigate('/interpretation')}>返回解读</Button>
            <Button icon={<BookOpen size={16} />}>关联资料</Button>
            <Button
              type="primary"
              icon={<Download size={17} />}
              href={downloadUrl || undefined}
              target={downloadUrl ? '_blank' : undefined}
              disabled={!downloadUrl}
            >
              标书下载
            </Button>
          </Space>
        </header>

        <main className="outline-workbench">
          <section className="outline-topbar">
            <Segmented<EditorMode>
              value={mode}
              onChange={value => setMode(value)}
              options={[
                { label: '正文模式', value: '正文模式' },
                { label: '目录模式', value: '目录模式' },
              ]}
            />
            <div className="outline-summary">
              <span>总章节：{chapters.length}</span>
              <span>已生成：{generatedCount}</span>
              <span>总字数：{totalChars}（约{estimatedPages}页）</span>
              <span>进度：{generationProgress}%</span>
            </div>
          </section>

          <section className="outline-panel">
            <div className="outline-panel-header">
              <div className="outline-panel-title">
                <BookOpen size={18} />
                <strong>标书目录</strong>
              </div>
              <Space size={10} wrap>
                <label className="outline-check">
                  <input type="checkbox" />
                  <span>批量操作</span>
                </label>
                <label className="outline-switch">
                  <input type="checkbox" />
                  <span>全篇图文并茂</span>
                </label>
                <Button size="small" icon={<SlidersHorizontal size={14} />}>全文设置</Button>
                <Button size="small" icon={<Download size={14} />}>下载目录</Button>
              </Space>
            </div>

            <div className="outline-table">
              {visibleChapters.map(chapter => {
                const generated = isChapterGenerated(chapter);
                const active = chapter.id === selectedChapter?.id;
                return (
                  <div
                    key={`outline-${chapter.id}`}
                    className={`outline-row level-${chapter.level || 1} ${active ? 'active' : ''}`}
                    style={{ paddingLeft: `${20 + Math.max(0, (chapter.level || 1) - 1) * 28}px` }}
                  >
                    <button
                      type="button"
                      className="outline-row-toggle"
                      aria-label="展开或收起章节"
                      onClick={() => toggleChapter(chapter.id)}
                    >
                      {chapter.expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                    <button
                      type="button"
                      className="outline-row-title"
                      onClick={() => {
                        setSelectedId(chapter.id);
                      }}
                    >
                      <span>{chapter.order ? `${chapter.order}. ` : ''}{chapter.title}</span>
                    </button>
                    <div className={`outline-word-pill ${generated ? 'done' : 'pending'}`}>
                      {generated ? <CheckCircle2 size={13} /> : null}
                      <span>{chapterWordLabel(chapter)}</span>
                    </div>
                    <div className="outline-row-actions">
                      <Button type="link" size="small" icon={<Settings size={14} />}>章节设置</Button>
                      <Button type="link" size="small" icon={<Plus size={14} />} onClick={() => void addChapter({ parent: chapter })}>新增章节</Button>
                      <Button type="link" size="small" icon={<Sparkles size={14} />} loading={sectionStreaming && selectedId === chapter.id} onClick={() => void generateCurrentSection(chapter, { preserveMode: true })}>快速编写</Button>
                      <Button type="link" size="small" icon={<Eye size={14} />} onClick={() => previewChapter(chapter)}>预览</Button>
                      <Button type="link" size="small" danger icon={<Trash2 size={14} />} onClick={() => deleteChapter(chapter)}>删除</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <footer className="outline-footer">
            <Space>
              <Button type="text" onClick={() => setAllExpanded(false)}>全部收起</Button>
              <Button type="text" onClick={() => setAllExpanded(true)}>全部展开</Button>
            </Space>
            <Button
              type="primary"
              size="large"
              icon={<Sparkles size={18} />}
              disabled={!chapters.length || sectionStreaming}
              onClick={() => {
                const next = chapters.find(chapter => !isChapterGenerated(chapter)) || chapters[0];
                if (next) {
                  void generateCurrentSection(next, { preserveMode: true });
                }
              }}
            >
              一键编写全文
            </Button>
            <span />
          </footer>
        </main>
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
          <Button
            type="primary"
            icon={<Download size={17} />}
            href={downloadUrl || undefined}
            target={downloadUrl ? '_blank' : undefined}
            disabled={!downloadUrl}
          >
            标书下载
          </Button>
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
        <div className={`chapter-tree ${streaming ? 'is-streaming' : ''}`}>
          {streaming ? (
            <div className="chapter-streaming-panel">
              <div className="chapter-streaming-head">
                <div className="stream-placeholder-icon chapter-streaming-icon">
                  <BrandMark size={34} rounded={false} />
                </div>
                <div>
                  <strong>AI 正在流式生成章节</strong>
                  <span>{streamText || '正在结合招标解读结果生成目录...'}</span>
                </div>
              </div>
            </div>
          ) : null}
          {visibleChapters.map(chapter => {
            const active = chapter.id === selectedChapter?.id;
            const childPlaceholder = (chapter.level || 1) === 1
              ? streamingChildPlaceholders.find(item => item.parentOrder === String(chapter.order || ''))
              : null;
            return (
              <Fragment key={chapter.id}>
                <div
                  className={`chapter-node level-${chapter.level || 1} ${active ? 'active' : ''}`}
                  style={{ paddingLeft: `${chapterIndent(chapter.level)}px` }}
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
                      items: chapterMenuItems(chapter),
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
                {streaming && childPlaceholder && chapter.expanded ? (
                  <div
                    key={childPlaceholder.id}
                    className="chapter-node chapter-node-placeholder chapter-node-child-placeholder level-2"
                    style={{ paddingLeft: `${chapterIndent(2)}px` }}
                  >
                    <span className="chapter-toggle" />
                    <span className="chapter-status" />
                    <span className="chapter-title">{childPlaceholder.title}</span>
                  </div>
                ) : null}
              </Fragment>
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
            <p>{streaming ? streamText : selectedChapter?.purpose || '右侧已嵌入 ONLYOFFICE，可直接进行 DOCX 格式定稿。'}</p>
          </div>
          <Space>
            <Tag color={onlyOfficeError ? 'red' : onlyOfficeLoading ? 'processing' : 'gold'}>
              {onlyOfficeError ? '终稿加载失败' : onlyOfficeLoading ? '终稿加载中' : 'ONLYOFFICE 在线终稿'}
            </Tag>
            {streaming ? <Tag color="processing">大纲生成中</Tag> : null}
            {sectionStreaming ? <Tag color="processing">正文生成中</Tag> : null}
            <Tag color="blue">{selectedChapter?.priority || 'medium'}</Tag>
            <Button icon={<Sparkles size={16} />} loading={sectionStreaming} disabled={!selectedChapter || streaming} onClick={() => void generateCurrentSection()}>生成本章正文</Button>
            <Button type="primary" icon={<Save size={16} />} onClick={() => void saveDraft()}>保存</Button>
          </Space>
        </section>

        <section className="editor-workspace">
          <div className="onlyoffice-embed-shell">
            {onlyOfficeLoading || (!onlyOfficeError && !onlyOfficeFrameUrl) ? (
              <div className="onlyoffice-embed-loading">
                <BrandMark size={88} className="loading-brand" />
                <Spin size="large" />
                <span>{streaming ? '章节大纲生成完成后将自动加载 ONLYOFFICE...' : '正在准备 ONLYOFFICE 编辑区...'}</span>
              </div>
            ) : null}
            {onlyOfficeError ? (
              <Alert
                type="warning"
                showIcon
                message="ONLYOFFICE 加载失败"
                description={`${onlyOfficeError}。请确认 ONLYOFFICE 服务和后端 APP_PUBLIC_BASE_URL 配置可用。`}
              />
            ) : null}
            {onlyOfficeFrameUrl && !onlyOfficeError ? (
              <iframe
                key={onlyOfficeFrameUrl}
                className="onlyoffice-embed-frame"
                src={onlyOfficeFrameUrl}
                title="ONLYOFFICE 在线终稿"
                onLoad={() => setOnlyOfficeLoading(false)}
              />
            ) : null}
          </div>
        </section>

        <footer className="editor-statusbar">
          <span>当前章节：{selectedChapter?.title || '-'}</span>
          <span>来源页码：{selectedChapter?.source_pages?.join('、') || '需复核'}</span>
          <span>{onlyOfficeFrameUrl ? 'ONLYOFFICE 在线终稿' : '终稿准备中'}</span>
        </footer>
      </main>
    </div>
  );
}
