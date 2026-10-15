/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Publish complete or paged native exact-time mask observations without inferring animated geometry.
 */
import {MotionError} from './project-store.mjs';
import {stringifyNative} from '../tools/native-json.mjs';
import {projectReceipt} from './project-inspection.mjs';
export function maskObservation(project,mask,detail,offset){
 if(!mask?.properties?.path?.value?.v||!['full','bounded'].includes(detail)||!/^(0|[1-9][0-9]{0,6})$/.test(offset))throw new MotionError(400,'motion_invalid_mask_observation');
 const source=mask.properties.path.value.v,vertices=source.vertices,feather=source.feather??[],start=Number(offset),total=Math.max(vertices.length,feather.length);
 if(start>total||detail==='full'&&start!==0)throw new MotionError(400,'motion_invalid_mask_page');
 const path=detail==='full'?source:{...source,vertices:vertices.slice(start,start+64),in_tangents:source.in_tangents.slice(start,start+64),out_tangents:source.out_tangents.slice(start,start+64),feather:feather.slice(start,start+64)};
 const next=detail==='full'?total:Math.min(total,start+64),result={project:projectReceipt(project),mask:{...mask,properties:{...mask.properties,path:{...mask.properties.path,value:{...mask.properties.path.value,v:path}}}},geometry:{offset:start,nextOffset:next,totalVertices:vertices.length,totalFeatherPoints:feather.length,complete:next===total,coordinateSpace:'layer coordinates; tangent offsets relative to each vertex'}};
 if(detail==='bounded'&&Buffer.byteLength(stringifyNative(result))>60*1024)throw new MotionError(413,'motion_agent_observation_limit');return result;
}
