// Showing without activation lets the originating pointer event finish before
// focus moves away from the pet window. Otherwise the list can blur and hide
// during the same click that opened it.
export function presentListWindow(window,{schedule=setTimeout,delay=0}={}){
  window.showInactive();
  return schedule(()=>{
    if(!window.isDestroyed()&&window.isVisible())window.focus();
  },delay);
}
