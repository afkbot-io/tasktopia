import { describe, expect, it } from "vitest";
import { CDP_TRACE_READ_BYTES, streamCdpTrace } from "./helpers/cdp-trace-stream";

describe("bounded diagnostic trace persistence", () => {
  it("writes each bounded response before requesting the next instead of joining a giant string", async () => {
    const actions: string[] = [];
    const parts = [{ data: '{"traceEvents":[', eof: false }, { data: "]}", eof: true }];
    const output: Uint8Array[] = [];
    const bytes = await streamCdpTrace(async size => {
      expect(size).toBe(CDP_TRACE_READ_BYTES);
      actions.push("read");
      return parts.shift()!;
    }, async chunk => { actions.push("write"); output.push(chunk); });
    expect(actions).toEqual(["read", "write", "read", "write"]);
    expect(Buffer.concat(output).toString()).toBe('{"traceEvents":[]}');
    expect(bytes).toBe(18);
  });

  it("decodes base64 fragments without corrupting their original bytes", async () => {
    const original = Buffer.from("{\"name\":\"кадр\"}");
    const output: Uint8Array[] = [];
    const bytes = await streamCdpTrace(async () => ({ data: original.toString("base64"), base64Encoded: true, eof: true }),
      async chunk => { output.push(chunk); });
    expect(Buffer.concat(output)).toEqual(original);
    expect(bytes).toBe(original.byteLength);
  });

  it("stops before writing beyond the total byte budget", async () => {
    let reads = 0, written = 0;
    await expect(streamCdpTrace(async () => {
      reads++;
      return { data: "1234", eof: reads === 3 };
    }, async chunk => { written += chunk.byteLength; }, 6)).rejects.toThrow("trace byte budget");
    expect(reads).toBe(2);
    expect(written).toBe(4);
  });
});
