export const API_BASE = '/api';

export function getAuthToken() {
    return localStorage.getItem('auth_token');
}

export function setAuthToken(token) {
    localStorage.setItem('auth_token', token);
}

export function clearAuthToken() {
    localStorage.removeItem('auth_token');
}

export async function fetchWithAuth(endpoint, context, signal) {
    const url = new URL(`${API_BASE}/${endpoint}`, window.location.origin);
    if (context) {
        url.searchParams.append('context', context);
    }

    const headers = {};
    const token = getAuthToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url.toString(), { signal, headers });

    if (response.status === 401) {
        clearAuthToken();
        window.location.reload();
        throw { requiresAuth: true };
    }

    // Check if the response is JSON (if api fails badly, it might send HTML)
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
        const data = await response.json();

        if (data.requiresAuth) {
            throw { requiresAuth: true };
        }

        if (!response.ok || data.error) {
            throw new Error(data.error || 'API Request Failed');
        }

        return data;
    } else {
        const textError = await response.text();
        throw new Error(`Non-JSON response: ${response.status} ${response.statusText}`);
    }
}
