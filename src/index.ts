import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { withLock } from "./lock.js";
import {
  runDisableVault,
  runEnableVault,
  runInit,
  runLink,
  runLockVault,
  runReset,
  runSync,
  runUnlockVault,
  showStatus,
} from "./sync.js";

export default function gitSyncExtension(pi: ExtensionAPI) {
  pi.setLabel("OMP Config Git Sync");

  const handler = async (args: string, ctx: ExtensionCommandContext) => {
    const [command = "status", ...rest] = args.trim().split(/\s+/);
    const arg = rest.join(" ");

    try {
      await withLock(ctx, async () => {
        if (command === "init") {
          return runInit(arg, ctx);
        }
        if (command === "link") {
          return runLink(arg, ctx);
        }
        if (command === "status") {
          return showStatus(ctx);
        }
        if (command === "reset" || command === "restore") {
          return runReset(ctx);
        }
        if (command === "sync") {
          const discardLocal = /\b(--discard-local|--force|-f|--hard)\b/i.test(arg);
          return runSync(ctx, { auto: false, push: !discardLocal, discardLocal });
        }
        if (command === "push") {
          return runSync(ctx, { auto: false, push: true, skipPull: true });
        }
        if (command === "pull") {
          const discardLocal = /\b(--discard-local|--force|-f|--hard)\b/i.test(arg);
          return runSync(ctx, { auto: false, push: false, discardLocal });
        }
        if (command === "unlock") {
          return runUnlockVault(arg || undefined, ctx);
        }
        if (command === "lock") {
          return runLockVault(ctx);
        }
        if (command === "vault") {
          const [subcommand = "status", ...subRest] = arg.trim().split(/\s+/);
          const subArg = subRest.join(" ");
          if (subcommand === "enable") {
            return runEnableVault(subArg || undefined, ctx);
          }
          if (subcommand === "disable") {
            return runDisableVault(ctx);
          }
          if (subcommand === "unlock") {
            return runUnlockVault(subArg || undefined, ctx);
          }
          if (subcommand === "lock") {
            return runLockVault(ctx);
          }
          if (subcommand === "status") {
            return showStatus(ctx);
          }
          throw new Error("Unknown vault subcommand. Usage: /ompsync vault [enable|disable|unlock|lock|status]");
        }
        throw new Error("Unknown command. Usage: /ompsync [init|link|status|sync|reset|push|pull|unlock|lock|vault]");
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`omp-sync: ${msg}`, "error");
    }
  };

  const commandDef = {
    description: "Securely sync Oh My Pi config and encrypted credentials vault",
    getArgumentCompletions: (prefix: string) => {
      const trimmed = prefix.trimStart();
      if (trimmed.startsWith("vault ")) {
        const subEntries = ["enable", "disable", "unlock", "lock", "status"]
          .map((sub) => ({ value: `vault ${sub}`, label: `vault ${sub}` }))
          .filter((x) => x.value.startsWith(trimmed));
        return subEntries.length ? subEntries : null;
      }
      const entries = ["init", "link", "status", "sync", "reset", "push", "pull", "unlock", "lock", "vault"]
        .map((value) => ({ value, label: value }))
        .filter((x) => x.value.startsWith(prefix.trim()));
      return entries.length ? entries : null;
    },
    handler,
  };


  pi.registerCommand("ompsync", commandDef);
  pi.registerCommand("gitsync", commandDef);
}
