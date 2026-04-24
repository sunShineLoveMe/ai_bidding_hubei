export interface UploadResponse {
  message: string;
  biddingId: number;
  originalFilename: string;
}

export interface GenerateBidDocumentResponse {
  message: string;
  markdown: string;
  editorConfig: Record<string, unknown>;
  fileUrl: string;
  downloadUrl: string;
}

export interface RecentTask {
  id: string;
  projectName: string;
  tenderUnit: string;
  createdAt: string;
  status: '待编辑' | '生成中' | '已导出' | '解析完成' | '已上传';
  action: '查看' | '继续' | '生成';
}
