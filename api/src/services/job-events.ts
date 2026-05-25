import { EventEmitter } from "events";

export interface JobStatusEvent {
  jobId: string;
  state: string;
  progress: number;
  logs?: string[];
  result?: Record<string, unknown>;
  failedReason?: string;
  currentStage?: string | null;
  progressJson?: any;
}

class JobEventBus extends EventEmitter {
  private static instance: JobEventBus;

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  static getInstance(): JobEventBus {
    if (!JobEventBus.instance) {
      JobEventBus.instance = new JobEventBus();
    }
    return JobEventBus.instance;
  }

  emitJobStatus(event: JobStatusEvent) {
    this.emit("jobStatus", event);
  }
}

export const jobEventBus = JobEventBus.getInstance();