/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Typed seam for measured native account history and read-only details.
 */
import type {AppContext} from '@/app/composition/app-context';
import type {PlanRouteRegister} from './trading-portfolio-plan-routes';
import type {Data} from './trading-portfolio-store';
const values=require('../routes/trading-account-values') as {
 recordAccountValues:(ctx:AppContext,owner:string,native:Data)=>Promise<boolean>;
 registerAccountValueRoutes:(route:PlanRouteRegister,ctx:AppContext,deps:{selected:(owner:string,binding:Data,at:Date)=>Promise<Data>})=>void;
};
export const recordAccountValues=values.recordAccountValues;
export const registerAccountValueRoutes=values.registerAccountValueRoutes;
