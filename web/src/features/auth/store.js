import { create } from 'zustand';
import {
  getUser,
  getIsAuthenticated,
  setUser,
  clearAuth,
} from '@/lib/tokenStorage';
import {
  logoutRequest,
  getCurrentUser,
} from '@/features/auth/api';

// Auth Spendly: Google OAuth saja (sesi cookie HttpOnly). Tanpa kata sandi.
// Sumber kebenaran = server (/auth/me); localStorage hanya cache tampilan.
export const useAuthStore = create((set) => ({
  user: getUser(),
  isAuthenticated: getIsAuthenticated(),
  isLoading: true, // dipakai initialize() — hydration sesi

  initialize: async () => {
    // Setelah redirect OAuth, cookie sesi sudah ada tapi localStorage kosong.
    // Jadi selalu tanya server; jangan percaya flag lokal saja.
    try {
      const res = await getCurrentUser();
      const userData = res.data?.data || res.data;
      setUser(userData);
      set({ user: userData, isAuthenticated: true, isLoading: false });
    } catch {
      clearAuth();
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  // Keluar: revoke sesi di server lalu bersihkan state lokal.
  logout: async () => {
    try {
      await logoutRequest();
    } catch {
      // Abaikan error network saat logout
    } finally {
      clearAuth();
      set({ user: null, isAuthenticated: false });
    }
  },
}));
