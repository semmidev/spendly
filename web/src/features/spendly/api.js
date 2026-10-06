import client from '@/lib/client';

// Kontrak API Spendly (backend Go, PLAN §7).
// Semua angka laporan dari SQL, bukan dari AI.

export async function getSummary(params = {}) {
  const { data } = await client.get('/dashboard/summary', { params });
  return data;
}

export async function getReport(params = {}) {
  const { data } = await client.get('/reports/monthly', { params });
  return data;
}

export async function getTransactions(params = {}) {
  const { data } = await client.get('/transactions', { params });
  return data;
}

export async function createTransaction(payload) {
  const { data } = await client.post('/transactions', payload);
  return data;
}

export async function deleteTransaction(id) {
  const { data } = await client.delete(`/transactions/${id}`);
  return data;
}

export async function restoreTransaction(id) {
  const { data } = await client.post(`/transactions/${id}/restore`);
  return data;
}

export async function updateTransaction(id, payload) {
  const { data } = await client.patch(`/transactions/${id}`, payload);
  return data;
}

export async function getCategories() {
  const { data } = await client.get('/categories');
  return data;
}

// Review queue & Diabaikan
export async function getReviewQueue() {
  const { data } = await client.get('/review-queue');
  return data?.items || [];
}

export async function confirmReview(id, category) {
  const { data } = await client.post(`/review-queue/${id}/confirm`, category ? { category } : {});
  return data;
}

export async function ignoreReview(id) {
  const { data } = await client.post(`/review-queue/${id}/ignore`);
  return data;
}

export async function getIgnored() {
  const { data } = await client.get('/ignored');
  return data || { transactions: [], emails: [] };
}

export async function correctIgnored(id, category) {
  const { data } = await client.post(`/ignored/${id}/correct`, { category });
  return data;
}

export async function reprocessEmail(id) {
  const { data } = await client.post(`/ignored/emails/${id}/reprocess`);
  return data;
}

// Gmail
export async function getGmailConnections() {
  const { data } = await client.get('/gmail/connections');
  return data?.items || [];
}

export async function disconnectGmail(id) {
  const { data } = await client.delete(`/gmail/connections/${id}`);
  return data;
}

export async function getSenders(connection_id) {
  const { data } = await client.get('/senders', { params: connection_id ? { connection_id } : {} });
  return data;
}

export async function putSenders(connection_id, domains) {
  const { data } = await client.put('/senders', { connection_id, domains });
  return data;
}

export async function addSenderRegistry(domain, label) {
  const { data } = await client.post('/senders/registry', { domain, label });
  return data;
}

export async function deleteSenderRegistry(id) {
  const { data } = await client.delete(`/senders/registry/${id}`);
  return data;
}

export async function startGmailSync(payload = {}) {
  const { data } = await client.post('/gmail/sync', payload);
  return data; // { job_id }
}

export async function getSyncJob(jobId) {
  const { data } = await client.get(`/gmail/sync/${jobId}`);
  return data; // { progress, stats }
}

// Job sinkronisasi yang masih berjalan/dijeda untuk koneksi ini.
export async function getActiveSyncJob(connection_id) {
  const { data } = await client.get('/gmail/sync/active', { params: connection_id ? { connection_id } : {} });
  return data; // { job_id }
}

export async function pauseSyncJob(jobId) {
  const { data } = await client.post(`/gmail/sync/${jobId}/pause`);
  return data;
}

export async function resumeSyncJob(jobId) {
  const { data } = await client.post(`/gmail/sync/${jobId}/resume`);
  return data;
}

export async function cancelSyncJob(jobId) {
  const { data } = await client.post(`/gmail/sync/${jobId}/cancel`);
  return data;
}

export function syncEventsUrl(jobId) {
  return `/api/v1/gmail/sync/${jobId}/events`;
}

export async function updateGmailSettings(id, payload) {
  const { data } = await client.patch(`/gmail/connections/${id}`, payload);
  return data;
}

export async function getSyncStatus(connection_id) {
  const { data } = await client.get('/sync/status', { params: connection_id ? { connection_id } : {} });
  return data;
}

export async function getSyncHistory(connection_id, limit = 20) {
  const { data } = await client.get('/gmail/sync/history', { params: { ...(connection_id ? { connection_id } : {}), limit } });
  return data?.items || [];
}

export async function getSyncDetail(jobId) {
  const { data } = await client.get(`/gmail/sync/${jobId}/detail`);
  return data;
}
