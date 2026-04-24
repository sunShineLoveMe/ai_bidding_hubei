import { message } from 'antd';
import { useCallback, useRef } from 'react';
import { AIAssistantWidget } from '../components/assistant/AIAssistantWidget';
import { BasicTools } from '../components/home/BasicTools';
import { HeroBanner } from '../components/home/HeroBanner';
import { KnowledgeStats } from '../components/home/KnowledgeStats';
import { RecentTasks } from '../components/home/RecentTasks';
import { SmartBidCard } from '../components/home/SmartBidCard';
import { BidWorkflow } from '../components/workflow/BidWorkflow';

export function HomePage(): JSX.Element {
  const openFilePickerRef = useRef<() => void>(() => undefined);

  const registerFilePicker = useCallback((openFilePicker: () => void) => {
    openFilePickerRef.current = openFilePicker;
  }, []);

  return (
    <div className="home-shell">
      <HeroBanner />
      <SmartBidCard
        onPrimaryAction={() => openFilePickerRef.current()}
        onSecondaryAction={content => message.info(content)}
      />
      <div className="grid grid-cols-[1fr_1.08fr] gap-4 max-[1500px]:grid-cols-1">
        <BasicTools />
        <RecentTasks />
      </div>
      <KnowledgeStats />
      <BidWorkflow onReady={registerFilePicker} />
      <AIAssistantWidget />
    </div>
  );
}
