/** Never imply ownership of missing/interleaved task numbers. */
export function blockTaskRange(input: readonly number[]): string {
  const numbers = [...new Set(input.filter(n => Number.isSafeInteger(n) && n > 0))].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < numbers.length; i++) {
    const start = numbers[i]!;
    let end = start;
    while (numbers[i + 1] === end + 1) end = numbers[++i]!;
    ranges.push(start === end ? String(start) : `${start}–${end}`);
  }
  return ranges.join(", ");
}
