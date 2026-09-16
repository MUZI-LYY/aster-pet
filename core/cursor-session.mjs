const composerIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isCursorComposerId(id){return typeof id==='string'&&composerIdPattern.test(id);}
