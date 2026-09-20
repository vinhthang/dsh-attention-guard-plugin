import Schema from '@deepseek-ai/schemastery';

export interface Config {
  enabled: boolean;
  model: string;
  rtkBinary: string;
  excludeCommands: string[];
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true).description('Whether attention guard is enabled'),
  model: Schema.string().default('deepseek-flash').description('Model identifier used for harness operations'),
  rtkBinary: Schema.string().default('rtk').description('Path or name of the RTK binary in PATH'),
  excludeCommands: Schema.array(Schema.string()).default([]).description('Commands excluded from RTK rewriting'),
});
