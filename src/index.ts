import type { Context } from '@deepseek-ai/cordis';
import type { ShellExecRequest, ShellExecSpec } from '@deepseek-ai/dsh-shell';
import { Config } from './schema.js';
import { checkRtkAvailable, rewriteCommand } from './rtk.js';

export const name = 'dsh-plugin-attention-guard';
export const inject = ['shell'] as const;
export { Config };
export type { Config as ConfigType } from './schema.js';

export function apply(ctx: Context, config: Config): void {
  const isAvailable = checkRtkAvailable(config.rtkBinary);
  if (!isAvailable) {
    const logger = typeof ctx.logger === 'function' ? ctx.logger('attention-guard') : ctx.logger;
    logger?.warn?.(`rtk binary "${config.rtkBinary}" not found in PATH; Attention Guard disabled`);
    return;
  }

  const originalResolve = ctx.shell.resolve.bind(ctx.shell);

  ctx.shell.resolve = function (this: any, request: ShellExecRequest): ShellExecSpec {
    if (!config.enabled) {
      return originalResolve.call(this, request);
    }

    const rewritten = rewriteCommand(request.command, config);
    return originalResolve.call(this, {
      ...request,
      command: rewritten,
    });
  };
}

export default {
  name,
  inject,
  Config,
  apply,
};
