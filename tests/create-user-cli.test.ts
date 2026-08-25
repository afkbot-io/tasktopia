import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { loginUser } from "../src/server/auth";
import { runCreateUserCli } from "../src/server/create-user-cli";
import { createTestDb, type Db } from "../src/server/db";

describe("create-user CLI boundary", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it("creates an owner who can log in and open the requested country and city", async () => {
    const stdout: string[] = [];
    const passwords = ["safe-password-123", "safe-password-123"];
    const exitCode = await runCreateUserCli({
      db,
      argv: [
        "--email", "admin@example.test",
        "--name", "Company Admin",
        "--country", "Company Workspace",
        "--city", "Main Product",
      ],
      readPassword: async () => passwords.shift() ?? "",
      writeOutput: (message) => { stdout.push(message); },
    });

    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("Пользователь admin@example.test создан");
    expect(stdout.join("\n")).not.toContain("safe-password-123");

    const authenticated = await loginUser(db, "ADMIN@example.test", "safe-password-123");
    const bootstrap = await new AppService(db).getBootstrap(authenticated.user);
    expect(bootstrap).toMatchObject({
      country: { name: "Company Workspace" },
      initialCity: { name: "Main Product" },
    });
  }, 15_000);

  it("does not create an account when password confirmation differs", async () => {
    const stderr: string[] = [];
    const passwords = ["safe-password-123", "different-password-456"];
    const exitCode = await runCreateUserCli({
      db,
      argv: [
        "--email", "rejected@example.test",
        "--name", "Rejected User",
        "--country", "Rejected Country",
        "--city", "Rejected City",
      ],
      readPassword: async () => passwords.shift() ?? "",
      writeError: (message) => { stderr.push(message); },
    });

    expect(exitCode).toBe(1);
    expect(stderr).toEqual(["Пароли не совпадают"]);
    await expect(loginUser(db, "rejected@example.test", "safe-password-123"))
      .rejects.toThrow("Неверный email или пароль");
  });

  it("refuses passwords passed through process arguments", async () => {
    const stderr: string[] = [];
    const exitCode = await runCreateUserCli({
      db,
      argv: [
        "--email", "argument-secret@example.test",
        "--name", "Argument Secret",
        "--country", "Argument Country",
        "--city", "Argument City",
        "--password", "must-not-be-accepted",
      ],
      readPassword: async () => { throw new Error("password prompt must not run"); },
      writeError: (message) => { stderr.push(message); },
    });

    expect(exitCode).toBe(2);
    expect(stderr[0]).toContain("Не передавайте пароль аргументом командной строки");
    expect(stderr.join("\n")).not.toContain("must-not-be-accepted");
  });
});
