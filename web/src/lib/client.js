import axios from 'axios';
import { clearAuth, getCsrfToken } from './tokenStorage';

const client = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

let isRefreshing = false;
let failedQueue = [];
let activeRequests = 0;
const loadingListeners = new Set();

const unsafeMethods = ['post', 'put', 'patch', 'delete'];

export function subscribeLoading(listener) {
  loadingListeners.add(listener);
  return () => loadingListeners.delete(listener);
}

function notifyLoading() {
  const isLoading = activeRequests > 0;
  loadingListeners.forEach((listener) => listener(isLoading, activeRequests));
}

function processQueue(error) {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve();
    }
  });
  failedQueue = [];
}

client.interceptors.request.use(
  (config) => {
    activeRequests++;
    notifyLoading();

    // Double-submit CSRF token for mutating requests (server validates it).
    const method = (config.method || 'get').toLowerCase();
    if (unsafeMethods.includes(method)) {
      const csrfToken = getCsrfToken();
      if (csrfToken) {
        config.headers['X-CSRF-Token'] = csrfToken;
      }
    }

    return config;
  },
  (error) => {
    activeRequests = Math.max(0, activeRequests - 1);
    notifyLoading();
    return Promise.reject(error);
  }
);

client.interceptors.response.use(
  (response) => {
    activeRequests = Math.max(0, activeRequests - 1);
    notifyLoading();

    if (response.data && typeof response.data === 'object' && 'success' in response.data) {
      const payload = response.data.data;
      const meta = response.data.meta;
      if (Array.isArray(payload)) {
        return { ...response, data: { items: payload, meta } };
      }
      if (payload && typeof payload === 'object' && meta && !payload.meta) {
        return { ...response, data: { ...payload, meta } };
      }
      return { ...response, data: payload !== undefined ? payload : response.data };
    }
    return response;
  },
  async (error) => {
    activeRequests = Math.max(0, activeRequests - 1);
    notifyLoading();
    const originalRequest = error.config;
    const status = error.response?.status;

    if (status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    // Jangan coba refresh untuk probe sesi (/auth/me) — cukup 401 apa adanya.
    const skipUrls = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/me'];
    const requestUrl = originalRequest.url || '';
    if (skipUrls.some((u) => requestUrl.includes(u))) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      })
        .then(() => {
          return client(originalRequest);
        })
        .catch((err) => Promise.reject(err));
    }

    originalRequest._retry = true;
    isRefreshing = true;

    // Small delay (100ms) to allow WebKit cookie jar to commit Set-Cookie headers
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      // Refresh token travels in the HttpOnly cookie; nothing to read from JS.
      await axios.post('/api/v1/auth/refresh', {}, { withCredentials: true });

      processQueue(null);
      return client(originalRequest);
    } catch (refreshError) {
      clearAuth();
      processQueue(refreshError);
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

export default client;
