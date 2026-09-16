/** Shared-preview tokens grant access to an excerpt and must not enter access logs. */
export function serializeRequest(request:{method:string;url:string;hostname?:string;ip?:string}) {
  return {method:request.method,url:request.url.replace(/(\/share\/task\/)[^?/#]+/,"$1[REDACTED]"),host:request.hostname,remoteAddress:request.ip};
}
