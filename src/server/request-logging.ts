/** Shared capabilities and rejected MCP query credentials must not enter access logs. */
export function serializeRequest(request:{method:string;url:string;hostname?:string;ip?:string}) {
  const url = request.url.replace(/(\/share\/task\/)[^?/#]+/,"$1[REDACTED]").replace(/^\/mcp\?.*$/,"/mcp?[REDACTED]");
  return {method:request.method,url,host:request.hostname,remoteAddress:request.ip};
}
