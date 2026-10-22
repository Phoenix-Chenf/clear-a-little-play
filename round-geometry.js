import { FACE_BASES, pieceRoute, stepSurface, surfaceKey } from './surface-topology.js?v=18';
import { roundForwardSteps } from './round-topology.js?v=18';

const VECTORS = { up:[0,-1], right:[1,0], down:[0,1], left:[-1,0] };
const EPS = 1e-8;
export const dot = (a,b) => a.reduce((sum,value,axis)=>sum+value*b[axis],0);
export const normalize = vector => { const length=Math.hypot(...vector); return length>EPS ? vector.map(value=>value/length) : [0,0,1]; };
export const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const subtract = (a,b) => a.map((value,axis)=>value-b[axis]);
const interpolate = (a,b,t) => a.map((value,axis)=>value+(b[axis]-value)*t);
const radiusOf = board => Math.max(...board.shape.scale);
const faceOf = (board,id) => board.faces.find(face=>face.id===id);
const faceForSide = (board,side) => board.faces.find(face=>(face.side||face.id)===side);
const CAP_STRAIGHT_RADIUS = .7;

function capRadius(x,z) {
  const squared=x*x+z*z,r=Math.sqrt(squared);
  if(r<=CAP_STRAIGHT_RADIUS)return r;
  const t=Math.min(1,(r-CAP_STRAIGHT_RADIUS)/(1-CAP_STRAIGHT_RADIUS)),blend=t*t*(3-2*t);
  // The center stays Cartesian. A smooth squircle transition only bends the
  // outer rows; x²+z²−x²z²=1 on every square edge, preserving the old side weld.
  return Math.sqrt(Math.max(0,squared-blend*x*x*z*z));
}

function inverseCap(x,z) {
  const squared=x*x+z*z,r=Math.sqrt(squared);
  if(r<=CAP_STRAIGHT_RADIUS)return [x,z];
  const dx=x/r,dz=z/r,angular=dx*dx*dz*dz;
  let originalRadius;
  if(squared>=1-angular) {
    // Outside the transition the radial squircle has an exact, stable inverse,
    // including the four rim corners where its radial derivative reaches zero.
    originalRadius=Math.sqrt(2*squared/(1+Math.sqrt(Math.max(0,1-4*angular*squared))));
  } else {
    let low=CAP_STRAIGHT_RADIUS,high=1;
    // The blend is strictly monotone on this bounded interval. Fixed work is
    // sufficient for chart coordinates at every authored board density.
    for(let i=0;i<44;i++) {
      const middle=(low+high)/2;
      if(capRadius(dx*middle,dz*middle)<r)low=middle;else high=middle;
    }
    originalRadius=(low+high)/2;
  }
  return [dx*originalRadius,dz*originalRadius];
}

export function mapSurface(board,faceId,x,y) {
  const face=faceOf(board,faceId); if (!face) throw new RangeError(`Unknown round chart ${faceId}`);
  const side=face.side||face.id,basis=FACE_BASES[side],u=x/face.size*2-1,v=y/face.size*2-1,scale=board.shape.scale;
  let q=basis.normal.map((value,axis)=>value+basis.right[axis]*u+basis.down[axis]*v),normal;
  if(board.shape.type==='sphere') {
    q=normalize(q); normal=normalize(q.map((value,axis)=>value/scale[axis]));
  } else if(board.shape.type==='cylinder') {
    const r=Math.hypot(q[0],q[2]),cap=side==='top'||side==='bottom',rho=cap?capRadius(q[0],q[2]):Math.max(Math.abs(q[0]),Math.abs(q[2]));
    if(r>EPS) { q[0]*=rho/r;q[2]*=rho/r; }
    normal=side==='top'?[0,-1,0]:side==='bottom'?[0,1,0]:normalize([q[0]/scale[0],0,q[2]/scale[2]]);
  } else throw new RangeError(`Unknown round shape ${board.shape.type}`);
  return {point:q.map((value,axis)=>value*scale[axis]),normal};
}

export function surfaceFromPoint(board,point,faceHint=null) {
  const p=point.map((value,axis)=>value/board.shape.scale[axis]);let q,side;
  if(board.shape.type==='sphere') {
    const maximum=Math.max(...p.map(Math.abs));q=p.map(value=>value/maximum);
    const axis=p.map(Math.abs).indexOf(maximum);side=axis===0?(p[0]>=0?'right':'left'):axis===1?(p[1]>=0?'bottom':'top'):(p[2]>=0?'front':'back');
  } else {
    const cap=faceHint?['top','bottom'].includes(faceOf(board,faceHint)?.side):Math.abs(p[1])>=1-1e-7;
    if(cap) {
      const [x,z]=inverseCap(p[0],p[2]);
      q=[x,p[1]<0?-1:1,z];side=p[1]<0?'top':'bottom';
    } else {
      const m=Math.max(Math.abs(p[0]),Math.abs(p[2]));q=[p[0]/m,p[1],p[2]/m];
      side=Math.abs(p[0])>Math.abs(p[2])?(p[0]>=0?'right':'left'):(p[2]>=0?'front':'back');
    }
  }
  const face=faceHint?faceOf(board,faceHint):faceForSide(board,side),basis=FACE_BASES[face.side||face.id];
  const x=(dot(q,basis.right)+1)*face.size/2,y=(dot(q,basis.down)+1)*face.size/2;
  return {face:face.id,x,y,normal:mapSurface(board,face.id,x,y).normal};
}

export function intersectSurface(board,origin,direction) {
  const o=origin.map((value,axis)=>value/board.shape.scale[axis]),d=direction.map((value,axis)=>value/board.shape.scale[axis]),candidates=[];
  const roots=(a,b,c)=>{const discriminant=b*b-4*a*c;if(a>EPS&&discriminant>=0){const s=Math.sqrt(discriminant);return[(-b-s)/(2*a),(-b+s)/(2*a)];}return[];};
  if(board.shape.type==='sphere') candidates.push(...roots(dot(d,d),2*dot(o,d),dot(o,o)-1));
  else {
    for(const t of roots(d[0]*d[0]+d[2]*d[2],2*(o[0]*d[0]+o[2]*d[2]),o[0]*o[0]+o[2]*o[2]-1)) if(Math.abs(o[1]+d[1]*t)<=1+EPS)candidates.push(t);
    if(Math.abs(d[1])>EPS)for(const y of [-1,1]){const t=(y-o[1])/d[1];if((o[0]+d[0]*t)**2+(o[2]+d[2]*t)**2<=1+EPS)candidates.push(t);}
  }
  const positive=candidates.filter(t=>t>EPS);if(!positive.length)return null;
  const t=Math.min(...positive),point=origin.map((value,axis)=>value+direction[axis]*t);
  return {t,point,...surfaceFromPoint(board,point)};
}

export function surfacePointVisible(board,point,cameraPosition) {
  const vector=subtract(point,cameraPosition),distance=Math.hypot(...vector);if(distance<EPS)return false;
  const hit=intersectSurface(board,cameraPosition,vector.map(value=>value/distance));
  return !hit||hit.t>=distance-radiusOf(board)*2e-5;
}

export function rotationMatrix({pitch,yaw}) {
  const p=pitch*Math.PI/180,y=yaw*Math.PI/180,cp=Math.cos(p),sp=Math.sin(p),cy=Math.cos(y),sy=Math.sin(y);
  // Column-major Rx(pitch) * Ry(yaw), in the shared +y-down world.
  return [cy,sp*sy,-cp*sy,0,cp,sp,sy,-sp*cy,cp*cy];
}
const rotate=(point,m)=>[m[0]*point[0]+m[3]*point[1]+m[6]*point[2],m[1]*point[0]+m[4]*point[1]+m[7]*point[2],m[2]*point[0]+m[5]*point[1]+m[8]*point[2]];
const inverseRotate=(point,m)=>[dot(point,m.slice(0,3)),dot(point,m.slice(3,6)),dot(point,m.slice(6,9))];

export function poseForNormal(normal) {
  return {pitch:Math.atan2(normal[1],Math.hypot(normal[0],normal[2]))*180/Math.PI,yaw:-Math.atan2(normal[0],normal[2])*180/Math.PI};
}

export function createCamera(board,pose,{width=360,height=360,focus=null,closeup=false}={}) {
  const scale=board.shape.scale,radius=board.shape.type==='sphere'?Math.max(...scale):Math.hypot(Math.max(scale[0],scale[2]),scale[1]);
  const fov=36*Math.PI/180,tanHalf=Math.tan(fov/2),distance=closeup?radiusOf(board)*1.8:radius/Math.sin(fov/2)*1.13*Math.max(1,height/width);
  const matrix=rotationMatrix(pose),center=focus||[0,0,0],eye=inverseRotate([0,0,distance],matrix).map((value,axis)=>value+center[axis]);
  return {width,height,pose:{...pose},matrix,focus:center,distance,tanHalf,eye,near:Math.max(.01,radius*.025),far:distance+radius*30};
}

export function projectPoint(point,camera) {
  const p=rotate(subtract(point,camera.focus),camera.matrix),depth=camera.distance-p[2],focal=camera.height/(2*camera.tanHalf);
  return [camera.width/2+p[0]*focal/depth,camera.height/2+p[1]*focal/depth,depth];
}

export function screenRay(pixel,camera) {
  const focal=camera.height/(2*camera.tanHalf),view=[(pixel[0]-camera.width/2)/focal,(pixel[1]-camera.height/2)/focal,-1];
  return {origin:camera.eye,direction:normalize(inverseRotate(view,camera.matrix))};
}

export function buildSurfaceMesh(board,detail=32) {
  return board.faces.map(face=>{
    const positions=[],normals=[],uv=[],indices=[];
    for(let row=0;row<=detail;row++)for(let col=0;col<=detail;col++){
      const node=mapSurface(board,face.id,col/detail*face.size,row/detail*face.size);positions.push(...node.point);normals.push(...node.normal);uv.push(col/detail,row/detail);
    }
    for(let row=0;row<detail;row++)for(let col=0;col<detail;col++){const a=row*(detail+1)+col,b=a+1,c=a+detail+1,d=c+1;indices.push(a,b,c,b,d,c);}
    return {face:face.id,positions:new Float32Array(positions),normals:new Float32Array(normals),uv:new Float32Array(uv),indices:new Uint16Array(indices)};
  });
}

function connections(board,nodes) {
  const result=[];
  for(let i=1;i<nodes.length;i++) {
    const a=nodes[i-1],b=nodes[i],dir=Object.keys(VECTORS).find(dir=>surfaceKey(stepSurface(board,a,dir)?.node||{})===surfaceKey(b));
    if(!dir)throw new RangeError('Disconnected round route');
    const next=stepSurface(board,a,dir),from=[a.x+.5,a.y+.5],to=[b.x+.5,b.y+.5],v=VECTORS[dir],w=VECTORS[next.dir];
    if(a.face===b.face)result.push({face:a.face,from,to,dir});
    else {result.push({face:a.face,from,to:from.map((value,axis)=>value+v[axis]*.5),dir});result.push({face:b.face,from:to.map((value,axis)=>value-w[axis]*.5),to,dir:next.dir});}
  }
  return result;
}

export function chartSegments(board,piece,nodes=pieceRoute(piece),includeHead=true) {
  const fragments=[];
  for(const edge of connections(board,nodes)){
    const previous=fragments.at(-1);
    if(previous?.face===edge.face&&close2(previous.points.at(-1),edge.from)){previous.points.push(edge.to);previous.dir=edge.dir;}
    else fragments.push({face:edge.face,points:[edge.from,edge.to],dir:edge.dir,head:false});
  }
  if(!fragments.length&&nodes.length)fragments.push({face:nodes[0].face,points:[[nodes[0].x+.5,nodes[0].y+.5]],dir:piece.dir,head:false});
  if(includeHead&&fragments.length){fragments.at(-1).head=true;fragments.at(-1).dir=piece.dir;}
  return fragments;
}
const close2=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<EPS;

export function arrowTriangle(segment) {
  const [x,y]=segment.points.at(-1),[dx,dy]=VECTORS[segment.dir];
  return [[x+dx*.38,y+dy*.38],[x-dx*.34-dy*.33,y-dy*.34+dx*.33],[x-dx*.34+dy*.33,y-dy*.34-dx*.33]];
}

export function hitChartSegments(segments,x,y,width=.72) {
  const point=[x,y];
  for(const segment of segments){
    const points=segment.head?[...segment.points,arrowTriangle(segment)[0]]:segment.points;
    for(let i=0;i<points.length;i++){const a=points[Math.max(0,i-1)],b=points[i],d=[b[0]-a[0],b[1]-a[1]],length=dot(d,d),t=length?Math.max(0,Math.min(1,dot([x-a[0],y-a[1]],d)/length)):0;if(Math.hypot(x-a[0]-d[0]*t,y-a[1]-d[1]*t)<=width/2)return true;}
    if(segment.head){const tri=arrowTriangle(segment),sign=(a,b)=>(point[0]-b[0])*(a[1]-b[1])-(a[0]-b[0])*(point[1]-b[1]),values=[sign(tri[0],tri[1]),sign(tri[1],tri[2]),sign(tri[2],tri[0])];if(!(values.some(value=>value<0)&&values.some(value=>value>0)))return true;}
  }
  return false;
}

export function buildRouteTrack(board,piece,samplesPerCell=10) {
  const route=pieceRoute(piece),clearanceSteps=roundForwardSteps(board,piece),nodes=[...route,...clearanceSteps.map(step=>step.node)],points=[],cumulative=[];
  const add=(node)=>{const previous=points.at(-1),distance=previous?Math.hypot(...subtract(node.point,previous.point)):0;if(previous&&distance<EPS){points[points.length-1]=node;return;}points.push(node);cumulative.push((cumulative.at(-1)||0)+distance);};
  const first=route[0];add({...mapSurface(board,first.face,first.x+.5,first.y+.5),face:first.face,x:first.x+.5,y:first.y+.5,outside:false});
  let bodyLength=0;
  for(let index=1;index<nodes.length;index++){
    for(const edge of connections(board,[nodes[index-1],nodes[index]])){
      const count=Math.max(2,Math.ceil(Math.hypot(edge.to[0]-edge.from[0],edge.to[1]-edge.from[1])*samplesPerCell));
      for(let i=1;i<=count;i++){const [x,y]=interpolate(edge.from,edge.to,i/count);add({...mapSurface(board,edge.face,x,y),face:edge.face,x,y,outside:false});}
    }
    if(index===route.length-1)bodyLength=cumulative.at(-1);
  }
  // A single-cell arrow still needs a short, nonzero rendered body window.
  if(route.length===1)bodyLength=Math.max(radiusOf(board)*.025,cumulative[1]||.025);
  const escapeStart=points.length-1,start=points[escapeStart],before=points[escapeStart-1],n=start.normal;
  let tangent=normalize(subtract(start.point,before.point));tangent=normalize(tangent.map((value,axis)=>value-dot(tangent,n)*n[axis]));
  const radius=radiusOf(board),corridorLength=cumulative.at(-1)-bodyLength;
  for(let i=1;i<=80;i++){const t=i/12,point=start.point.map((value,axis)=>value+radius*(tangent[axis]*t+n[axis]*(.18*t+.5*t*t)));add({point,normal:[...n],outside:true,face:start.face,x:start.x,y:start.y});}
  return {points,cumulative,bodyLength,corridorLength,escapeStart,clearanceSteps,radius,maxTravel:Math.min(cumulative.at(-1)-bodyLength,bodyLength+corridorLength+radius*3)};
}

export function trackWindow(track,travel) {
  const start=Math.max(0,Math.min(travel,track.cumulative.at(-1)-track.bodyLength)),end=start+track.bodyLength;
  const at=distance=>{
    let low=0,high=track.cumulative.length-1;while(low<high){const mid=Math.ceil((low+high)/2);if(track.cumulative[mid]<=distance)low=mid;else high=mid-1;}
    const a=track.points[low],b=track.points[Math.min(low+1,track.points.length-1)],span=(track.cumulative[low+1]??track.cumulative[low])-track.cumulative[low],t=span?(distance-track.cumulative[low])/span:0;
    return {...a,point:interpolate(a.point,b.point,t),normal:normalize(interpolate(a.normal,b.normal,t)),outside:a.outside||t>0&&b.outside};
  };
  return [at(start),...track.points.filter((_,index)=>track.cumulative[index]>start+EPS&&track.cumulative[index]<end-EPS),at(end)];
}

export function buildRibbon(board,window,width,arrow=true) {
  const positions=[],normals=[],uv=[],indices=[],radius=radiusOf(board);
  window.forEach((node,index)=>{
    const a=window[Math.max(0,index-1)].point,b=window[Math.min(window.length-1,index+1)].point,tangent=normalize(subtract(b,a)),side=normalize(cross(node.normal,tangent));
    for(const sign of [-1,1]){let point=node.point.map((value,axis)=>value+side[axis]*width/2*sign);
      if(!node.outside){const scaled=point.map((value,axis)=>value/board.shape.scale[axis]);if(board.shape.type==='sphere')point=normalize(scaled).map((value,axis)=>value*board.shape.scale[axis]);else if(Math.abs(node.normal[1])>.8)point[1]=Math.sign(node.normal[1])*board.shape.scale[1];else{const r=Math.hypot(scaled[0],scaled[2]);point[0]=scaled[0]/r*board.shape.scale[0];point[2]=scaled[2]/r*board.shape.scale[2];}}
      point=point.map((value,axis)=>value+node.normal[axis]*radius*.0005);positions.push(...point);normals.push(...node.normal);uv.push(0,0);
    }
    if(index){const v=index*2;indices.push(v-2,v-1,v,v-1,v+1,v);}
  });
  if(arrow&&window.length>1){const head=window.at(-1),tangent=normalize(subtract(head.point,window.at(-2).point)),side=normalize(cross(head.normal,tangent)),base=positions.length/3;
    for(const [forward,lateral] of [[width*2.2,0],[-width*1.8,width*1.95],[-width*1.8,-width*1.95]]){positions.push(...head.point.map((value,axis)=>value+tangent[axis]*forward+side[axis]*lateral+head.normal[axis]*radius*.001));normals.push(...head.normal);uv.push(0,0);}indices.push(base,base+1,base+2);
  }
  return {positions:new Float32Array(positions),normals:new Float32Array(normals),uv:new Float32Array(uv),indices:new Uint16Array(indices)};
}
