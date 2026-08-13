export type ManualSyncExitInput = { runnerExitCode: number; failedCandidates: number; integrityOk: boolean };

export function manualSyncExitCode(input: ManualSyncExitInput): number {
  if (input.runnerExitCode !== 0) return input.runnerExitCode;
  if (input.failedCandidates > 0) return 4;
  if (!input.integrityOk) return 5;
  return 0;
}
