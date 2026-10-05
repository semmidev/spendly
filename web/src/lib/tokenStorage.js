// Auth tokens are stored exclusively in HttpOnly cookies set by the server.
// localStorage only keeps non-sensitive UI state (cached user + auth flag) so
// that an XSS cannot exfiltrate the refresh/access tokens.
const USER_KEY = 'spendly_user';
const AUTH_FLAG_KEY = 'spendly_is_authenticated';
const CSRF_COOKIE_NAME = 'csrf_token';

export function getUser() {
  const data = localStorage.getItem(USER_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function getIsAuthenticated() {
  return localStorage.getItem(AUTH_FLAG_KEY) === 'true';
}

export function setUser(user) {
  if (!user) {
    clearAuth();
    return;
  }
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.setItem(AUTH_FLAG_KEY, 'true');
}

export function clearAuth() {
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(AUTH_FLAG_KEY);
}

// getCsrfToken reads the readable csrf_token cookie for the double-submit
// pattern used on state-changing requests.
export function getCsrfToken() {
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${CSRF_COOKIE_NAME}=`));
  if (!match) return '';
  return decodeURIComponent(match.split('=').slice(1).join('='));
}
