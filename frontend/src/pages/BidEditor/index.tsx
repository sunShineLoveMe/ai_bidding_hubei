import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Alert, Button, Dropdown, Empty, Input, Modal, Progress, Segmented, Space, Tag, Tooltip, message } from 'antd';
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
  Search,
  Sparkles,
  Square,
  ArrowUp,
  ArrowDown,
  Eye,
  Trash2,
  SlidersHorizontal,
  RotateCcw,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { deleteBidSection, generateBidDocxDownload, getInterpretation, getLatestInterpretation, reorderBidSections, resetBidSectionsGeneration, saveBidSection } from '../../api/bidProject';
import { BrandMark } from '../../components/common/BrandMark';
import { TiptapBidEditor } from '../../components/editor/TiptapBidEditor';
import type { BidOutline, BidOutlineChapter, BidSection, ChapterWritingPlan, InterpretationResponse } from '../../types/interpretation';

type EditorMode = '正文模式' | '目录模式';
type VolumeType = 'all' | 'technical' | 'business' | 'qualification' | 'price' | 'attachment' | 'other';

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

type BatchTaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'stopped';

type BatchTask = {
  status: BatchTaskStatus;
  percent: number;
  chars: number;
  targetWords: number;
  message?: string;
};

const BATCH_SECTION_CONCURRENCY = 3;

const volumeOptions: Array<{ value: VolumeType; label: string; shortLabel: string; keywords: RegExp }> = [
  { value: 'all', label: '全部', shortLabel: '全部', keywords: /.*/ },
  { value: 'technical', label: '技术标', shortLabel: '技术', keywords: /技术|施工组织|实施方案|施工方案|质量|安全|环保|进度|资源配置|发包人要求|承包人建议|设备|工艺|调试/ },
  { value: 'business', label: '商务标', shortLabel: '商务', keywords: /商务|合同|付款|履约|服务|税费|廉政|保密|偏离|承诺|投标函|授权委托|保证金/ },
  { value: 'qualification', label: '资格文件', shortLabel: '资格', keywords: /资格|资质|证书|营业执照|安全生产许可|人员|项目经理|技术负责人|业绩|信誉|社保|建造师/ },
  { value: 'price', label: '报价文件', shortLabel: '报价', keywords: /报价|清单|价格|单价|工程量|投标总价|分项报价/ },
  { value: 'attachment', label: '附件材料', shortLabel: '附件', keywords: /附件|图纸|扫描件|证明材料|附录|图片|图册/ },
  { value: 'other', label: '其他', shortLabel: '其他', keywords: /^$/ },
];

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function chapterDisplayTitle(chapter: Pick<ChapterDraft, 'order' | 'title'>): string {
  const title = (chapter.title || '未命名章节').trim();
  if (!chapter.order) {
    return title;
  }
  const order = String(chapter.order).trim();
  const duplicateOrder = new RegExp(`^${escapeRegExp(order)}\\.?\\s*`);
  const cleanTitle = title.replace(duplicateOrder, '').trim() || title;
  const orderPrefix = order.includes('.') ? `${order} ` : `${order}. `;
  return `${orderPrefix}${cleanTitle}`;
}

function inferVolumeType(chapter: Pick<ChapterDraft, 'title' | 'purpose' | 'required_materials' | 'response_points' | 'metadata'>): VolumeType {
  const metadataVolume = String(chapter.metadata?.volume_type || '').trim() as VolumeType;
  if (volumeOptions.some(item => item.value === metadataVolume && metadataVolume !== 'all')) {
    return metadataVolume;
  }
  const combined = [
    chapter.title,
    chapter.purpose,
    ...(chapter.required_materials || []),
    ...(chapter.response_points || []),
  ].filter(Boolean).join(' ');
  const matched = volumeOptions.find(item => item.value !== 'all' && item.value !== 'other' && item.keywords.test(combined));
  return matched?.value || 'other';
}

function volumeLabel(volumeType: VolumeType): string {
  return volumeOptions.find(item => item.value === volumeType)?.label || '其他';
}

export function BidEditorPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<InterpretationResponse | null>(null);
  const [outlineMeta, setOutlineMeta] = useState<BidOutline | null>(null);
  const [chapters, setChapters] = useState<ChapterDraft[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [mode, setMode] = useState<EditorMode>('正文模式');
  const [activeVolume, setActiveVolume] = useState<VolumeType>('all');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [sectionStreaming, setSectionStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [streamingChildPlaceholders, setStreamingChildPlaceholders] = useState<StreamingChildPlaceholder[]>([]);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloadGenerating, setDownloadGenerating] = useState<'full' | 'section' | null>(null);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchTasks, setBatchTasks] = useState<Record<string, BatchTask>>({});
  const [withImages, setWithImages] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetClearContent, setResetClearContent] = useState(false);
  const [resettingGeneration, setResettingGeneration] = useState(false);
  const streamStartedRef = useRef(false);
  const batchCancelRequestedRef = useRef(false);
  const batchAbortControllersRef = useRef<Map<string, AbortController>>(new Map());

  async function load(): Promise<void> {
    setLoading(true);
    setDownloadUrl('');
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

  // 处理编辑器内容变化
  const handleEditorChange = useCallback((markdown: string) => {
    if (selectedId) {
      setChapters(items => items.map(item =>
        item.id === selectedId ? { ...item, content: markdown } : item
      ));
    }
  }, [selectedId]);

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
  const volumeCounts = useMemo(() => {
    const counts = Object.fromEntries(volumeOptions.map(item => [item.value, 0])) as Record<VolumeType, number>;
    chapters.forEach(chapter => {
      counts[inferVolumeType(chapter)] += 1;
      counts.all += 1;
    });
    return counts;
  }, [chapters]);
  const filteredChapters = useMemo(() => {
    const term = keyword.trim();
    const volumeFiltered = activeVolume === 'all'
      ? chapters
      : chapters.filter(chapter => inferVolumeType(chapter) === activeVolume);
    if (!term) {
      return volumeFiltered;
    }
    const matchedIds = new Set(volumeFiltered.filter(chapter => (chapter.title || '').includes(term)).map(chapter => chapter.id));
    const byId = new Map(volumeFiltered.map(chapter => [chapter.id, chapter]));
    matchedIds.forEach(id => {
      let parentId = byId.get(id)?.parent_id || null;
      while (parentId) {
        matchedIds.add(parentId);
        parentId = byId.get(parentId)?.parent_id || null;
      }
    });
    return volumeFiltered.filter(chapter => matchedIds.has(chapter.id));
  }, [activeVolume, chapters, keyword]);
  const selectedChapter = filteredChapters.find(chapter => chapter.id === selectedId)
    || filteredChapters[0]
    || (activeVolume === 'all' ? chapters.find(chapter => chapter.id === selectedId) || chapters[0] : undefined);
  const visibleChapters = useMemo(
    () => filteredChapters.filter(chapter => isVisibleChapter(chapter, filteredChapters)),
    [filteredChapters],
  );
  const scopedChapters = activeVolume === 'all' ? chapters : chapters.filter(chapter => inferVolumeType(chapter) === activeVolume);
  const matchText = keyword ? `${filteredChapters.length} / ${scopedChapters.length}` : `0 / ${scopedChapters.length}`;
  const actualChars = scopedChapters.reduce((sum, chapter) => sum + (isChapterGenerated(chapter) ? chapterActualWords(chapter) : 0), 0);
  const estimatedTotalChars = scopedChapters.reduce((sum, chapter) => (
    sum + (isChapterGenerated(chapter) ? chapterActualWords(chapter) : targetChapterWords(chapter))
  ), 0);
  const estimatedPages = Math.max(1, Math.ceil(estimatedTotalChars / 700));
  const generatedCount = scopedChapters.filter(isChapterGenerated).length;
  const generationProgress = scopedChapters.length ? Math.round((generatedCount / scopedChapters.length) * 10000) / 100 : 0;

  function chapterActualWords(chapter: ChapterDraft): number {
    return (chapter.content || '').replace(/\s+/g, '').length;
  }

  function fallbackChapterWords(chapter: ChapterDraft): number {
    return Math.max(420, Math.min(1200, Math.round(((chapter.level || 1) <= 2 ? 680 : 520) / 10) * 10));
  }

  function chapterWritingPlan(chapter: ChapterDraft): ChapterWritingPlan {
    const metadata = chapter.metadata || {};
    const plan = metadata.writing_plan;
    if (plan && typeof plan === 'object') {
      return plan as ChapterWritingPlan;
    }
    const title = `${chapter.title || ''} ${chapter.purpose || ''}`;
    const isTechnical = /技术|施工组织|实施方案|质量|安全|环保|进度|发包人要求|承包人建议/.test(title);
    const isQualification = /资格|资质|证书|营业执照|人员|项目经理|技术负责人/.test(title);
    const isFormat = /投标函|格式|授权|保证金|声明|承诺|偏离/.test(title);
    const targetWords = isTechnical ? ((chapter.level || 1) <= 2 ? 6200 : 2800) : isQualification ? 2600 : isFormat ? 900 : fallbackChapterWords(chapter);
    return {
      importance: chapter.priority || (isTechnical || isQualification ? 'high' : 'medium'),
      target_words: targetWords,
      suggested_pages: `${Math.max(1, Math.round(targetWords / 900))}-${Math.max(1, Math.round(targetWords / 650))}`,
      needs_table: /报价|清单|人员|业绩|偏离|进度|参数|评分/.test(title),
      needs_image: isTechnical || /设备|产品|工艺|流程|布置/.test(title),
      needs_qualification: isQualification,
      needs_case: /业绩|案例|类似项目|施工组织|技术|质量|安全/.test(title),
      generation_mode: targetWords >= 3500 ? 'multi_pass' : 'single_pass',
    };
  }

  function targetChapterWords(chapter: ChapterDraft): number {
    const targetWords = chapterWritingPlan(chapter).target_words;
    return typeof targetWords === 'number' && Number.isFinite(targetWords) ? targetWords : fallbackChapterWords(chapter);
  }

  function isChapterFailed(chapter: ChapterDraft): boolean {
    const task = batchTasks[chapter.id];
    if (['generated', 'edited', 'completed'].includes(chapter.status || '')) return false;
    if (task?.status === 'queued' || task?.status === 'running' || task?.status === 'done') return false;
    return task?.status === 'failed' || chapter.status === 'failed';
  }

  function chapterWordMeta(chapter: ChapterDraft): { label: string; tooltip: string; generated: boolean; failed: boolean } {
    if (isChapterFailed(chapter)) {
      return {
        label: '生成失败',
        tooltip: '本章节正文生成失败，请点击“重写正文”重新生成。',
        generated: false,
        failed: true,
      };
    }
    const generated = isChapterGenerated(chapter);
    if (generated) {
      return {
        label: `已完成 ${chapterActualWords(chapter)}字`,
        tooltip: `已完成字数：按当前章节正文去除空白后统计。计划目标：${targetChapterWords(chapter)}字。`,
        generated: true,
        failed: false,
      };
    }
    return {
      label: `目标 ${targetChapterWords(chapter)}字`,
      tooltip: '目标字数：来自章节写作计划；如当前项目尚未保存计划，则按章节标题、层级和用途临时推导。',
      generated: false,
      failed: false,
    };
  }

  function chapterImportanceLabel(plan: ChapterWritingPlan): string {
    if (plan.importance === 'high') return '核心章节';
    if (plan.importance === 'low') return '普通章节';
    return '重点章节';
  }

  function batchStatusLabel(status: BatchTaskStatus): string {
    if (status === 'queued') return '排队中';
    if (status === 'running') return '正在编写';
    if (status === 'done') return '已完成';
    if (status === 'stopped') return '已停止';
    return '失败';
  }

  function batchStatusColor(status: BatchTaskStatus): 'default' | 'processing' | 'success' | 'error' {
    if (status === 'running') return 'processing';
    if (status === 'done') return 'success';
    if (status === 'failed') return 'error';
    return 'default';
  }

  function chapterStatusClass(chapter: ChapterDraft): string {
    const task = batchTasks[chapter.id];
    if (task?.status === 'running') return 'running';
    if (chapter.status === 'generating') return 'running';
    if (isChapterFailed(chapter)) return 'failed';
    if (task?.status === 'done' || isChapterGenerated(chapter)) return 'done';
    if (task?.status === 'stopped') return 'pending';
    return 'pending';
  }

  function isChapterGenerated(chapter: ChapterDraft): boolean {
    if (isChapterFailed(chapter)) return false;
    const status = chapter.status || '';
    if (!['generated', 'edited', 'completed'].includes(status)) return false;
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
      setDownloadUrl('');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function downloadDocx(sectionId?: string): Promise<void> {
    if (!data?.project?.id) {
      message.warning('当前项目不存在，无法下载');
      return;
    }
    setDownloadGenerating(sectionId ? 'section' : 'full');
    try {
      const result = await generateBidDocxDownload(data.project.id, {
        sectionId,
        withImages: !sectionId && withImages,
        volumeType: !sectionId && activeVolume !== 'all' ? activeVolume : undefined,
      });
      setDownloadUrl(result.downloadUrl);
      window.open(result.downloadUrl, '_blank');
      message.success(sectionId ? '本章 DOCX 已生成' : `${activeVolume === 'all' ? '全文' : volumeLabel(activeVolume)} DOCX 已生成`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDownloadGenerating(null);
    }
  }

  async function resetGenerationStatus(): Promise<void> {
    if (!data?.project?.id) {
      message.warning('当前项目不存在，无法重置');
      return;
    }
    setResettingGeneration(true);
    try {
      const saved = await resetBidSectionsGeneration(data.project.id, resetClearContent);
      const savedById = new Map(saved.map(section => [section.id, section]));
      setChapters(items => normalizeChapterHierarchy(items.map(item => {
        const savedItem = savedById.get(item.id);
        return {
          ...item,
          ...(savedItem || {}),
          status: 'draft',
          content: resetClearContent ? '' : (savedItem?.content ?? item.content),
        };
      })));
      setBatchTasks({});
      setDownloadUrl('');
      setResetModalOpen(false);
      message.success(resetClearContent ? '已重置全部章节状态，并清空正文' : '已重置全部章节生成状态');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setResettingGeneration(false);
    }
  }

  function appendChapterContent(chapterId: string, value: string): void {
    setChapters(items => items.map(item => item.id === chapterId ? { ...item, content: `${item.content}${value}` } : item));
  }

  function updateBatchTask(chapterId: string, patch: Partial<BatchTask>): void {
    setBatchTasks(tasks => ({
      ...tasks,
      [chapterId]: {
        ...(tasks[chapterId] || {
          status: 'queued',
          percent: 0,
          chars: 0,
          targetWords: 800,
        }),
        ...patch,
      },
    }));
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

  function outlineMoreMenuItems(chapter: ChapterDraft): MenuProps['items'] {
    return [
      { key: 'custom', label: '自定义编写' },
      { key: 'add', label: '新增子章节', icon: <Plus size={14} /> },
      { key: 'rename', label: '修改标题' },
      { key: 'move-up', label: '上移章节', icon: <ArrowUp size={14} />, disabled: !canMoveChapter(chapter, 'up') },
      { key: 'move-down', label: '下移章节', icon: <ArrowDown size={14} />, disabled: !canMoveChapter(chapter, 'down') },
      { type: 'divider' },
      { key: 'delete', label: '删除章节', icon: <Trash2 size={14} />, danger: true },
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

  async function streamSectionContent(
    targetChapter: ChapterDraft,
    options?: {
      onStart?: (title?: string) => void;
      onChunk?: (content: string, accumulatedContent: string) => void;
      onDone?: () => void;
      signal?: AbortSignal;
    },
  ): Promise<void> {
    if (!data?.project?.id) {
      throw new Error('当前项目不存在，无法生成章节正文');
    }

    const response = await fetch(`/api/bidding/interpretations/${data.project.id}/sections/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...targetChapter, withImages }),
      signal: options?.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`章节正文生成失败：${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedContent = `## ${targetChapter.title || '未命名章节'}\n\n`;

    function handleFrame(frame: string): void {
      const eventLine = frame.split('\n').find(line => line.startsWith('event:'));
      const dataLine = frame.split('\n').find(line => line.startsWith('data:'));
      const eventName = eventLine?.replace('event:', '').trim() || 'message';
      const dataText = dataLine?.replace('data:', '').trim();
      if (!dataText) {
        return;
      }
      const payload = JSON.parse(dataText) as { content?: string; error?: string; title?: string; id?: string; oldId?: string };
      if (eventName === 'start') {
        options?.onStart?.(payload.title);
      }
      if (eventName === 'chunk' && payload.content) {
        accumulatedContent += payload.content;
        appendChapterContent(targetChapter.id, payload.content);
        options?.onChunk?.(payload.content, accumulatedContent);
      }
      if (eventName === 'done') {
        options?.onDone?.();
      }
      if (eventName === 'saved' && payload.id && payload.oldId && payload.id !== payload.oldId) {
        const savedId = payload.id;
        const oldId = payload.oldId;
        setChapters(items => items.map(item => item.id === oldId ? { ...item, id: savedId, status: 'generated' } : item));
        setSelectedId(current => current === oldId ? savedId : current);
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
  }

  async function generateCurrentSection(targetChapter = selectedChapter, options?: { preserveMode?: boolean }): Promise<void> {
    if (!data?.project?.id || !targetChapter) {
      message.warning('请先选择需要生成正文的章节');
      return;
    }
    if (batchGenerating) {
      message.warning('全文批量编写正在执行，请等待完成后再单章重写');
      return;
    }
    if (!options?.preserveMode) {
      setMode('正文模式');
    }
    setSelectedId(targetChapter.id);
    setBatchTasks(tasks => {
      const next = { ...tasks };
      delete next[targetChapter.id];
      return next;
    });
    setSectionStreaming(true);
    setStreamText(`正在生成章节正文：${targetChapter.title || '未命名章节'}`);
    setChapters(items => items.map(item => item.id === targetChapter.id ? { ...item, status: 'generating', content: `## ${targetChapter.title || '未命名章节'}\n\n` } : item));

    try {
      await streamSectionContent(targetChapter, {
        onStart: title => {
          setStreamText(`AI 正在撰写：${title || targetChapter.title || '当前章节'}`);
        },
        onDone: () => {
          setStreamText('章节正文生成完成，可继续人工编辑。');
          setChapters(items => items.map(item => item.id === targetChapter.id ? { ...item, status: 'generated' } : item));
          setBatchTasks(tasks => {
            const next = { ...tasks };
            delete next[targetChapter.id];
            return next;
          });
        },
      });
      message.success('章节正文已生成');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setChapters(items => items.map(item => item.id === targetChapter.id ? { ...item, status: 'failed', content: '' } : item));
      message.error(reason);
    } finally {
      setSectionStreaming(false);
    }
  }

  async function generateSectionForBatch(chapter: ChapterDraft): Promise<void> {
    if (batchCancelRequestedRef.current) {
      updateBatchTask(chapter.id, {
        status: 'stopped',
        percent: 0,
        message: '已停止',
      });
      return;
    }
    const targetWords = targetChapterWords(chapter);
    const chapterHeader = `## ${chapterDisplayTitle(chapter)}\n\n`;
    const controller = new AbortController();
    batchAbortControllersRef.current.set(chapter.id, controller);
    updateBatchTask(chapter.id, {
      status: 'running',
      percent: 2,
      chars: 0,
      targetWords,
      message: '正在编写',
    });
    setChapters(items => items.map(item => item.id === chapter.id ? { ...item, status: 'generating', content: chapterHeader } : item));

    try {
      await streamSectionContent(chapter, {
        signal: controller.signal,
        onChunk: (_content, accumulatedContent) => {
          if (batchCancelRequestedRef.current) {
            return;
          }
          const chars = accumulatedContent.replace(/\s+/g, '').length;
          updateBatchTask(chapter.id, {
            status: 'running',
            chars,
            percent: Math.min(98, Math.max(3, Math.round((chars / Math.max(targetWords, 1)) * 100))),
            message: '正在编写',
          });
        },
        onDone: () => {
          if (batchCancelRequestedRef.current) {
            updateBatchTask(chapter.id, {
              status: 'stopped',
              message: '已停止',
            });
            return;
          }
          updateBatchTask(chapter.id, {
            status: 'done',
            percent: 100,
            message: '已完成',
          });
          setChapters(items => items.map(item => item.id === chapter.id ? { ...item, status: 'generated' } : item));
        },
      });
    } catch (error) {
      if (controller.signal.aborted || batchCancelRequestedRef.current) {
        updateBatchTask(chapter.id, {
          status: 'stopped',
          message: '已停止',
        });
        return;
      }
      updateBatchTask(chapter.id, {
        status: 'failed',
        percent: 100,
        message: error instanceof Error ? error.message : String(error),
      });
      setChapters(items => items.map(item => item.id === chapter.id ? { ...item, status: 'failed', content: '' } : item));
    } finally {
      batchAbortControllersRef.current.delete(chapter.id);
    }
  }

  async function generateAllSectionsInBatch(): Promise<void> {
    if (!data?.project?.id || !chapters.length) {
      message.warning('当前没有可编写的章节');
      return;
    }
    if (sectionStreaming || batchGenerating) {
      message.warning('已有章节生成任务正在执行');
      return;
    }

    const sourceChapters = activeVolume === 'all' ? chapters : chapters.filter(chapter => inferVolumeType(chapter) === activeVolume);
    const targets = sourceChapters.filter(chapter => !isChapterGenerated(chapter));
    if (!targets.length) {
      message.info(`当前${volumeLabel(activeVolume)}章节都已生成，如需重写请点击单章重写正文`);
      return;
    }

    setMode('目录模式');
    setBatchGenerating(true);
    batchCancelRequestedRef.current = false;
    batchAbortControllersRef.current.clear();
    setDownloadUrl('');
    setBatchTasks(Object.fromEntries(targets.map(chapter => [chapter.id, {
      status: 'queued' as BatchTaskStatus,
      percent: 0,
      chars: 0,
      targetWords: targetChapterWords(chapter),
      message: '排队中',
    }])));

    let cursor = 0;
    async function worker(): Promise<void> {
      while (cursor < targets.length && !batchCancelRequestedRef.current) {
        const current = targets[cursor];
        cursor += 1;
        await generateSectionForBatch(current);
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(BATCH_SECTION_CONCURRENCY, targets.length) }, () => worker()));
      if (batchCancelRequestedRef.current) {
        setBatchTasks(tasks => Object.fromEntries(Object.entries(tasks).map(([id, task]) => [
          id,
          task.status === 'queued' || task.status === 'running'
            ? { ...task, status: 'stopped' as BatchTaskStatus, message: '已停止' }
            : task,
        ])));
        message.info('全文批量编写已停止');
      } else {
        message.success('全文批量编写任务已完成');
      }
    } finally {
      setBatchGenerating(false);
    }
  }

  function stopBatchGeneration(): void {
    if (!batchGenerating) {
      return;
    }
    batchCancelRequestedRef.current = true;
    batchAbortControllersRef.current.forEach(controller => controller.abort());
    setBatchTasks(tasks => Object.fromEntries(Object.entries(tasks).map(([id, task]) => [
      id,
      task.status === 'queued' || task.status === 'running'
        ? { ...task, status: 'stopped' as BatchTaskStatus, message: '已停止' }
        : task,
    ])));
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
              loading={downloadGenerating === 'full'}
            disabled={!scopedChapters.length || !!downloadGenerating}
            onClick={() => void downloadDocx()}
          >
            {activeVolume === 'all' ? '标书下载' : `下载${volumeLabel(activeVolume)}`}
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
            <Segmented<VolumeType>
              className="volume-segmented"
              value={activeVolume}
              onChange={value => {
                setActiveVolume(value);
                setSelectedId('');
              }}
              options={volumeOptions.map(item => ({
                label: `${item.shortLabel} ${volumeCounts[item.value] || 0}`,
                value: item.value,
              }))}
            />
            <div className="outline-summary">
              <span>{volumeLabel(activeVolume)}章节：{scopedChapters.length}</span>
              <span>已生成：{generatedCount}</span>
              <span>已完成字数：{actualChars}</span>
              <span>预计总字数：{estimatedTotalChars}（约{estimatedPages}页）</span>
              <span>进度：{generationProgress}%</span>
              {batchGenerating ? <span>批量并发：{BATCH_SECTION_CONCURRENCY} 路</span> : null}
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
                  <input
                    type="checkbox"
                    checked={withImages}
                    onChange={event => setWithImages(event.target.checked)}
                  />
                  <span>全篇图文并茂</span>
                </label>
                <Button size="small" icon={<SlidersHorizontal size={14} />}>全文设置</Button>
                <Button
                  size="small"
                  danger
                  icon={<RotateCcw size={14} />}
                  disabled={!chapters.length || batchGenerating || sectionStreaming}
                  onClick={() => {
                    setResetClearContent(false);
                    setResetModalOpen(true);
                  }}
                >
                  重置生成状态
                </Button>
                <Button size="small" icon={<Download size={14} />}>下载目录</Button>
              </Space>
            </div>

            <div className="outline-table">
              {visibleChapters.map(chapter => {
                const wordMeta = chapterWordMeta(chapter);
                const plan = chapterWritingPlan(chapter);
                const task = batchTasks[chapter.id];
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
                      <span>{chapterDisplayTitle(chapter)}</span>
                    </button>
                    <Tooltip title={wordMeta.tooltip}>
                      <div className={`outline-word-pill ${wordMeta.failed ? 'failed' : wordMeta.generated ? 'done' : 'pending'}`}>
                        {wordMeta.generated ? <CheckCircle2 size={13} /> : null}
                        <span>{wordMeta.label}</span>
                      </div>
                    </Tooltip>
                    <div className="outline-plan-tags">
                      {task ? (
                        <div className="outline-task-progress">
                          <Tag color={batchStatusColor(task.status)}>{batchStatusLabel(task.status)}</Tag>
                          <Progress percent={task.percent} size="small" showInfo={false} status={task.status === 'failed' ? 'exception' : undefined} />
                        </div>
                      ) : null}
                      <Tag color={plan.importance === 'high' ? 'red' : plan.importance === 'low' ? 'default' : 'blue'}>{chapterImportanceLabel(plan)}</Tag>
                      <Tag color="geekblue">建议 {plan.suggested_pages || '1-2'} 页</Tag>
                      {plan.needs_table ? <Tag color="cyan">需表格</Tag> : null}
                      {plan.needs_image ? <Tag color="purple">需图文</Tag> : null}
                      {plan.needs_qualification ? <Tag color="orange">需资质</Tag> : null}
                      {plan.needs_case ? <Tag color="green">需业绩</Tag> : null}
                    </div>
                    <div className="outline-row-actions">
                      <Button
                        type="link"
                        size="small"
                        icon={<Sparkles size={14} />}
                        loading={(sectionStreaming && selectedId === chapter.id) || task?.status === 'running'}
                        disabled={batchGenerating}
                        onClick={() => void generateCurrentSection(chapter)}
                      >
                        {wordMeta.generated ? '重写正文' : '生成正文'}
                      </Button>
                      <Button type="link" size="small" icon={<Eye size={14} />} onClick={() => previewChapter(chapter)}>预览</Button>
                      <Dropdown
                        trigger={['click']}
                        menu={{
                          items: outlineMoreMenuItems(chapter),
                          onClick: info => handleChapterMenu(info.key, chapter),
                        }}
                      >
                        <Button type="link" size="small" icon={<MoreVertical size={14} />}>更多</Button>
                      </Dropdown>
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
              loading={batchGenerating}
              disabled={!chapters.length || sectionStreaming}
              onClick={() => void generateAllSectionsInBatch()}
            >
              一键编写全文
            </Button>
            {batchGenerating ? (
              <Button
                danger
                size="large"
                icon={<Square size={16} />}
                onClick={stopBatchGeneration}
              >
                停止生成
              </Button>
            ) : null}
            <span />
          </footer>
        </main>

        <Modal
          title="重置章节生成状态"
          open={resetModalOpen}
          okText={resetClearContent ? '重置并清空正文' : '仅重置状态'}
          cancelText="取消"
          okButtonProps={{ danger: resetClearContent, loading: resettingGeneration }}
          onOk={() => void resetGenerationStatus()}
          onCancel={() => setResetModalOpen(false)}
          destroyOnClose
        >
          <Alert
            type="warning"
            showIcon
            message="该操作会把全部章节恢复为未完成状态，用于重新测试或重新生成全文。"
            description={resetClearContent ? '当前已勾选清空正文，确认后所有章节正文会被清空。' : '默认只重置状态、进度和本地生成任务，保留已经生成的正文内容。'}
          />
          <label className="reset-content-option">
            <input
              type="checkbox"
              checked={resetClearContent}
              onChange={event => setResetClearContent(event.target.checked)}
            />
            <span>同时清空全部章节正文内容</span>
          </label>
        </Modal>
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
            loading={downloadGenerating === 'full'}
              disabled={!scopedChapters.length || !!downloadGenerating}
              onClick={() => void downloadDocx()}
            >
              {activeVolume === 'all' ? '标书下载' : `下载${volumeLabel(activeVolume)}`}
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
        <Segmented<VolumeType>
          className="volume-segmented sidebar-volume-segmented"
          value={activeVolume}
          onChange={value => {
            setActiveVolume(value);
            setSelectedId('');
          }}
          options={volumeOptions.map(item => ({
            label: `${item.shortLabel} ${volumeCounts[item.value] || 0}`,
            value: item.value,
          }))}
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
                  <Tooltip title={batchTasks[chapter.id]?.status ? batchStatusLabel(batchTasks[chapter.id].status) : isChapterGenerated(chapter) ? '已完成' : '未完成'}>
                    <span className={`chapter-status ${chapterStatusClass(chapter)}`} />
                  </Tooltip>
                  <span className="chapter-title">{chapterDisplayTitle(chapter)}</span>
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
          <span>当前分册：{volumeLabel(activeVolume)}</span>
          <span>已完成字数：{actualChars}</span>
          <span>约{estimatedPages}页</span>
        </footer>
      </aside>

      <main className="bid-editor-main">
        <section className="editor-title-row">
          <div>
            <h1>{selectedChapter ? chapterDisplayTitle(selectedChapter) : '未选择章节'}</h1>
            <p>{streaming ? streamText : selectedChapter?.purpose || '使用 AI 编辑器编写章节正文，支持标题、列表、表格和 Markdown 存储。'}</p>
          </div>
          <Space>
            {streaming ? <Tag color="processing">大纲生成中</Tag> : null}
            {sectionStreaming ? <Tag color="processing">正文生成中</Tag> : null}
            {selectedChapter ? <Tag color="blue">{volumeLabel(inferVolumeType(selectedChapter))}</Tag> : null}
            <Button icon={<Sparkles size={16} />} loading={sectionStreaming} disabled={!selectedChapter || streaming} onClick={() => void generateCurrentSection()}>生成本章正文</Button>
            <Button
              icon={<Download size={16} />}
              loading={downloadGenerating === 'section'}
              disabled={!selectedChapter || !!downloadGenerating}
              onClick={() => selectedChapter && void downloadDocx(selectedChapter.id)}
            >
              下载本章
            </Button>
          </Space>
        </section>

        <section className="editor-workspace">
          {selectedChapter ? (
            <TiptapBidEditor
              content={selectedChapter.content || ''}
              onChange={handleEditorChange}
              placeholder="开始编写标书章节内容..."
            />
          ) : (
            <div className="editor-empty">
              <Empty description="请选择一个章节开始编辑" />
            </div>
          )}
        </section>

        <footer className="editor-statusbar">
          <span>当前章节：{selectedChapter ? chapterDisplayTitle(selectedChapter) : '-'}</span>
          <span>来源页码：{selectedChapter?.source_pages?.join('、') || '需复核'}</span>
          <span>Tiptap AI 编辑器</span>
        </footer>
      </main>
    </div>
  );
}
