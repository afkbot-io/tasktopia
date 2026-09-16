/** A bounded public excerpt; comments, attachments and task documents never enter it. */
export function taskShareExcerpt(value:string,limit=200):string {
  const plain=value.replace(/```[\s\S]*?```/g," ").replace(/!\[[^\]]*\]\([^)]*\)/g," ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/<[^>]*>/g," ").replace(/[#*_`~>|]/g,"")
    .replace(/\s+/g," ").trim();
  return Array.from(plain).length>limit ? Array.from(plain).slice(0,limit-1).join("")+"…" : plain;
}
