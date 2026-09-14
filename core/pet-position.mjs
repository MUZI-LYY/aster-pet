const coordinate = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e7;
const validArea = a => a && ['x','y','width','height'].every(k=>coordinate(a[k])) && a.width>0 && a.height>0;
export function normalizePetPosition(value) {
  if(!value || !coordinate(value.x) || !coordinate(value.y) || !Number.isSafeInteger(value.displayId) || !validArea(value.workArea))return null;
  return {x:Math.round(value.x),y:Math.round(value.y),displayId:value.displayId,workArea:{x:value.workArea.x,y:value.workArea.y,width:value.workArea.width,height:value.workArea.height}};
}
export function rememberPetPosition(bounds,display) {
  return normalizePetPosition({x:bounds.x,y:bounds.y,displayId:display.id,workArea:display.workArea});
}
export function restorePetBounds(displays,primaryId,saved,size) {
  const primary=displays.find(d=>d.id===primaryId)||displays[0];
  if(!primary)throw Error('No display available');
  const position=normalizePetPosition(saved),display=displays.find(d=>d.id===position?.displayId)||primary,area=display.workArea;
  const restore=position&&display.id===position.displayId;
  // Preserve the display-relative position if a monitor was rearranged.
  const x=restore?area.x+position.x-position.workArea.x:area.x+area.width-size.width-24;
  const y=restore?area.y+position.y-position.workArea.y:area.y+20;
  return {x:Math.round(Math.max(area.x,Math.min(x,area.x+area.width-size.width))),y:Math.round(Math.max(area.y,Math.min(y,area.y+area.height-size.height))),width:size.width,height:size.height};
}
