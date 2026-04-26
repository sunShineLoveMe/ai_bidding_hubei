import { apiClient } from './client';
import type { GenerateBidDocumentResponse, ParseStatusResponse, UploadResponse } from '../types/bid';
import type { BidSection, InterpretationResponse } from '../types/interpretation';

export async function identifyUser(fingerprintId: string): Promise<{ userId: number; isNew: boolean }> {
  const response = await apiClient.post('/api/users/identify', { fingerprintId });
  return response.data;
}

export async function uploadTenderFile(file: File, userId: number): Promise<UploadResponse> {
  const form = new FormData();
  form.append('file', file);
  form.append('userId', String(userId));
  const response = await apiClient.post('/api/bidding/upload', form);
  return response.data;
}

export async function getParseStatus(fileId: string): Promise<ParseStatusResponse> {
  const response = await apiClient.get(`/api/bidding/parse-status/${fileId}`, { skipGlobalLoading: true });
  return response.data;
}

export async function getLatestInterpretation(): Promise<InterpretationResponse> {
  const response = await apiClient.get('/api/bidding/interpretations/latest');
  return response.data;
}

export async function getInterpretation(projectId: string): Promise<InterpretationResponse> {
  const response = await apiClient.get(`/api/bidding/interpretations/${projectId}`);
  return response.data;
}

export async function generateAIInterpretation(projectId: string): Promise<unknown> {
  const response = await apiClient.post(`/api/bidding/interpretations/${projectId}/ai-report`, undefined, {
    skipGlobalLoading: true,
  });
  return response.data;
}

export async function generateBidOutline(projectId: string): Promise<unknown> {
  const response = await apiClient.post(`/api/bidding/interpretations/${projectId}/bid-outline`, undefined, {
    skipGlobalLoading: true,
  });
  return response.data;
}

export async function getBidSections(projectId: string): Promise<BidSection[]> {
  const response = await apiClient.get(`/api/bidding/interpretations/${projectId}/sections`);
  return response.data.sections || [];
}

export async function saveBidSection(projectId: string, section: Partial<BidSection>): Promise<BidSection> {
  const response = await apiClient.post(`/api/bidding/interpretations/${projectId}/sections`, section, {
    skipGlobalLoading: true,
  });
  return response.data.section;
}

export async function deleteBidSection(projectId: string, sectionId: string): Promise<void> {
  await apiClient.delete(`/api/bidding/interpretations/${projectId}/sections/${sectionId}`, {
    skipGlobalLoading: true,
  });
}

export async function preAnalyzeBid(biddingId: number): Promise<unknown> {
  const response = await apiClient.post('/api/bidding/pre-analysis_bid', { biddingId });
  return response.data;
}

export async function analyzeChapters(biddingId: number): Promise<unknown> {
  const response = await apiClient.post('/api/bidding/chapter-analysis_bid', { biddingId });
  return response.data;
}

export async function designChapters(biddingId: number): Promise<unknown> {
  const response = await apiClient.post('/api/bidding/chapter-design', { biddingId });
  return response.data;
}

export async function generateBidDocument(
  biddingId: number,
  chapterDesign: unknown,
): Promise<GenerateBidDocumentResponse> {
  const response = await apiClient.post('/api/bidding/generate-bid-document', {
    biddingId,
    chapterDesign,
  });
  return response.data;
}
