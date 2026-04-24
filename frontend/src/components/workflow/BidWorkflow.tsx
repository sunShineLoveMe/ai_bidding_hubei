import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, message, Segmented, Steps, Upload } from 'antd';
import type { UploadProps } from 'antd';
import { FileUp, PlayCircle } from 'lucide-react';
import {
  analyzeChapters,
  designChapters,
  generateBidDocument,
  identifyUser,
  preAnalyzeBid,
  uploadTenderFile,
} from '../../api/bidProject';
import { useBidProjectStore } from '../../stores/bidProjectStore';
import { formatJson } from '../../utils/format';

type ResultTab = '运行结果' | '预分析' | '章节格式' | '章节设计';

interface BidWorkflowProps {
  onReady?: (openFilePicker: () => void) => void;
}

const steps = ['上传招标文件', 'AI 预分析', '提取章节格式', '生成章节设计', '生成 Word'];

export function BidWorkflow({ onReady }: BidWorkflowProps): JSX.Element {
  const [current, setCurrent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  const [biddingId, setBiddingId] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<unknown>(null);
  const [chapter, setChapter] = useState<unknown>(null);
  const [design, setDesign] = useState<unknown>(null);
  const [tab, setTab] = useState<ResultTab>('运行结果');
  const [log, setLog] = useState('请选择招标文件，并按左侧步骤生成标书。');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const addTask = useBidProjectStore(state => state.addTask);

  const openFilePicker = useCallback(() => inputRef.current?.click(), []);

  useEffect(() => {
    onReady?.(openFilePicker);
  }, [onReady, openFilePicker]);

  const uploadProps: UploadProps = {
    showUploadList: false,
    beforeUpload: selectedFile => {
      setFile(selectedFile);
      setLog(`已选择文件：${selectedFile.name}`);
      return false;
    },
  };

  async function getUserId(): Promise<number> {
    if (userId) return userId;
    const fingerprintId = localStorage.getItem('enshiBiddingFingerprint') || `enshi-bidding-${Date.now()}`;
    localStorage.setItem('enshiBiddingFingerprint', fingerprintId);
    const data = await identifyUser(fingerprintId);
    setUserId(data.userId);
    return data.userId;
  }

  async function runAction(index: number): Promise<void> {
    setBusy(true);
    setTab('运行结果');
    try {
      if (index === 0) {
        if (!file) {
          message.warning('请先选择招标文件');
          return;
        }
        const resolvedUserId = await getUserId();
        const data = await uploadTenderFile(file, resolvedUserId);
        setBiddingId(data.biddingId);
        setCurrent(1);
        setLog(formatJson(data));
        addTask({
          projectName: file.name.replace(/\.[^.]+$/, ''),
          tenderUnit: '本地上传',
          status: '已上传',
          action: '查看',
        });
        message.success('上传完成');
        return;
      }

      if (!biddingId) {
        message.warning('请先上传招标文件');
        return;
      }

      if (index === 1) {
        const data = await preAnalyzeBid(biddingId);
        setAnalysis(data);
        setCurrent(2);
        setLog(formatJson(data));
        message.success('AI 预分析完成');
        return;
      }

      if (index === 2) {
        const data = await analyzeChapters(biddingId);
        setChapter(data);
        setCurrent(3);
        setLog(formatJson(data));
        message.success('章节格式提取完成');
        return;
      }

      if (index === 3) {
        const data = await designChapters(biddingId);
        setDesign(data);
        setCurrent(4);
        setLog(formatJson(data));
        message.success('章节设计完成');
        return;
      }

      if (index === 4) {
        if (!design) {
          message.warning('请先生成章节设计');
          return;
        }
        const data = await generateBidDocument(biddingId, design);
        setDownloadUrl(data.downloadUrl);
        setLog(formatJson(data));
        addTask({
          projectName: file?.name.replace(/\.[^.]+$/, '') || '新建标书任务',
          tenderUnit: '本地上传',
          status: '已导出',
          action: '查看',
        });
        message.success('Word 已生成');
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setLog(reason);
      message.error(reason);
    } finally {
      setBusy(false);
    }
  }

  const resultMap: Record<ResultTab, string> = {
    运行结果: log,
    预分析: formatJson(analysis),
    章节格式: formatJson(chapter),
    章节设计: formatJson(design),
  };

  return (
    <section className="grid min-h-[620px] grid-cols-[380px_1fr] gap-4 max-[1500px]:grid-cols-1">
      <div className="panel-card">
        <h2 className="panel-title">标书生成流程</h2>
        <Upload.Dragger {...uploadProps} className="compact-uploader">
          <div className="flex h-24 flex-col items-center justify-center gap-2">
            <FileUp className="text-blue-500" size={26} />
            <strong className="text-blue-600">{file ? file.name : '选择招标文件'}</strong>
            <span className="text-xs font-semibold text-slate-500">支持 Word、PDF、TXT</span>
          </div>
        </Upload.Dragger>
        <input ref={inputRef} hidden type="file" accept=".doc,.docx,.pdf,.txt" onChange={event => setFile(event.target.files?.[0] ?? null)} />
        <Steps
          className="mt-3 compact-steps"
          size="small"
          direction="vertical"
          current={current}
          items={steps.map((title, index) => ({
            title,
            description: (
              <Button
                size="small"
                type={index === current ? 'primary' : 'default'}
                icon={<PlayCircle size={14} />}
                loading={busy && index === current}
                disabled={busy || index > current}
                onClick={() => void runAction(index)}
              >
                执行
              </Button>
            ),
          }))}
        />
      </div>

      <div className="panel-card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="panel-title mb-0">生成结果</h2>
          <Segmented<ResultTab>
            size="small"
            value={tab}
            options={['运行结果', '预分析', '章节格式', '章节设计']}
            onChange={setTab}
          />
        </div>
        <pre className="result-box">{resultMap[tab]}</pre>
        <div className="mt-3 flex items-center gap-3">
          {downloadUrl ? (
            <Button type="primary" href={downloadUrl} target="_blank">
              下载生成的 Word 文件
            </Button>
          ) : (
            <Button disabled>等待 Word 生成</Button>
          )}
          <span className="text-xs font-semibold text-slate-500">在线编辑器仍由后端返回的 OnlyOffice 配置接入，后续放入编辑器页。</span>
        </div>
      </div>
    </section>
  );
}
