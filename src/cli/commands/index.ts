import type { CommandRegistrar } from "../run";
import { addCommand } from "./add";
import { initCommand } from "./init";
import { listCommand } from "./list";
import { removeCommand } from "./remove";
import { resolveCommand } from "./resolve";

/** The registered command set, in help-listing order. */
export const commandRegistrars: CommandRegistrar[] = [
  initCommand,
  addCommand,
  removeCommand,
  resolveCommand,
  listCommand,
];
