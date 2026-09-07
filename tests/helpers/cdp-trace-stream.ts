export const CDP_TRACE_READ_BYTES = 1024 * 1024;
export const CDP_TRACE_BYTE_BUDGET = 128 * 1024 * 1024;

type TracePart = { data: string; base64Encoded?: boolean; eof: boolean };

/** Bound protocol responses and memory independently of the trace's total size. */
export async function streamCdpTrace(
  read: (size: number) => Promise<TracePart>,
  write: (bytes: Uint8Array) => Promise<void>,
  byteBudget = CDP_TRACE_BYTE_BUDGET,
): Promise<number> {
  if (!Number.isSafeInteger(byteBudget) || byteBudget < 1) throw new Error("Invalid trace byte budget");
  let bytes = 0;
  for (;;) {
    const part = await read(CDP_TRACE_READ_BYTES);
    const chunk = Buffer.from(part.data, part.base64Encoded ? "base64" : "utf8");
    if (bytes + chunk.byteLength > byteBudget) throw new Error(`Incomplete diagnostic: trace byte budget ${byteBudget} exceeded`);
    await write(chunk);
    bytes += chunk.byteLength;
    if (part.eof) return bytes;
  }
}
