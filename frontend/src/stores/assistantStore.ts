import { create } from 'zustand';

export interface AssistantMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
}

interface AssistantState {
  open: boolean;
  messages: AssistantMessage[];
  setOpen: (open: boolean) => void;
  addMessage: (message: Omit<AssistantMessage, 'id'>) => void;
}

const initialMessages: AssistantMessage[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content: '你好，我是 AI 标书助手。可解答系统使用、标书编写、资料入库等问题。',
  },
  {
    id: 'sample-user',
    role: 'user',
    content: '我第一次使用，应该先做什么？',
  },
  {
    id: 'sample-assistant',
    role: 'assistant',
    content: '建议先完善企业知识库、资信库和产品库，然后上传招标文件，系统会自动解析并生成标书目录。',
  },
];

export const useAssistantStore = create<AssistantState>(set => ({
  open: false,
  messages: initialMessages,
  setOpen: open => set({ open }),
  addMessage: message =>
    set(state => ({
      messages: [
        ...state.messages,
        {
          ...message,
          id: `${Date.now()}-${state.messages.length}`,
        },
      ],
    })),
}));
