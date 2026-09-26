export const LogLevel = Object.freeze({ Debug: 0, Info: 1, Warn: 2, Error: 3 });

const LEVEL_NAMES = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

export function createLog({ capacity = 500 } = {}) {
  const entries = [];
  const listeners = new Set();
  let minLevel = LogLevel.Debug;

  function write(level, category, message) {
    if (level < minLevel) return null;
    const entry = Object.freeze({
      time: Date.now(), level, levelName: LEVEL_NAMES[level],
      category: String(category), message: String(message)
    });
    entries.push(entry);
    if (entries.length > capacity) entries.shift();
    for (const listener of listeners) listener(entry);
    return entry;
  }

  return {
    debug: (category, message) => write(LogLevel.Debug, category, message),
    info: (category, message) => write(LogLevel.Info, category, message),
    warn: (category, message) => write(LogLevel.Warn, category, message),
    error: (category, message) => write(LogLevel.Error, category, message),
    onEntry(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setLevel(level) { minLevel = level; },
    getLevel() { return minLevel; },
    tail(count = 50) { return entries.slice(-count); },
    get size() { return entries.length; }
  };
}
