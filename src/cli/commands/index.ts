import type { CommandRegistrar } from "../run";
import { addCommand } from "./add";
import { initCommand } from "./init";
import { removeCommand } from "./remove";

/** The registered command set, in help-listing order. */
export const commandRegistrars: CommandRegistrar[] = [
  initCommand,
  addCommand,
  removeCommand,
];
