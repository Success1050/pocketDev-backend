import { Injectable } from '@nestjs/common';

@Injectable()
export class AgentService {
  constructor() {}

  async processTask(taskId: string, instruction: string) {
    // 1. Fetch repo
    // 2. Spin up Docker via DockerService
    // 3. Initiate AI task loop via OpenAI API
    console.log(`Starting AI processing for task: ${taskId}`);
  }
}
