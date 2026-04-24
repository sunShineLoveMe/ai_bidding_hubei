import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { EmptyRoutePage } from './components/common/EmptyRoutePage';
import { GlobalLoading } from './components/common/GlobalLoading';
import { HomePage } from './pages/HomePage';
import { KnowledgeBasePage } from './pages/KnowledgeBase';
import { ProductBasePage } from './pages/ProductBase';
import { QualificationBasePage } from './pages/QualificationBase';
import { SettingsPage } from './pages/Settings';

export function App(): JSX.Element {
  return (
    <>
      <AppLayout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/bidding" element={<HomePage />} />
          <Route path="/knowledge" element={<KnowledgeBasePage />} />
          <Route path="/qualification" element={<QualificationBasePage />} />
          <Route path="/products" element={<ProductBasePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/history" element={<EmptyRoutePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppLayout>
      <GlobalLoading />
    </>
  );
}
