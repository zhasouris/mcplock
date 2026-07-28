import type { CommandRegistrar } from "../run";
import { addCommand } from "./add";
import { diffCommand } from "./diff";
import { initCommand } from "./init";
import { listCommand } from "./list";
import { removeCommand } from "./remove";
import { resolveCommand } from "./resolve";
import { updateCommand } from "./update";
import { verifyCommand } from "./verify";
import { whyCommand } from "./why";

/** The registered command set, in help-listing order. */
export const commandRegistrars: CommandRegistrar[] = [
  initCommand,
  addCommand,
  removeCommand,
  resolveCommand,
  updateCommand,
  verifyCommand,
  diffCommand,
  whyCommand,
  listCommand,
];
