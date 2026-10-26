const KEY = 'theadoc:admin-token'

export function readAdminToken(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function clearAdminToken() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing stored, nothing to clear.
  }
}

/**
 * Stores the token from an admin link (`/admin#<token>`) and leaves the admin path. The token sits in
 * the fragment, so it is never sent to the server, written to access logs or leaked via Referer.
 */
export function captureAdminLink() {
  if (location.pathname !== '/admin') return
  const token = decodeURIComponent(location.hash.slice(1))
  try {
    if (token) localStorage.setItem(KEY, token)
  } catch {
    // Storage is unavailable; the session simply stays non-admin.
  }
  history.replaceState({}, '', '/')
}
