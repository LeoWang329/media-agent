const queues = new Map<string, Promise<unknown>>();

// 同一个文件的读改写排队进行，免得流式落盘和界面上的修改互相覆盖
export function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(task);
  const settled = result.catch(() => {});
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return result;
}
