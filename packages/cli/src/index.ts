import { Command } from "commander"
import chalk from "chalk"
import { crawlCommand } from "./commands/crawl.js"
import { serveCommand } from "./commands/serve.js"
import { scheduleCommand } from "./commands/schedule.js"
import { configCommand } from "./commands/config.js"
import { userCommand } from "./commands/user.js"
import { bootstrapCommand } from "./commands/bootstrap.js"

const program = new Command()

program
  .name("supacrawl")
  .description("Sitemap-based website monitoring tool with DDoS-safe crawling")
  .version("0.1.0")

program
  .command("bootstrap")
  .description("Create the first admin user (run once on initial setup)")
  .requiredOption("--email <email>", "Admin email")
  .requiredOption("--password <password>", "Admin password (min 8 chars)")
  .option("--name <name>", "Display name")
  .option("--db <path>", "Path to SQLite database", "./data/supacrawl.db")
  .action(bootstrapCommand)

program
  .command("crawl")
  .description("Run a one-off crawl")
  .option("-c, --config <path>", "Path to config file", "./supacrawl.config.json")
  .option("--db <path>", "Path to SQLite database", "./data/supacrawl.db")
  .option("--json", "Output JSON instead of pretty report")
  .action(crawlCommand)

program
  .command("serve")
  .description("Start the API + dashboard server")
  .option("-c, --config <path>", "Path to config file", "./supacrawl.config.json")
  .option("--db <path>", "Path to SQLite database", "./data/supacrawl.db")
  .option("-p, --port <port>", "Port to bind", "3000")
  .option("--host <host>", "Host to bind", "0.0.0.0")
  .action(serveCommand)

program
  .command("schedule")
  .description("Run a scheduled crawl loop based on cron expression")
  .option("-c, --config <path>", "Path to config file", "./supacrawl.config.json")
  .option("--db <path>", "Path to SQLite database", "./data/supacrawl.db")
  .option("--expression <expr>", "Override cron expression from config")
  .action(scheduleCommand)

const configCmd = program
  .command("config")
  .description("Manage configuration")

configCmd
  .command("show")
  .option("-c, --config <path>", "Path to config file", "./supacrawl.config.json")
  .description("Show current config")
  .action((opts) => configCommand("show", opts))

configCmd
  .command("get <key>")
  .option("-c, --config <path>", "Path to config file", "./supacrawl.config.json")
  .description("Get a config value")
  .action((key, opts) => configCommand("get", { ...opts, key }))

configCmd
  .command("set <key> <value>")
  .option("-c, --config <path>", "Path to config file", "./supacrawl.config.json")
  .description("Set a config value")
  .action((key, value, opts) => configCommand("set", { ...opts, key, value }))

configCmd
  .command("init")
  .option("-c, --config <path>", "Path to write config", "./supacrawl.config.json")
  .description("Write a starter config file")
  .action((opts) => configCommand("init", opts))

const userCmd = program
  .command("user")
  .description("Manage users (server must be running)")

userCmd
  .command("create")
  .requiredOption("--email <email>", "User email")
  .requiredOption("--password <password>", "User password")
  .option("--name <name>", "Display name")
  .option("--admin", "Grant admin role")
  .option("--db <path>", "Path to SQLite database", "./data/supacrawl.db")
  .description("Create a new user")
  .action(userCommand)

userCmd
  .command("list")
  .option("--db <path>", "Path to SQLite database", "./data/supacrawl.db")
  .description("List users")
  .action(userCommand)

userCmd
  .command("delete <id>")
  .option("--db <path>", "Path to SQLite database", "./data/supacrawl.db")
  .description("Delete a user")
  .action(userCommand)

userCmd
  .command("set-role <id> <role>")
  .option("--db <path>", "Path to SQLite database", "./data/supacrawl.db")
  .description("Set user role (admin or user)")
  .action(userCommand)

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red("Error:"), err.message)
  process.exit(1)
})
