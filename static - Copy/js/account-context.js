// Supplied by the protected server-rendered shell, never by localStorage.
export const accountId = document.querySelector('meta[name="hypersense-account"]')?.content || '';
export const accountHeaders = () => accountId ? {'X-HyperSense-Account': accountId} : {};
export const accountKey = key => accountId ? `${key}:${accountId}` : key;
