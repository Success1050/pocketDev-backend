/**
 * Constants for the background job queue system.
 */
export const TASK_QUEUE = 'task-processing';

export enum JobType {
  PROCESS_TASK = 'process-task',
  SEND_NOTIFICATION = 'send-notification',
  CLEANUP_WORKSPACE = 'cleanup-workspace',
}

export enum JobStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}
