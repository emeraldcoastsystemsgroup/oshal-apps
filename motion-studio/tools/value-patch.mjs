/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Compute exact minimal UTF16 string replacements without splitting surrogate pairs or sending unchanged large values.
 */
const inside=(text,n)=>n>0&&n<text.length&&/[\uD800-\uDBFF]/.test(text[n-1])&&/[\uDC00-\uDFFF]/.test(text[n]);
export function valueChange(prop,before,after){
 if(typeof before!=='string'||typeof after!=='string')return {prop:String(prop),value:after};
 let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;
 if(inside(before,start)||inside(after,start))start--;
 let end=before.length,nextEnd=after.length;
 while(end>start&&nextEnd>start&&before[end-1]===after[nextEnd-1]){end--;nextEnd--;}
 if(inside(before,end)||inside(after,nextEnd)){end++;nextEnd++;}
 return {prop:String(prop),textPatch:{start,end,text:after.slice(start,nextEnd)}};
}
