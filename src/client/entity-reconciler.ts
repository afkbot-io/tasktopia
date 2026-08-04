export type EntityViewRecord<T> = { signature: string; view: T };

export function reconcileEntityViews<D, V>(options: {
  source: ReadonlyMap<string, D>;
  records: Map<string, EntityViewRecord<V>>;
  signatureOf: (item: D) => string;
  create: (item: D) => V | null;
  attach: (view: V) => void;
  dispose: (view: V) => void;
}): number {
  let replacements = 0;
  for (const [id, record] of options.records) {
    if (options.source.has(id)) continue;
    options.dispose(record.view);
    options.records.delete(id);
  }
  for (const [id, item] of options.source) {
    const signature = options.signatureOf(item);
    const current = options.records.get(id);
    if (current?.signature === signature) continue;
    if (current) {
      options.dispose(current.view);
      options.records.delete(id);
    }
    const view = options.create(item);
    if (!view) continue;
    options.attach(view);
    options.records.set(id, { signature, view });
    replacements += 1;
  }
  return replacements;
}
