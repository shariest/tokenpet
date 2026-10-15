export const shellQuote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
