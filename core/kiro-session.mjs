const sessionIdPattern=/^(?:sess_[A-Za-z0-9_-]{1,120}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export function isKiroSessionId(id){return typeof id==='string'&&sessionIdPattern.test(id);}
