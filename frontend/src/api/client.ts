import axios from 'axios';

export const apiClient = axios.create({
  baseURL: '/',
  timeout: 120000,
});

apiClient.interceptors.response.use(
  response => response,
  error => {
    const message = error.response?.data?.error || error.message || '请求失败';
    return Promise.reject(new Error(message));
  },
);
