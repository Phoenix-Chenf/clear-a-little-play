import { pieceRoute } from './surface-topology.js?v=18';
import { startCubeGesture,updateCubeGesture,tappedPiece } from './cube-view-geometry.js?v=18';
import { mapSurface,createCamera,screenRay,intersectSurface,surfacePointVisible,poseForNormal,projectPoint,
  buildSurfaceMesh,chartSegments,arrowTriangle,hitChartSegments,buildRouteTrack,trackWindow,buildRibbon } from './round-geometry.js?v=18';
import { clampView,startPinch,updatePinch } from './view-transform.js?v=19';
import { roundForwardSteps } from './round-topology.js?v=18';

const INITIAL={pitch:-22,yaw:-30},PALETTE=['#294333','#795035','#596238','#365c68','#715164'];
const nearestYaw=(target,current)=>target+Math.round((current-target)/360)*360;
const rgb=color=>[1,3,5].map(offset=>parseInt(color.slice(offset,offset+2),16)/255);

function createRenderer(canvas) {
  const gl=canvas.getContext('webgl',{alpha:true,antialias:true,depth:true,premultipliedAlpha:false});
  if(!gl)throw new Error('WebGL unavailable');
  const vertex=`attribute vec3 a_position;attribute vec3 a_normal;attribute vec2 a_uv;
    uniform mat3 u_rotation;uniform vec3 u_focus;uniform float u_distance,u_tanHalf,u_aspect,u_near,u_far;
    varying vec3 v_normal;varying vec2 v_uv;
    void main(){vec3 p=u_rotation*(a_position-u_focus);float depth=u_distance-p.z;
      gl_Position=vec4(p.x/(u_tanHalf*u_aspect),-p.y/u_tanHalf,(u_far+u_near)/(u_far-u_near)*depth-2.0*u_far*u_near/(u_far-u_near),depth);
      v_normal=u_rotation*a_normal;v_uv=a_uv;}`;
  const fragment=`precision mediump float;uniform sampler2D u_texture;uniform float u_textured;uniform vec4 u_color;
    varying vec3 v_normal;varying vec2 v_uv;
    void main(){if(u_textured>0.5){float light=max(0.0,dot(normalize(v_normal),normalize(vec3(-0.35,-0.65,1.0))));
      vec3 shell=vec3(0.91,0.93,0.875)*(0.78+0.22*light);vec4 paint=texture2D(u_texture,v_uv);gl_FragColor=vec4(mix(shell,paint.rgb,paint.a),1.0);}
      else gl_FragColor=u_color;}`;
  const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)||'Shader compilation failed');return shader;};
  const program=gl.createProgram(),vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment);gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'Shader link failed');gl.deleteShader(vs);gl.deleteShader(fs);
  const attributes=Object.fromEntries(['position','normal','uv'].map(name=>[name,gl.getAttribLocation(program,`a_${name}`)]));
  const uniforms=Object.fromEntries(['rotation','focus','distance','tanHalf','aspect','near','far','texture','textured','color'].map(name=>[name,gl.getUniformLocation(program,`u_${name}`)]));
  const resources=new Set(),textures=new Set();
  function upload(mesh,target=null,dynamic=false){
    target ||= {buffers:[gl.createBuffer(),gl.createBuffer(),gl.createBuffer(),gl.createBuffer()]};
    [mesh.positions,mesh.normals,mesh.uv,mesh.indices].forEach((array,index)=>{gl.bindBuffer(index===3?gl.ELEMENT_ARRAY_BUFFER:gl.ARRAY_BUFFER,target.buffers[index]);gl.bufferData(index===3?gl.ELEMENT_ARRAY_BUFFER:gl.ARRAY_BUFFER,array,dynamic?gl.DYNAMIC_DRAW:gl.STATIC_DRAW);});
    target.count=mesh.indices.length;resources.add(target);return target;
  }
  function dispose(mesh){if(!mesh)return;mesh.buffers.forEach(buffer=>gl.deleteBuffer(buffer));resources.delete(mesh);}
  function texture(canvas,existing=null){const result=existing||gl.createTexture();textures.add(result);gl.bindTexture(gl.TEXTURE_2D,result);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);gl.generateMipmap(gl.TEXTURE_2D);return result;}
  function disposeTexture(texture){if(texture){gl.deleteTexture(texture);textures.delete(texture);}}
  function draw(mesh){for(const[index,name]of ['position','normal','uv'].entries()){gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffers[index]);gl.enableVertexAttribArray(attributes[name]);gl.vertexAttribPointer(attributes[name],name==='uv'?2:3,gl.FLOAT,false,0,0);}gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,mesh.buffers[3]);gl.drawElements(gl.TRIANGLES,mesh.count,gl.UNSIGNED_SHORT,0);}
  function render(camera,charts,flights){gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(0,0,0,0);gl.clearDepth(1);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.BLEND);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);
    gl.uniformMatrix3fv(uniforms.rotation,false,new Float32Array(camera.matrix));gl.uniform3f(uniforms.focus,...camera.focus);for(const name of ['distance','tanHalf','near','far'])gl.uniform1f(uniforms[name],camera[name]);gl.uniform1f(uniforms.aspect,camera.width/camera.height);gl.activeTexture(gl.TEXTURE0);gl.uniform1i(uniforms.texture,0);gl.uniform1f(uniforms.textured,1);
    for(const chart of charts.values()){if(!chart.texture)continue;gl.bindTexture(gl.TEXTURE_2D,chart.texture);draw(chart.mesh);}
    gl.uniform1f(uniforms.textured,0);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
    for(const flight of flights.values())if(flight.mesh){gl.uniform4f(uniforms.color,...flight.color,flight.opacity);draw(flight.mesh);}gl.depthMask(true);
  }
  return {upload,dispose,texture,disposeTexture,render,destroy(){for(const mesh of [...resources])dispose(mesh);for(const tex of [...textures])disposeTexture(tex);gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();}};
}

export function createRoundView({host,onMove,onPoseChange=()=>{}}) {
  if(!host||typeof onMove!=='function')throw new TypeError('A round host and move callback are required.');
  const doc=host.ownerDocument,win=doc.defaultView,reduced=win.matchMedia('(prefers-reduced-motion: reduce)'),listeners=new AbortController(),options={signal:listeners.signal};
  const canvas=doc.createElement('canvas'),targets=doc.createElement('div'),shadow=doc.createElement('div'),notice=doc.createElement('p'),speech=doc.createElement('p');
  canvas.className='round-canvas';canvas.setAttribute('aria-hidden','true');targets.className='round-targets';shadow.className='round-shadow';shadow.setAttribute('aria-hidden','true');notice.className='round-notice';notice.hidden=true;notice.setAttribute('role','status');
  speech.className='round-a11y-status';speech.setAttribute('role','status');speech.setAttribute('aria-live','polite');speech.setAttribute('aria-atomic','true');
  host.classList.add('cube-stage','round-stage');host.setAttribute('role','group');host.setAttribute('aria-label','可旋转的曲面箭头');host.setAttribute('aria-keyshortcuts','ArrowLeft ArrowRight ArrowUp ArrowDown Home');const viewport=doc.createElement('div'),hintMarker=doc.createElement('div');viewport.className='round-viewport';hintMarker.className='round-hint-marker';hintMarker.hidden=true;hintMarker.setAttribute('aria-hidden','true');viewport.append(shadow,canvas);host.replaceChildren(viewport,targets,hintMarker,notice,speech);
  let renderer=null,lost=false;try{renderer=createRenderer(canvas);}catch{notice.hidden=false;notice.textContent='当前图形暂不可用，请刷新后再试。';}
  const pieces=new Map(),charts=new Map(),flights=new Map(),blocked=new Map(),dirty=new Set(),pointers=new Map();
  let board=null,signature='',active=false,destroyed=false,closeup=false,selectedFace='b1-front',selectedId=null,hintId=null,pose={...INITIAL},dimensions={width:360,height:360},camera=null,gesture=null,tween=null,raf=0,visibilityKey='';
  let view={scale:1,x:0,y:0},pinch=null,multiTouch=false;
  const notify=()=>onPoseChange({closeup,zoom:view.scale,face:selectedFace});
  const face=id=>board?.faces.find(face=>face.id===id);
  function anchor(){const piece=pieces.get(selectedId||hintId)?.piece,head=piece&&pieceRoute(piece).at(-1);if(head?.face===selectedFace)return mapSurface(board,head.face,head.x+.5,head.y+.5);const chart=face(selectedFace)||board.faces[0];return mapSurface(board,chart.id,chart.size/2,chart.size/2);}
  function mark(node){if(node)for(const segment of [...node.fragments,...node.corridor])dirty.add(segment.face);}
  function select(id){if(selectedId===id)return;mark(pieces.get(selectedId));selectedId=id;mark(pieces.get(selectedId));}
  function clearFlight(id){const flight=flights.get(id);if(!flight)return;renderer?.dispose(flight.mesh);flights.delete(id);mark(pieces.get(id));}
  function clearFlights(){for(const id of [...flights.keys()])clearFlight(id);}
  function clearBlocked(){for(const[id,timer]of blocked){win.clearTimeout(timer);mark(pieces.get(id));}blocked.clear();}
  function cancelGesture(){gesture=null;pinch=null;multiTouch=false;pointers.clear();host.classList.remove('is-dragging');}
  function stop(){tween=null;if(raf){win.cancelAnimationFrame(raf);raf=0;}}
  function updateCamera(){if(!board)return;camera=createCamera(board,pose,dimensions);view=clampView(view,dimensions);closeup=view.scale>1;viewport.style.transform=`translate(${view.x}px,${view.y}px) scale(${view.scale})`;host.classList.toggle('is-closeup',closeup);host.dataset.face=selectedFace;}
  function syncTargets(){if(!camera)return;const key=[active,lost,pose.pitch,pose.yaw,view.scale,view.x,view.y,...camera.focus,camera.distance,dimensions.width,dimensions.height].join(',');
    for(const node of pieces.values()){
      const current=node.piece.id===hintId,selected=node.piece.id===selectedId,status=current?'，当前提示':selected?'，当前选中':'';
      const semantic=[current,selected,blocked.has(node.piece.id),node.index].join(',');
      if(node.semanticKey!==semantic){node.semanticKey=semantic;node.button.setAttribute('aria-current',current?'true':'false');node.button.setAttribute('aria-label',`${board.shape.type==='sphere'?'球面':'圆柱面'}线路 ${node.index+1}${status}，前方四格以虚线标出${blocked.has(node.piece.id)?'，前方有阻挡':''}`);}
      if(node.visibilityKey===key)continue;node.visibilityKey=key;
      node.visible=Boolean(active&&!lost&&renderer&&node.samples.some(point=>{if(!surfacePointVisible(board,point,camera.eye))return false;const screen=screenPoint(point);return screen[2]>0&&Math.abs(screen[0])<=dimensions.width/2&&Math.abs(screen[1])<=dimensions.height/2;}));
      node.button.setAttribute('tabindex',node.visible?'0':'-1');node.button.setAttribute('aria-hidden',String(!node.visible));node.button.disabled=!node.visible;
    }
    visibilityKey=key;
    const focused=doc.activeElement?.closest?.('[data-round-piece]');if(focused&&targets.contains(focused)&&focused.getAttribute('aria-hidden')==='true')host.focus({preventScroll:true});
  }
  function screenPoint(point){const projected=projectPoint(point,camera);return [(projected[0]-dimensions.width/2)*view.scale+view.x,(projected[1]-dimensions.height/2)*view.scale+view.y,projected[2]];}
  function headPoints(node){const segment=node.fragments.find(segment=>segment.head);if(!segment)return [];return arrowTriangle(segment).map(([x,y])=>mapSurface(board,segment.face,x,y).point);}
  function visibleHead(node){return headPoints(node).every(point=>{const screen=screenPoint(point);return surfacePointVisible(board,point,camera.eye)&&screen[2]>0&&Math.abs(screen[0])<dimensions.width/2-20&&Math.abs(screen[1])<dimensions.height/2-20;});}
  function syncMarker(){const node=pieces.get(hintId);hintMarker.hidden=!active||lost||!renderer||!node||flights.has(hintId)||!visibleHead(node);if(hintMarker.hidden)return;const [x,y]=screenPoint(headPoints(node)[0]);hintMarker.style.transform=`translate(${x}px,${y}px)`;hintMarker.dataset.piece=hintId;}
  function stroke(ctx,segment,color,width){const points=segment.head?[...segment.points,arrowTriangle(segment)[0]]:segment.points;ctx.beginPath();ctx.moveTo(...points[0]);for(const point of points.slice(1))ctx.lineTo(...point);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  function paint(){if(!renderer)return;
    for(const id of dirty){const chart=charts.get(id);if(!chart)continue;const ctx=chart.ctx,n=chart.size,size=chart.canvas.width;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,size,size);ctx.setTransform(size/n,0,0,size/n,0,0);ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=1;
      const chosen=pieces.get(selectedId||hintId);if(chosen&&!flights.has(chosen.piece.id)){
        ctx.setLineDash([.17,.15]);for(const segment of chosen.corridor)if(segment.face===id)stroke(ctx,segment,blocked.has(chosen.piece.id)?'#a26148':'#708960',.095);ctx.setLineDash([]);
      }
      for(const[id,node]of pieces){if(flights.has(id))continue;const color=blocked.has(id)?'#a26148':PALETTE[(node.piece.color||0)%PALETTE.length],highlight=id===hintId||id===selectedId;
        for(const segment of node.fragments){if(segment.face!==chart.id)continue;
          if(highlight){ctx.globalAlpha=.46;stroke(ctx,segment,'#adc797',.49);ctx.globalAlpha=1;}
          stroke(ctx,segment,color,.17);
          if(segment.head){const triangle=arrowTriangle(segment);ctx.beginPath();ctx.moveTo(...triangle[0]);ctx.lineTo(...triangle[1]);ctx.lineTo(...triangle[2]);ctx.closePath();ctx.strokeStyle='#f5f4e9';ctx.lineWidth=.06;ctx.stroke();ctx.fillStyle=color;ctx.fill();}
        }
      }
      chart.texture=renderer.texture(chart.canvas,chart.texture);
    }
    dirty.clear();
  }
  function redraw(){if(destroyed||!board)return;updateCamera();syncTargets();syncMarker();paint();if(active&&!lost&&renderer)renderer.render(camera,charts,flights);}
  function tick(now){raf=0;if(destroyed)return;
    if(tween){const t=Math.min(1,(now-tween.began)/280),ease=1-(1-t)**3;pose={pitch:tween.from.pitch+(tween.to.pitch-tween.from.pitch)*ease,yaw:tween.from.yaw+(tween.to.yaw-tween.from.yaw)*ease};if(t>=1)tween=null;}
    for(const[id,flight]of [...flights]){const t=Math.min(1,(now-flight.began)/flight.duration);if(t>=1){clearFlight(id);continue;}flight.opacity=reduced.matches?1-t:Math.min(1,(1-t)*2.8);
      const travel=reduced.matches?0:flight.track.maxTravel*(1-(1-t)**2),window=trackWindow(flight.track,travel);flight.mesh=renderer?.upload(buildRibbon(flight.board,window,flight.width),flight.mesh,true);
    }
    redraw();if(tween||flights.size)raf=win.requestAnimationFrame(tick);
  }
  function animate(target,immediate=false){tween=null;const end={pitch:target.pitch,yaw:nearestYaw(target.yaw,pose.yaw)};
    if(reduced.matches||closeup||immediate||!active){pose=end;redraw();return;}tween={from:{...pose},to:end,began:win.performance.now()};if(!raf)raf=win.requestAnimationFrame(tick);
  }
  function measure(){const rect=host.getBoundingClientRect();if(rect.width&&rect.height)dimensions={width:rect.width,height:rect.height};const width=Math.round(dimensions.width*2),height=Math.round(dimensions.height*2);if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;redraw();}
  function rebuild(next){clearFlights();clearBlocked();stop();cancelGesture();for(const chart of charts.values()){renderer?.dispose(chart.mesh);renderer?.disposeTexture(chart.texture);}charts.clear();pieces.clear();targets.replaceChildren();
    board=next;pose={...INITIAL};closeup=false;view={scale:1,x:0,y:0};selectedId=null;hintId=null;selectedFace=board.faces.find(face=>face.side==='front')?.id||board.faces[0].id;visibilityKey='';
    for(const mesh of buildSurfaceMesh(board,36)){const metadata=face(mesh.face),texture=doc.createElement('canvas');texture.width=texture.height=1024;charts.set(mesh.face,{id:mesh.face,size:metadata.size,canvas:texture,ctx:texture.getContext('2d'),mesh:renderer?.upload(mesh),texture:null});dirty.add(mesh.face);}notify();
  }
  function render(next,{hintId:nextHint=null}={}){if(destroyed||!next)return;const focused=doc.activeElement?.dataset?.roundPiece,shape=JSON.stringify([next.id,next.shape,next.faces]);
    if(shape!==signature){rebuild(next);signature=shape;}else board=next;
    const remaining=new Map(board.pieces.map(piece=>[piece.id,piece]));for(const id of flights.keys())if(remaining.has(id))clearFlight(id);
    for(const[id,node]of pieces)if(remaining.get(id)!==node.piece){mark(node);node.button.remove();pieces.delete(id);if(selectedId===id)selectedId=null;}
    board.pieces.forEach((piece,index)=>{let node=pieces.get(piece.id);if(!node){const track=buildRouteTrack(board,piece),button=doc.createElement('button');button.className='round-piece-target';button.type='button';button.setAttribute('data-round-piece',piece.id);button.setAttribute('data-cube-piece',piece.id);
        const fragments=chartSegments(board,piece),corridor=chartSegments(board,piece,[pieceRoute(piece).at(-1),...roundForwardSteps(board,piece).map(step=>step.node)],false);
        node={piece,button,fragments,corridor,track,samples:track.points.filter((_,i)=>track.cumulative[i]<=track.bodyLength+1e-8&&i%3===0).map(node=>node.point),visible:false,visibilityKey:''};pieces.set(piece.id,node);mark(node);
      }
      node.index=index;
    });
    let before=null;for(let i=board.pieces.length-1;i>=0;i--){const button=pieces.get(board.pieces[i].id).button;if(!button.parentNode)targets.insertBefore(button,before);before=button;}
    if(hintId!==nextHint){mark(pieces.get(hintId));if(nextHint===null&&selectedId===hintId)select(null);hintId=nextHint;mark(pieces.get(hintId));}
    measure();if(focused&&!pieces.has(focused)&&active){const replacement=[...pieces.values()].find(node=>node.visible);if(replacement)replacement.button.focus({preventScroll:true});else host.focus({preventScroll:true});}
  }
  function reset(){cancelGesture();stop();clearFlights();clearBlocked();closeup=false;view={scale:1,x:0,y:0};hintId=null;selectedId=null;pose={...INITIAL};selectedFace=board?.faces.find(face=>face.side==='front')?.id||'b1-front';for(const id of charts.keys())dirty.add(id);redraw();notify();}
  function turn(step){if(!active||!board||destroyed)return;cancelGesture();const index=board.faces.findIndex(face=>face.id===selectedFace);selectedFace=board.faces[(index+(step<0?-1:1)+board.faces.length)%board.faces.length].id;animate(poseForNormal(anchor().normal));notify();}
  function preferredHint(ids){const supplied=ids.filter(id=>pieces.has(id)&&!flights.has(id));return supplied.find(id=>visibleHead(pieces.get(id)))||supplied[0]||null;}
  function focusPiece(id){const node=pieces.get(id);if(!active||!node||destroyed)return;cancelGesture();mark(pieces.get(hintId));hintId=id;select(id);mark(node);selectedFace=pieceRoute(node.piece).at(-1).face;
    tween=null;pose=poseForNormal(anchor().normal);updateCamera();const tip=projectPoint(headPoints(node)[0],camera);view=clampView({...view,x:-(tip[0]-dimensions.width/2)*view.scale,y:-(tip[1]-dimensions.height/2)*view.scale},dimensions);redraw();
    speech.textContent=`已提示线路${node.index+1}，圈出箭头尖端，虚线标出前方四格。按回车可尝试移走。`;notify();}
  function setZoom(scale){if(!active||!board||destroyed)return;cancelGesture();tween=null;view=clampView({...view,scale},dimensions);redraw();notify();}
  function setCloseup(enabled){setZoom(enabled?3:1);}
  function feedback(id){const node=pieces.get(id);if(!node||!active||destroyed)return;select(id);win.clearTimeout(blocked.get(id));blocked.set(id,win.setTimeout(()=>{blocked.delete(id);mark(pieces.get(id));redraw();},300));mark(node);redraw();}
  function playExit(piece){const node=pieces.get(piece.id);if(!node||!active||destroyed)return;clearFlight(piece.id);const track=node.track,flight={board,track,color:rgb(PALETTE[(piece.color||0)%PALETTE.length]),width:Math.max(...board.shape.scale)*.34/board.faces[0].size,began:win.performance.now(),duration:reduced.matches?110:680,opacity:1,mesh:null};
    flight.mesh=renderer?.upload(buildRibbon(board,trackWindow(track,0),flight.width),null,true);flights.set(piece.id,flight);mark(node);redraw();if(!raf)raf=win.requestAnimationFrame(tick);return flight.duration;
  }
  function setActive(enabled){if(destroyed)return;active=Boolean(enabled);host.hidden=!active;host.inert=!active;host.tabIndex=active?0:-1;host.setAttribute('aria-hidden',String(!active));if(!active){cancelGesture();stop();clearFlights();clearBlocked();select(null);hintId=null;}measure();}
  function pick(event){if(!active||lost||!renderer||!camera)return null;const rect=host.getBoundingClientRect(),ray=screenRay([(event.clientX-rect.left-dimensions.width/2-view.x)/view.scale+dimensions.width/2,(event.clientY-rect.top-dimensions.height/2-view.y)/view.scale+dimensions.height/2],camera),hit=intersectSurface(board,ray.origin,ray.direction);if(!hit)return null;
    for(const[id,node]of [...pieces].reverse())if(node.visible&&!flights.has(id)&&hitChartSegments(node.fragments.filter(segment=>segment.face===hit.face),hit.x,hit.y))return id;return null;
  }
  targets.addEventListener('click',event=>{const id=event.target.closest?.('[data-round-piece]')?.dataset.roundPiece;if(event.detail===0&&active&&!multiTouch&&!pointers.size&&pieces.get(id)?.visible){select(id);redraw();onMove(id);}},options);
  targets.addEventListener('focusin',event=>{const id=event.target.closest?.('[data-round-piece]')?.dataset.roundPiece;if(active&&pieces.has(id)){select(id);redraw();}},options);
  const localPoint=event=>{const rect=host.getBoundingClientRect();return {x:event.clientX-(rect.left||0)-dimensions.width/2,y:event.clientY-(rect.top||0)-dimensions.height/2};};
  canvas.addEventListener('pointerdown',event=>{
    if(!active||(event.pointerType==='mouse'&&event.button!==0))return;
    pointers.set(event.pointerId,localPoint(event));try{canvas.setPointerCapture(event.pointerId);}catch{}tween=null;
    if(pointers.size>1){multiTouch=true;gesture=null;pinch=pointers.size===2?startPinch([...pointers.values()],view):null;host.classList.remove('is-dragging');event.preventDefault();return;}
    if(multiTouch)return;gesture=startCubeGesture({x:event.clientX,y:event.clientY,pointerId:event.pointerId,pieceId:pick(event),pose});
  },{...options,passive:false});
  canvas.addEventListener('pointermove',event=>{
    if(!pointers.has(event.pointerId))return;pointers.set(event.pointerId,localPoint(event));
    if(multiTouch){if(pointers.size===2&&pinch){view=updatePinch(pinch,[...pointers.values()],dimensions);redraw();notify();}event.preventDefault();return;}
    if(!gesture||event.pointerId!==gesture.pointerId)return;gesture=updateCubeGesture(gesture,{x:event.clientX,y:event.clientY},pointers.size);if(gesture.canceled||!gesture.dragging)return;
    host.classList.add('is-dragging');pose=gesture.pose;redraw();event.preventDefault();
  },{...options,passive:false});
  function finishPointer(event,canceled=false){
    pointers.delete(event.pointerId);
    if(multiTouch){gesture=null;pinch=pointers.size===2?startPinch([...pointers.values()],view):null;if(!pointers.size)multiTouch=false;host.classList.remove('is-dragging');return;}
    if(!gesture||event.pointerId!==gesture.pointerId)return;const finished=canceled?null:updateCubeGesture(gesture,{x:event.clientX,y:event.clientY},1);gesture=null;host.classList.remove('is-dragging');if(!finished)return;
    const id=tappedPiece(finished);if(id&&pick(event)===id){select(id);selectedFace=pieceRoute(pieces.get(id).piece).at(-1).face;redraw();onMove(id);}if(finished.dragging&&!finished.canceled)notify();
  }
  canvas.addEventListener('pointerup',event=>finishPointer(event),options);
  for(const name of ['pointercancel','lostpointercapture'])canvas.addEventListener(name,event=>finishPointer(event,true),options);
  host.addEventListener('keydown',event=>{if(!active||multiTouch||pointers.size)return;if(event.key==='Home'){event.preventDefault();reset();return;}if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();cancelGesture();tween=null;pose={pitch:Math.max(-90,Math.min(90,pose.pitch+(event.key==='ArrowUp'?18:event.key==='ArrowDown'?-18:0))),yaw:pose.yaw+(event.key==='ArrowLeft'?-22:event.key==='ArrowRight'?22:0)};redraw();notify();},options);
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;notice.hidden=false;notice.textContent='图形正在恢复，请稍候。';syncTargets();},options);
  canvas.addEventListener('webglcontextrestored',()=>{if(destroyed)return;try{renderer=createRenderer(canvas);lost=false;notice.hidden=true;signature='';const current=board;rebuild(current);signature=JSON.stringify([current.id,current.shape,current.faces]);render(current);}catch{notice.textContent='当前图形暂不可用，请刷新后再试。';}},options);
  const observer=new ResizeObserver(measure);observer.observe(host);setActive(false);
  function destroy(){if(destroyed)return;stop();cancelGesture();clearFlights();clearBlocked();observer.disconnect();listeners.abort();renderer?.destroy();destroyed=true;host.replaceChildren();host.classList.remove('cube-stage','round-stage','is-closeup','is-dragging');}
  return {render,reset,turn,focusPiece,setCloseup,setZoom,preferredHint,feedback,playExit,setActive,destroy};
}
