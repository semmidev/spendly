import client from '@/lib/client';

// Auth Spendly: hanya Google OAuth. Tidak ada endpoint login kata sandi.

export async function logoutRequest() {
  return client.post('/auth/logout');
}

export async function getCurrentUser() {
  return client.get('/auth/me');
}
