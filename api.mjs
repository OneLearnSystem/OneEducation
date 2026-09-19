import {appRPC,login,signOut,identity,demo,cfg} from './shared.mjs';
export {signOut,identity};export const logout=signOut;export const rpc=appRPC;
export async function signIn(email,password){if(!demo)await login(email,password);return appRPC(cfg.product==='OneEducation'?'oe_get_state':cfg.product==='OneHome'?'oh_staff':'ss_staff')}
export const signin=signIn;export const portal=code=>appRPC('oe_student_portal',{p_code:code});export const studentAction=(code,kind,data,item=null)=>appRPC('oe_hub_student_action',{p_code:code,p_kind:kind,p_data:data,p_item:item});
