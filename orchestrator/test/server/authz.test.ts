import { describe, it, expect } from "vitest";
import { authorizeRequest } from "../../src/server/authz.js";
import type { AccountRecord } from "../../src/server/auth.js";
const accounts: AccountRecord[] = [
  { id:"acct-admin", username:"admin", salt:"s", hash:"h", profileId:"home", role:"owner", updatedAt:0 },
  { id:"acct-admin1", username:"admin1", salt:"s", hash:"h", profileId:"client-x", role:"member", updatedAt:0 }];
const sess = (accountId:string,p:string)=>({accountId,profileId:p,issuedAt:0});
describe("authorizeRequest", () => {
  it("owner/member 普通放行", () => {
    expect(authorizeRequest(sess("acct-admin","home"),accounts,"/api/view")).toEqual({ok:true,accountId:"acct-admin",username:"admin",profileId:"home",role:"owner"});
    expect(authorizeRequest(sess("acct-admin1","client-x"),accounts,"/api/view").ok).toBe(true);
  });
  it("账号删→401/profile不符→401", () => {
    expect(authorizeRequest(sess("ghost","home"),accounts,"/api/view")).toEqual({ok:false,status:401});
    expect(authorizeRequest(sess("acct-admin1","client-y"),accounts,"/api/view")).toEqual({ok:false,status:401});
  });
  it("member 碰账号管理→403/owner放行", () => {
    expect(authorizeRequest(sess("acct-admin1","client-x"),accounts,"/api/accounts")).toEqual({ok:false,status:403});
    expect(authorizeRequest(sess("acct-admin","home"),accounts,"/api/accounts").ok).toBe(true);
  });
});
