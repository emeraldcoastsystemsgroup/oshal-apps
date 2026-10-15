/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Return exact native transform/camera/light/effect-instance observations with original revision and bounded agent values.
 */
import {MotionError} from './project-store.mjs';
import {projectReceipt} from './project-inspection.mjs';
import {stringifyNative} from '../tools/native-json.mjs';
export function propertiesObservation(project,inspection,{full=false,prop=null,offset=0}={}){
 if(!inspection||!Array.isArray(inspection.properties)||inspection.properties.length>256)throw new MotionError(503,'motion_invalid_properties_observation');
 if(prop!==null){
  const selected=inspection.properties.find(p=>p.prop===prop);if(!selected)throw new MotionError(404,'motion_properties_target_missing');
  const {value,...metadata}=selected,text=typeof value==='string'?value:stringifyNative(value);
  if(!Number.isSafeInteger(offset)||offset<0||offset>text.length||offset>0&&/[\uDC00-\uDFFF]/.test(text[offset]??'')&&/[\uD800-\uDBFF]/.test(text[offset-1]))throw new MotionError(400,'motion_invalid_inspection_offset');
  let end=Math.min(text.length,offset+4096);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;
  const result={project:projectReceipt(project),layer:inspection.layer,effect:inspection.effect,compTimeTicks:inspection.compTimeTicks,layerTimeTicks:inspection.layerTimeTicks,sampleSpace:inspection.sampleSpace,property:metadata,valueEncoding:typeof value==='string'?'string':'native-json',offsetUnit:'utf16-code-units',offset,totalCodeUnits:text.length,text:text.slice(offset,end),complete:end===text.length,nextOffset:end===text.length?null:end};
  if(Buffer.byteLength(stringifyNative(result))>60*1024)throw new MotionError(413,'motion_agent_observation_limit');return result;
 }
 const properties=inspection.properties.map(prop=>({...prop,...(prop.valueType==='layer'&&prop.value!==null?{value:String(prop.value),valueEncoding:'decimal-integer'}:{})}));
 const observed=properties.map(p=>{if(full||Buffer.byteLength(stringifyNative(p.value))<=4096)return {...p,valueComplete:true};const {value,...metadata}=p;return {...metadata,valueComplete:false,valueCodeUnits:typeof value==='string'?value.length:stringifyNative(value).length,valueReading:{tool:'motion-read-effect-value',prop:p.prop,offset:0}};});
 const result={project:projectReceipt(project),inspection:{...inspection,properties:observed}};
 if(Buffer.byteLength(stringifyNative(result))>(full?6*1024*1024:60*1024))throw new MotionError(413,'motion_agent_observation_limit');return result;
}
