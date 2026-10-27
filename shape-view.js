import { createCubeView } from './cube-view.js?v=19';
import { createRoundView } from './round-view.js?v=19';

// Keep the established CSS view intact. Cache one curved GPU context across
// level switches; only final disposal releases it.
export function createShapeView({host,onMove,onPoseChange=()=>{}}) {
  const doc=host.ownerDocument,cubeHost=doc.createElement('div'),roundHost=doc.createElement('div');
  host.style.position='absolute';host.style.inset='0';host.classList.add('shape-stage');host.setAttribute('role','group');
  cubeHost.className=roundHost.className='shape-layer';for(const layer of [cubeHost,roundHost]){layer.hidden=true;layer.inert=true;layer.style.position='absolute';layer.style.inset='0';}
  host.replaceChildren(cubeHost,roundHost);
  let cube=null,round=null,current=null,currentHost=null,active=false,destroyed=false;
  function show(){host.hidden=!active;host.inert=!active;host.setAttribute('aria-hidden',String(!active));for(const layer of [cubeHost,roundHost]){layer.hidden=!active||layer!==currentHost;layer.inert=!active||layer!==currentHost;}}
  function render(board,settings){if(destroyed||!board)return;const curved=board.rules==='round';
    if(curved&&!round)round=createRoundView({host:roundHost,onMove,onPoseChange:state=>{if(current===round)onPoseChange(state);}});
    if(!curved&&!cube)cube=createCubeView({host:cubeHost,onMove,onPoseChange:state=>{if(current===cube)onPoseChange(state);}});
    const next=curved?round:cube;if(next!==current){current?.setActive(false);current=next;currentHost=curved?roundHost:cubeHost;show();current.setActive(active);}current.render(board,settings);show();
  }
  function setActive(enabled){if(destroyed)return;active=Boolean(enabled);show();current?.setActive(active);show();}
  const api={render,setActive,destroy(){if(destroyed)return;cube?.destroy();round?.destroy();host.replaceChildren();destroyed=true;}};
  for(const method of ['reset','turn','focusPiece','setCloseup','feedback','playExit'])api[method]=(...args)=>{if(!destroyed)return current?.[method]?.(...args);};
  api.setZoom=scale=>{if(!destroyed)return current?.setZoom?.(scale);};
  api.preferredHint=ids=>destroyed?null:(current?.preferredHint?.(ids)??null);
  return api;
}
