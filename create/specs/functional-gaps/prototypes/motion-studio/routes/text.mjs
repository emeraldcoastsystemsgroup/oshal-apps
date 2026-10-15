/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Publish actual native font inventory and complete or explicitly bounded exact source-text observations.
 */
import {createHash} from 'node:crypto';
import {motionEngine} from './engine-client.mjs';
import {MotionError} from './project-store.mjs';
import {stringifyNative} from '../tools/native-json.mjs';
import {projectReceipt} from './project-inspection.mjs';
export async function fontInventory(ctx){
 const blank=await motionEngine(ctx,{op:'create'}),result=await motionEngine(ctx,{op:'edit',document:blank.document,commands:[{command:'text.fonts',params:{}}]}),fonts=result.results?.[0];
 if(!fonts||!Array.isArray(fonts.families)||fonts.count!==fonts.families.length||!fonts.families.every(f=>typeof f.family==='string'&&Array.isArray(f.styles)&&f.styles.every(s=>typeof s==='string')))throw new MotionError(503,'motion_font_inventory_invalid');
 return{upstream:result.upstream,families:fonts.families,stamp:createHash('sha256').update(stringifyNative(fonts.families)).digest('hex')};
}
export async function fontIndex(ctx,stamp,offset){
 if(typeof stamp!=='string'||stamp!=='start'&&!/^[a-f0-9]{64}$/.test(stamp)||!/^(0|[1-9][0-9]{0,5})$/.test(offset))throw new MotionError(400,'motion_invalid_font_page');
 const inventory=await fontInventory(ctx),start=Number(offset);if(stamp!=='start'&&stamp!==inventory.stamp)throw new MotionError(409,'motion_font_inventory_changed');if(start>inventory.families.length)throw new MotionError(400,'motion_invalid_font_page');
 const families=inventory.families.slice(start,start+64),output={schemaVersion:1,...inventory,families,offset:start,total:inventory.families.length,nextOffset:start+families.length,complete:start+families.length===inventory.families.length,evidence:'Actual worker font inventory. Installed image/host fonts and individual glyph coverage require verification.'};
 if(Buffer.byteLength(stringifyNative(output))>60*1024)throw new MotionError(413,'motion_agent_observation_limit');return output;
}
export function textObservation(project,text,detail){
 if(!text||typeof text.value?.text!=='string'||!['full','bounded'].includes(detail))throw new MotionError(503,'motion_text_inspection_failed');
 const size=Buffer.byteLength(stringifyNative(text.value)),metadata={...text,valueComplete:detail==='full'||size<=32768,valueBytes:size};
 if(!metadata.valueComplete){delete metadata.value;metadata.valueInspection=projectReceipt(project).inspection;}
 const output={project:projectReceipt(project),text:metadata};if(detail==='bounded'&&Buffer.byteLength(stringifyNative(output))>60*1024)throw new MotionError(413,'motion_agent_observation_limit');return output;
}
