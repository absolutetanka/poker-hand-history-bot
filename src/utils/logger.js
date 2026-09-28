const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function createLogger(level = 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const log = (name, method) => (...args) => {
    if (LEVELS[name] < threshold) return;
    const stamp = new Date().toISOString();
    console[method](`[${stamp}] ${name.toUpperCase()}`, ...args);
  };

  return {
    debug: log('debug', 'debug'),
    info: log('info', 'info'),
    warn: log('warn', 'warn'),
    error: log('error', 'error')
  };
}

export const logger = createLogger(process.env.LOG_LEVEL);
