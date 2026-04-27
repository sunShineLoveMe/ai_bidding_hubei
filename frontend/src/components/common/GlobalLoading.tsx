import { Spin } from 'antd';
import { useLoadingStore } from '../../stores/loadingStore';
import { BrandMark } from './BrandMark';

export function GlobalLoading(): JSX.Element | null {
  const pendingCount = useLoadingStore(state => state.pendingCount);
  const message = useLoadingStore(state => state.message);

  if (pendingCount === 0) {
    return null;
  }

  return (
    <div className="global-loading" role="status" aria-live="polite" aria-label={message}>
      <div className="global-loading-card">
        <BrandMark size={56} className="global-loading-logo" />
        <Spin size="large" />
        <span>{message}</span>
      </div>
    </div>
  );
}
