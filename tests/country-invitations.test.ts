import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "../src/server/db";
import { registerUser, countryRole, removeCountryMember } from "../src/server/auth";
import { createCountryInvitation, acceptCountryInvitation } from "../src/server/country-invitations";
describe("country invitations", () => {
 let db: Db;
 beforeEach(async () => { db = await createTestDb(); });
 afterEach(async () => { await db.close(); });
 it("binds invitation to email and uses it once without overwriting roles", async () => {
   const owner = await registerUser(db, { email: "owner@example.test", name: "Owner", password: "password-123" });
   const invited = await createCountryInvitation(db, owner.user.countryId, owner.user.id, "new@example.test", "VIEWER");
   expect(JSON.stringify(await db.prepare("SELECT * FROM country_invitations").all())).not.toContain(invited.token);
   expect(await acceptCountryInvitation(db, invited.token, owner.user.id, owner.user.email)).toBeNull();
   const guest = await registerUser(db, { email: "new@example.test", name: "Guest", password: "password-123" });
   const results = await Promise.all([1,2].map(() => acceptCountryInvitation(db, invited.token, guest.user.id, guest.user.email)));
   expect(results.filter(Boolean)).toHaveLength(1);
   expect(await countryRole(db,guest.user.id,owner.user.countryId)).toBe("VIEWER");
   const self = await createCountryInvitation(db, owner.user.countryId,owner.user.id,owner.user.email,"VIEWER");
   await acceptCountryInvitation(db,self.token,owner.user.id,owner.user.email);
   expect(await countryRole(db,owner.user.id,owner.user.countryId)).toBe("OWNER");
 });
 it("rejects rotated, revoked and expired invitations", async () => {
   const owner = await registerUser(db, { email: "owner@example.test", name: "Owner", password: "password-123" });
   const first = await createCountryInvitation(db,owner.user.countryId,owner.user.id,owner.user.email,"VIEWER");
   const next = await createCountryInvitation(db,owner.user.countryId,owner.user.id,owner.user.email,"MEMBER");
   expect(await acceptCountryInvitation(db,first.token,owner.user.id,owner.user.email)).toBeNull();
   await db.prepare("UPDATE country_invitations SET expires_at=now()-interval '1 second' WHERE id=?").run(next.id);
   expect(await acceptCountryInvitation(db,next.token,owner.user.id,owner.user.email)).toBeNull();
 });
 it("removing a member invalidates outstanding invitation links", async () => {
   const owner = await registerUser(db, { email: "owner@example.test", name: "Owner", password: "password-123" });
   const guest = await registerUser(db, { email: "guest@example.test", name: "Guest", password: "password-123" });
   const first = await createCountryInvitation(db, owner.user.countryId, owner.user.id, guest.user.email, "MEMBER");
   await acceptCountryInvitation(db, first.token, guest.user.id, guest.user.email);
   const second = await createCountryInvitation(db, owner.user.countryId, owner.user.id, guest.user.email, "MEMBER");
   await removeCountryMember(db, owner.user.countryId, guest.user.id);
   expect(await acceptCountryInvitation(db, second.token, guest.user.id, guest.user.email)).toBeNull();
   expect(await countryRole(db, guest.user.id, owner.user.countryId)).toBeNull();
 });

});
