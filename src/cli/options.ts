/** The parsed command-line flags. Every command receives the same shape. */
export interface CliOptions {
  output?: string;
  id?: string;
  key?: string;
  alpha?: string;
  json?: boolean;
  version?: boolean;
  help?: boolean;
}
