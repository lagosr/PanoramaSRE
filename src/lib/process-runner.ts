import { invoke, Channel } from '@tauri-apps/api/core';

export interface StreamJobOptions {
  jobId: string;
  label: string;
  command: string;
  args: string[];
  workingDir?: string;
  lockType?: 'WshRemoteMutation' | 'LocalBackupIo' | 'PortainerApi' | 'PesterRunner' | 'None';
  elevated?: boolean;
  onLine?: (line: string, stream: string) => void;
  onComplete?: (exitCode: number) => void;
  onError?: (error: any) => void;
}

export function runStreamJob(options: StreamJobOptions): Promise<number> {
  const channel = new Channel<{
    job_id: string;
    stream: string;
    line: string;
    timestamp: string;
  }>();

  channel.onmessage = (chunk) => {
    if (options.onLine) {
      options.onLine(chunk.line, chunk.stream);
    }
  };

  return invoke<number>('run_process_stream', {
    request: {
      job_id: options.jobId,
      label: options.label,
      command: options.command,
      args: options.args,
      working_dir: options.workingDir || null,
      lock_type: options.lockType || 'None',
      elevated: options.elevated || false,
    },
    channel,
  })
    .then((code) => {
      if (options.onComplete) {
        options.onComplete(code);
      }
      return code;
    })
    .catch((err) => {
      if (options.onError) {
        options.onError(err);
      }
      throw err;
    });
}
