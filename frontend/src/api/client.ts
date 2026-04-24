import axios from 'axios';
import { useLoadingStore } from '../stores/loadingStore';

export const apiClient = axios.create({
  baseURL: '/',
  timeout: 120000,
});

apiClient.interceptors.request.use(
  config => {
    useLoadingStore.getState().start();
    return config;
  },
  error => {
    useLoadingStore.getState().finish();
    return Promise.reject(error);
  },
);

apiClient.interceptors.response.use(
  response => {
    useLoadingStore.getState().finish();
    return response;
  },
  error => {
    useLoadingStore.getState().finish();
    const message = error.response?.data?.error || error.message || '请求失败';
    return Promise.reject(new Error(message));
  },
);
