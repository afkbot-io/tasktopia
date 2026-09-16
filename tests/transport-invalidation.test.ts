import { expect,it } from "vitest";
import { createTestDb } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { foreignTransportRecipients } from "../src/server/transport-invalidation";
import type { RealtimeEvent } from "../src/shared/contracts";
it("targets only current members and ignores ordinary task activity",async()=>{
  const db=await createTestDb();
  try{
    const a=(await registerUser(db,{email:"transport-owner@example.test",name:"Owner",password:"password123"})).user;
    const b=(await registerUser(db,{email:"transport-member@example.test",name:"Member",password:"password123"})).user;
    const event:RealtimeEvent={id:1,countryId:a.countryId,worldVersion:1,type:"task.status_changed",payload:{serviceRole:"AIRPORT"},createdAt:new Date().toISOString()};
    expect(await foreignTransportRecipients(db,{...event,payload:{serviceRole:"PORT"}})).toEqual([a.id]);
    expect(await foreignTransportRecipients(db,event)).toEqual([a.id]);
    await db.prepare("INSERT INTO country_members(country_id,user_id,role,created_at) VALUES (?,?,'VIEWER',now())").run(a.countryId,b.id);
    expect(new Set(await foreignTransportRecipients(db,event))).toEqual(new Set([a.id,b.id]));
    expect(await foreignTransportRecipients(db,{...event,payload:{},type:"task.comment_added"})).toEqual([]);
    await db.prepare("DELETE FROM country_members WHERE country_id=? AND user_id=?").run(a.countryId,b.id);
    expect(await foreignTransportRecipients(db,{...event,payload:{serviceRole:"PORT"}})).toEqual([a.id]);
    expect(await foreignTransportRecipients(db,event)).toEqual([a.id]);
  }finally{await db.close();}
});
