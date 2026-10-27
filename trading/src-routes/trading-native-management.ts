/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Typed source seam for the package's native management route module.
 */
import type {AppContext} from '@/app/composition/app-context';
import type {PlanRouteRegister} from './trading-portfolio-plan-routes';
import type {Data} from './trading-portfolio-store';
const management=require('../routes/live/management') as {registerNativeManagementRoutes:(route:PlanRouteRegister,ctx:AppContext,deps:{clock:()=>Date;selected:(owner:string,binding:Data,at:Date)=>Promise<Data>})=>void};
export const registerNativeManagementRoutes=management.registerNativeManagementRoutes;
