import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { AppService } from "./app-service";
import { logout } from "./auth";
import { config } from "./config";
import { createDb, type Db } from "./db";

const USAGE = `Использование:
  npm run user:create -- --email EMAIL --name NAME --country COUNTRY --city CITY [--password-stdin]

Пароль без --password-stdin запрашивается дважды в интерактивном режиме и не отображается.
Флаг --password-stdin читает пароль и подтверждение из первых двух строк stdin.`;

type CreateUserArguments = {
  email: string;
  name: string;
  countryName: string;
  cityName: string;
};

export type CreateUserCliOptions = {
  db: Db;
  argv: string[];
  readPassword: (prompt: string) => Promise<string>;
  writeOutput?: (message: string) => void;
  writeError?: (message: string) => void;
};

function parseArguments(argv: string[]): CreateUserArguments | "help" {
  if (argv.includes("--help") || argv.includes("-h")) return "help";
  if (argv.includes("--password")) {
    throw new Error("Не передавайте пароль аргументом командной строки; используйте защищённый ввод или --password-stdin");
  }
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--password-stdin") {
      continue;
    }
    if (!["--email", "--name", "--country", "--city"].includes(argument)) {
      throw new Error(`Неизвестный аргумент: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Не задано значение ${argument}`);
    if (values.has(argument)) throw new Error(`Аргумент ${argument} задан несколько раз`);
    values.set(argument, value);
    index += 1;
  }
  const required = ["--email", "--name", "--country", "--city"] as const;
  const missing = required.find((argument) => !values.get(argument)?.trim());
  if (missing) throw new Error(`Не задан обязательный аргумент ${missing}`);
  return {
    email: values.get("--email")!.trim(),
    name: values.get("--name")!.trim(),
    countryName: values.get("--country")!.trim(),
    cityName: values.get("--city")!.trim(),
  };
}

export async function runCreateUserCli(options: CreateUserCliOptions): Promise<number> {
  const writeOutput = options.writeOutput ?? console.log;
  const writeError = options.writeError ?? console.error;
  let input: CreateUserArguments | "help";
  try {
    input = parseArguments(options.argv);
  } catch (error) {
    writeError(error instanceof Error ? error.message : "Некорректные аргументы");
    writeError(USAGE);
    return 2;
  }
  if (input === "help") {
    writeOutput(USAGE);
    return 0;
  }

  try {
    const password = await options.readPassword("Пароль: ");
    const passwordConfirmation = await options.readPassword("Повторите пароль: ");
    if (password !== passwordConfirmation) throw new Error("Пароли не совпадают");
    const result = await new AppService(options.db).onboardUser({
      email: input.email,
      name: input.name,
      password,
      countryName: input.countryName,
      cityName: input.cityName,
    });
    await logout(options.db, result.session);
    writeOutput(`Пользователь ${result.user.email} создан. Страна: ${input.countryName}. Город: ${input.cityName}.`);
    return 0;
  } catch (error) {
    writeError(error instanceof Error ? error.message : "Не удалось создать пользователя");
    return 1;
  }
}

async function readHiddenPassword(prompt: string): Promise<string> {
  const input = process.stdin;
  const output = process.stdout;
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("Для неинтерактивного запуска используйте --password-stdin");
  }
  output.write(prompt);
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.setEncoding("utf8");
  input.resume();
  return new Promise<string>((resolvePassword, rejectPassword) => {
    let password = "";
    const finish = (error?: Error) => {
      input.off("data", onData);
      input.setRawMode(wasRaw);
      input.pause();
      output.write("\n");
      if (error) rejectPassword(error);
      else resolvePassword(password);
    };
    const onData = (chunk: string | Buffer) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          finish(new Error("Создание пользователя отменено"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (password.length > 0) password = password.slice(0, -1);
          continue;
        }
        if (character >= " ") {
          if (password.length >= 128) {
            finish(new Error("Пароль слишком длинный"));
            return;
          }
          password += character;
        }
      }
    };
    input.on("data", onData);
  });
}

async function passwordReaderFromStdin(): Promise<(prompt: string) => Promise<string>> {
  process.stdin.setEncoding("utf8");
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > 1024) throw new Error("Ввод пароля слишком длинный");
  }
  const values = raw.split(/\r?\n/u);
  return async () => values.shift() ?? "";
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  try {
    const parsed = parseArguments(argv);
    if (parsed === "help") {
      console.log(USAGE);
      return 0;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Некорректные аргументы");
    console.error(USAGE);
    return 2;
  }
  let readPassword: (prompt: string) => Promise<string>;
  try {
    readPassword = argv.includes("--password-stdin") ? await passwordReaderFromStdin() : readHiddenPassword;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Не удалось прочитать пароль");
    return 1;
  }
  let db: Db;
  try {
    db = await createDb(config.databaseUrl);
  } catch {
    console.error("Не удалось подключиться к базе данных Tasktopia");
    return 1;
  }
  try {
    return await runCreateUserCli({ db, argv, readPassword });
  } finally {
    await db.close();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
