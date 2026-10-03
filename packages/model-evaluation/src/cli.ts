import { evaluationCases } from './cases/index.js';
import { runCodex } from './codex-exec.js';
import { runEvaluationCli } from './cli-commands.js';

process.exitCode = await runEvaluationCli(process.argv.slice(2), {
  cases: evaluationCases,
  executeCodex: runCodex,
  writeOutput: console.log,
  writeError: console.error,
});
