/** A bounded public excerpt; comments, attachments and task documents never enter it. */
export function taskShareExcerpt(value:string,limit=200):string {
  const plain=value.replace(/```[\s\S]*?```/g," ").replace(/!\[[^\]]*\]\([^)]*\)/g," ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/<[^>]*>/g," ").replace(/[#*_`~>|]/g,"")
    .replace(/\s+/g," ").trim();
  return Array.from(plain).length>limit ? Array.from(plain).slice(0,limit-1).join("")+"…" : plain;
}

export type TaskShareLocation = { country: string | null; city: string | null; district: string | null };
export type TaskShareDraft = { version: 2; taskNumber: number; title: string; description: string; location: TaskShareLocation };
/** Heuristic help, not a confidentiality guarantee: the author reviews the final text. */
export function taskSharePublicText(value: string, limit = 200): string {
  return taskShareExcerpt(taskShareExcerpt(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " "), Number.MAX_SAFE_INTEGER)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[ссылка скрыта]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email скрыт]")
    .replace(/(?:password|passwd|secret|token|apikey|api[_-]?key|authorization|пароль|токен)\s*[:=]\s*(?:Bearer\s+\S+|"[^"]*"|'[^']*'|\S+)/gi, "[секрет скрыт]")
    .replace(/\bBearer\s+[\w.+/=-]+/gi, "[секрет скрыт]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, "[секрет скрыт]")
    // eslint-disable-next-line no-control-regex -- remove non-printing controls from public text
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " "), limit);
}
export const taskShareLocationText = (location: TaskShareLocation): string =>
  [location.country, location.city, location.district].filter(Boolean).join(" · ");
